import { Hono } from "hono";
import {
  ATTACHMENT_ERRORS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_TASK,
  cleanFilename,
  FILENAME_HEADER,
  sniffMime,
} from "../../shared/attachments";
import { type Attachment, TASK_CONFIRM } from "../../shared/tasks";
import { AUDIT, auditStatement } from "../audit";
import { forbidden, idParam } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { can } from "../auth/permissions";
import type { AppEnv } from "../types";
import { loadTaskAccess } from "./queries";
import { guardTask, unconfirmed } from "./routes";

// Attachments (TASK-5, section 11.4). Files live in R2 and are only ever served through the Worker after a
// membership check: no signed URLs, no public bucket. The type comes from the file's first bytes.

export const attachmentKey = (projectId: number, taskId: number) => `attachments/${projectId}/${taskId}/${crypto.randomUUID()}`;

export function attachmentRoutes() {
  const routes = new Hono<AppEnv>();

  // The body is the raw file; the name comes in X-Filename. Contributors and admins attach (task edit rights).
  routes.post("/tasks/:id/attachments", requireSession, async (c) => {
    const access = await guardTask(c, "task.edit");
    if (access instanceof Response) return access;
    const declared = Number(c.req.header("Content-Length") ?? "0");
    if (declared > ATTACHMENT_MAX_BYTES) return c.json({ error: ATTACHMENT_ERRORS.tooLarge }, 413);

    const count = await c.env.DB.prepare("SELECT count(*) AS n FROM attachments WHERE task_id = ?1 AND deleted_at IS NULL")
      .bind(access.task.id)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= ATTACHMENTS_PER_TASK) return c.json({ error: ATTACHMENT_ERRORS.tooMany }, 409);

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength > ATTACHMENT_MAX_BYTES) return c.json({ error: ATTACHMENT_ERRORS.tooLarge }, 413);
    const mime = body.byteLength > 0 ? sniffMime(body.subarray(0, 16)) : null;
    if (!mime) return c.json({ error: ATTACHMENT_ERRORS.unsupported }, 415);

    let filename = "file";
    try {
      filename = cleanFilename(decodeURIComponent(c.req.header(FILENAME_HEADER) ?? "file"));
    } catch {
      // Badly encoded name: keep the default.
    }
    const { user } = c.get("auth");
    const key = attachmentKey(access.project.id, access.task.id);
    // R2 first, then the row: if the row fails, the daily clean-up removes the orphaned object.
    await c.env.FILES.put(key, body, { httpMetadata: { contentType: mime } });
    const now = Date.now();
    const [inserted] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO attachments (task_id, r2_key, filename, mime, bytes, uploaded_by, created_at, updated_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?6) RETURNING id`,
      ).bind(access.task.id, key, filename, mime, body.byteLength, user.id, now),
      c.env.DB.prepare(
        "INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at) VALUES (?1, ?2, 'attachment_added', NULL, ?3, ?4)",
      ).bind(access.task.id, user.id, filename, now),
    ]);
    const attachment: Attachment = {
      id: (inserted!.results as { id: number }[])[0]!.id,
      filename,
      mime,
      bytes: body.byteLength,
      uploadedBy: user.id,
      createdAt: now,
    };
    return c.json({ attachment }, 201);
  });

  // Streams the file after checking the viewer can see its task (section 11.4).
  routes.get("/attachments/:id", requireSession, async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const row = await c.env.DB.prepare("SELECT task_id, r2_key, filename, mime FROM attachments WHERE id = ?1 AND deleted_at IS NULL")
      .bind(id)
      .first<{ task_id: number; r2_key: string; filename: string; mime: string }>();
    if (!row) return forbidden(c, 404);
    const access = await guardTask(c, "task.view", row.task_id);
    if (access instanceof Response) return access;
    const object = await c.env.FILES.get(row.r2_key);
    if (!object) return forbidden(c, 404);
    const headers = new Headers({
      "Content-Type": row.mime,
      "Content-Length": String(object.size),
      // Shown in the browser, never as something else (section 11.4).
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      ETag: object.httpEtag,
    });
    // Images can't run anything; a sandbox CSP adds a second fence. PDFs open in the browser's own viewer.
    if (row.mime.startsWith("image/")) headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    return new Response(object.body, { headers });
  });

  // The uploader, a Project Admin or an App Admin deletes (section 11.14). The row first, then the object:
  // R2 and D1 can't share a transaction, and the daily clean-up retries any object left behind.
  routes.delete("/attachments/:id", requireSession, async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const row = await c.env.DB.prepare(
      "SELECT id, task_id, r2_key, filename, uploaded_by FROM attachments WHERE id = ?1 AND deleted_at IS NULL",
    )
      .bind(id)
      .first<{ id: number; task_id: number; r2_key: string; filename: string; uploaded_by: number }>();
    if (!row) return forbidden(c, 404);
    const { user } = c.get("auth");
    const access = await loadTaskAccess(c.env, row.task_id, user.id);
    if (!access) return forbidden(c, 404);
    const isAdmin = user.appRole === "admin" || access.project.role === "admin";
    if (!can(user, "task.edit", access.project) || (row.uploaded_by !== user.id && !isAdmin)) return forbidden(c, 403);
    const notConfirmed = unconfirmed(c, TASK_CONFIRM.deleteAttachment);
    if (notConfirmed) return notConfirmed;

    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE attachments SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1").bind(row.id, now),
      c.env.DB.prepare(
        "INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at) VALUES (?1, ?2, 'attachment_removed', ?3, NULL, ?4)",
      ).bind(row.task_id, user.id, row.filename, now),
      auditStatement(
        c.env,
        {
          actorId: user.id,
          action: AUDIT.attachmentDeleted,
          targetType: "attachment",
          targetId: row.id,
          detail: { task: `${access.task.project_key}-${access.task.number}`, filename: row.filename },
          ipHash: await ipHash(c),
        },
        now,
      ),
    ]);
    try {
      await c.env.FILES.delete(row.r2_key);
      await c.env.DB.prepare("UPDATE attachments SET purged_at = ?2 WHERE id = ?1").bind(row.id, Date.now()).run();
    } catch (err) {
      // The file is already gone from the task; the daily job removes the object.
      console.error(JSON.stringify({ level: "warn", message: "attachment object delete failed", attachmentId: row.id, error: String(err) }));
    }
    return c.json({ ok: true });
  });

  return routes;
}

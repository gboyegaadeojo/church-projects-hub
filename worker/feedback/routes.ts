import { type Context, Hono } from "hono";
import { ACCESS_ERRORS } from "../../shared/access";
import { ATTACHMENT_ERRORS, ATTACHMENT_MAX_BYTES, cleanFilename, FILENAME_HEADER, sniffMime } from "../../shared/attachments";
import {
  bugReportBody,
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_ERRORS,
  featureRequestBody,
  type MyFeedbackItem,
  type NewsItem,
  newsBody,
  SCREENSHOT_WINDOW_MS,
} from "../../shared/feedback";
import { rankBetween } from "../../shared/rank";
import { parseRichText, type RichTextDoc } from "../../shared/richtext";
import { AUDIT } from "../audit";
import { forbidden, idParam, requirePermission } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { can } from "../auth/permissions";
import { startOfDay } from "../lib/time";
import { ensureHubFeedback } from "../projects/routes";
import { attachmentKey } from "../tasks/attachments";
import { lastRankIn } from "../tasks/queries";
import { refreshSearchFor } from "../tasks/search";
import type { AppEnv } from "../types";

// Report a Bug / Request a Feature (FDBK-2 to FDBK-4): each lands as a task in Hub Feedback, owned by App
// Admins, with the submitter as reporter — so FDBK-5's status emails reach them. Anyone signed in may submit,
// Pending people included (section 2), up to 20 a day (RATE-3). And What's New (FDBK-1, section 11.9).

const NEW_TASK_ID = "(SELECT id FROM tasks WHERE project_id = ?1 AND number = (SELECT next_task_number - 1 FROM projects WHERE id = ?1))";

async function hubFeedback(env: Env): Promise<{ id: number; key: string } | null> {
  const find = () =>
    env.DB.prepare("SELECT id, key FROM projects WHERE is_system = 1 AND deleted_at IS NULL LIMIT 1").first<{ id: number; key: string }>();
  // PROJ-7: if it's missing, it is re-created rather than losing the report.
  return (await find()) ?? (await ensureHubFeedback(env).then(find));
}

/** Labelled sections as a Tiptap document, checked by the same validator as any description (section 11.5). */
function sectionsDoc(sections: [label: string, body: string][]) {
  const doc: RichTextDoc = {
    type: "doc",
    content: sections
      .filter(([, body]) => body.trim().length > 0)
      .flatMap(([label, body]) => [
        { type: "paragraph", content: [{ type: "text", text: label, marks: [{ type: "bold" }] }] },
        ...body
          .split(/\n+/)
          .filter((line) => line.trim())
          .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
      ]),
  };
  const parsed = parseRichText(doc, "description");
  if (!parsed.ok) throw new Error("feedback document failed validation");
  return parsed.value;
}

function firstLine(s: string, max = 100): string {
  const line = s.trim().split(/\n/)[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

async function submit(c: Context<AppEnv>, kind: "bug" | "idea", title: string, sections: [string, string][]) {
  const { user } = c.get("auth");
  if (!can(user, "feedback.submit")) return forbidden(c, 403);
  const hub = await hubFeedback(c.env);
  if (!hub) return c.json({ error: FEEDBACK_ERRORS.unavailable }, 503);

  // RATE-3: counted from the person's own reports since local midnight in their timezone (NFR-4).
  const since = startOfDay(Date.now(), user.timezone);
  const sent = await c.env.DB.prepare("SELECT count(*) AS n FROM tasks WHERE project_id = ?1 AND reporter_id = ?2 AND created_at >= ?3")
    .bind(hub.id, user.id, since)
    .first<number>("n");
  if ((sent ?? 0) >= FEEDBACK_DAILY_LIMIT) return c.json({ error: FEEDBACK_ERRORS.rateLimited }, 429);

  const state = await c.env.DB.prepare("SELECT id FROM workflow_states WHERE project_id = ?1 ORDER BY position LIMIT 1").bind(hub.id).first<number>("id");
  if (!state) return c.json({ error: FEEDBACK_ERRORS.unavailable }, 503);
  const description = sectionsDoc(sections);
  const now = Date.now();
  const rank = rankBetween(await lastRankIn(c.env, hub.id, state), null);
  const results = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = ?1").bind(hub.id),
    c.env.DB.prepare(
      `INSERT INTO tasks (project_id, number, title, description_json, description_text, type, state_id, reporter_id, rank, created_at, updated_at, created_by)
       SELECT ?1, next_task_number - 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?7 FROM projects WHERE id = ?1 RETURNING id, number`,
    ).bind(hub.id, title, JSON.stringify(description.doc), description.text, kind, state, user.id, rank, now),
    // TASK-8: the reporter watches. They can't open Hub Feedback, so they hear only about status (FDBK-5).
    c.env.DB.prepare(`INSERT OR IGNORE INTO watchers (task_id, user_id) SELECT ${NEW_TASK_ID}, ?2`).bind(hub.id, user.id),
    c.env.DB.prepare(`INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at) SELECT ${NEW_TASK_ID}, ?2, 'created', NULL, ?3, ?4`).bind(
      hub.id,
      user.id,
      String(state),
      now,
    ),
    refreshSearchFor(c.env, NEW_TASK_ID, hub.id),
  ]);
  const row = (results[1]!.results as { id: number; number: number }[])[0]!;
  return c.json({ id: row.id, key: `${hub.key}-${row.number}` }, 201);
}

function toNews(r: { id: number; title: string; body_md: string; published_at: number; updated_at: number }): NewsItem {
  return { id: r.id, title: r.title, bodyMd: r.body_md, publishedAt: r.published_at, updatedAt: r.updated_at };
}

export function feedbackRoutes() {
  const routes = new Hono<AppEnv>();

  // FDBK-2: the form also sends the page and browser it was opened from.
  routes.post("/feedback/bug", requireSession, async (c) => {
    const parsed = bugReportBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const b = parsed.data;
    return submit(c, "bug", firstLine(b.whatHappened), [
      ["What happened", b.whatHappened],
      ["What I expected", b.expected],
      ["Page", b.page],
      ["Browser", b.browser],
    ]);
  });

  // FDBK-3
  routes.post("/feedback/feature", requireSession, async (c) => {
    const parsed = featureRequestBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const b = parsed.data;
    return submit(c, "idea", b.title, [
      ["Description", b.description],
      ["Why it matters", b.why],
    ]);
  });

  // FDBK-2's optional screenshot: one image, from the person who just filed the bug, within 10 minutes.
  routes.post("/feedback/:id/screenshot", requireSession, async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const { user } = c.get("auth");
    const task = await c.env.DB.prepare(
      `SELECT t.id, t.project_id, t.created_at, (SELECT count(*) FROM attachments a WHERE a.task_id = t.id) AS files
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?1 AND p.is_system = 1 AND t.reporter_id = ?2 AND t.type = 'bug' AND t.deleted_at IS NULL`,
    )
      .bind(id, user.id)
      .first<{ id: number; project_id: number; created_at: number; files: number }>();
    if (!task) return forbidden(c, 404);
    if (task.files > 0 || Date.now() - task.created_at > SCREENSHOT_WINDOW_MS) return forbidden(c, 403);
    if (Number(c.req.header("Content-Length") ?? "0") > ATTACHMENT_MAX_BYTES) return c.json({ error: ATTACHMENT_ERRORS.tooLarge }, 413);
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength > ATTACHMENT_MAX_BYTES) return c.json({ error: ATTACHMENT_ERRORS.tooLarge }, 413);
    const mime = body.byteLength > 0 ? sniffMime(body.subarray(0, 16)) : null;
    if (!mime || !mime.startsWith("image/")) return c.json({ error: ATTACHMENT_ERRORS.unsupported }, 415);
    let filename = "screenshot";
    try {
      filename = cleanFilename(decodeURIComponent(c.req.header(FILENAME_HEADER) ?? "screenshot"));
    } catch {
      // Keep the default name.
    }
    const key = attachmentKey(task.project_id, task.id);
    await c.env.FILES.put(key, body, { httpMetadata: { contentType: mime } });
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO attachments (task_id, r2_key, filename, mime, bytes, uploaded_by, created_at, updated_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?6)`,
      ).bind(task.id, key, filename, mime, body.byteLength, user.id, now),
      c.env.DB.prepare("INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at) VALUES (?1, ?2, 'attachment_added', NULL, ?3, ?4)").bind(
        task.id,
        user.id,
        filename,
        now,
      ),
    ]);
    return c.json({ ok: true }, 201);
  });

  // The submitter's own reports and where each one stands (FDBK-5's emails link here).
  routes.get("/feedback/mine", requireSession, async (c) => {
    const { user } = c.get("auth");
    const { results } = await c.env.DB.prepare(
      `SELECT t.id, p.key || '-' || t.number AS key, t.title, t.type, s.name AS status, s.category, t.created_at
       FROM tasks t JOIN projects p ON p.id = t.project_id JOIN workflow_states s ON s.id = t.state_id
       WHERE p.is_system = 1 AND t.reporter_id = ?1 AND t.deleted_at IS NULL
       ORDER BY t.created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all<{ id: number; key: string; title: string; type: string; status: string; category: string; created_at: number }>();
    const items: MyFeedbackItem[] = results.map((r) => ({
      id: r.id,
      key: r.key,
      title: r.title,
      kind: r.type === "bug" ? "bug" : "idea",
      status: r.status,
      done: r.category === "done",
      createdAt: r.created_at,
    }));
    return c.json({ items });
  });

  // ---- What's New (FDBK-1, section 11.9)

  routes.get("/news", requireSession, async (c) => {
    const { user } = c.get("auth");
    const { results } = await c.env.DB.prepare(
      "SELECT id, title, body_md, published_at, updated_at FROM releases_news ORDER BY published_at DESC, id DESC LIMIT 100",
    ).all<{ id: number; title: string; body_md: string; published_at: number; updated_at: number }>();
    return c.json({ items: results.map(toNews), canPublish: can(user, "news.publish") });
  });

  // The dot on the Help menu: is there anything newer than the last entry this person opened?
  routes.get("/news/unread", requireSession, async (c) => {
    const { user } = c.get("auth");
    const row = await c.env.DB.prepare(
      "SELECT EXISTS (SELECT 1 FROM releases_news WHERE id > coalesce((SELECT last_news_id FROM user_news_seen WHERE user_id = ?1), 0)) AS unread",
    )
      .bind(user.id)
      .first<number>("unread");
    return c.json({ unread: row === 1 });
  });

  routes.post("/news/seen", requireSession, async (c) => {
    const { user } = c.get("auth");
    await c.env.DB.prepare(
      `INSERT INTO user_news_seen (user_id, last_news_id, seen_at)
       SELECT ?1, max(id), ?2 FROM releases_news WHERE true
       ON CONFLICT (user_id) DO UPDATE SET last_news_id = excluded.last_news_id, seen_at = excluded.seen_at`,
    )
      .bind(user.id, Date.now())
      .run()
      // Nothing published yet: max(id) is null and the NOT NULL column refuses it, which is fine.
      .catch(() => null);
    return c.json({ ok: true });
  });

  routes.post("/news", requireSession, requirePermission("news.publish"), async (c) => {
    const parsed = newsBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const { user } = c.get("auth");
    const now = Date.now();
    const [inserted] = await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO releases_news (title, body_md, published_at, created_at, updated_at, created_by) VALUES (?1, ?2, ?3, ?3, ?3, ?4) RETURNING id",
      ).bind(parsed.data.title, parsed.data.bodyMd, now, user.id),
      // Section 6 "What's New post published", pointing at the row just inserted.
      c.env.DB.prepare(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
         VALUES (?1, ?2, 'news', CAST(last_insert_rowid() AS TEXT), ?3, ?4, ?5)`,
      ).bind(user.id, AUDIT.newsPublished, JSON.stringify({ title: parsed.data.title }), await ipHash(c), now),
    ]);
    const id = (inserted!.results as { id: number }[])[0]!.id;
    return c.json({ item: toNews({ id, title: parsed.data.title, body_md: parsed.data.bodyMd, published_at: now, updated_at: now }) }, 201);
  });

  routes.patch("/news/:id", requireSession, requirePermission("news.publish"), async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const parsed = newsBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const { user } = c.get("auth");
    const now = Date.now();
    const [updated] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE releases_news SET title = ?2, body_md = ?3, updated_at = ?4 WHERE id = ?1").bind(id, parsed.data.title, parsed.data.bodyMd, now),
      c.env.DB.prepare(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
         SELECT ?1, ?2, 'news', ?3, ?4, ?5, ?6 WHERE changes() = 1`,
      ).bind(user.id, AUDIT.newsEdited, String(id), JSON.stringify({ title: parsed.data.title }), await ipHash(c), now),
    ]);
    if (updated!.meta.changes !== 1) return forbidden(c, 404);
    const row = await c.env.DB.prepare("SELECT id, title, body_md, published_at, updated_at FROM releases_news WHERE id = ?1")
      .bind(id)
      .first<{ id: number; title: string; body_md: string; published_at: number; updated_at: number }>();
    return c.json({ item: toNews(row!) });
  });

  return routes;
}

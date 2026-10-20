import { type Context, Hono } from "hono";
import { commentBody, createSubtaskBody, TASK_CONFIRM, TASK_ERRORS, TASK_LIMITS, updateSubtaskBody, type Comment, type Subtask } from "../../shared/tasks";
import { AUDIT, auditStatement } from "../audit";
import { forbidden, idParam } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import type { Action } from "../auth/permissions";
import type { AppEnv } from "../types";
import { noticesStatements } from "../notify";
import { insertMentions, mentionsIn } from "./queries";
import { guardTask, invalid, unconfirmed } from "./routes";
import { refreshSearch } from "./search";

// Subtasks (TASK-3) and comments (TASK-4). Both are checked against their task's project (NFR-1).

async function listSubtasks(env: Env, taskId: number): Promise<Subtask[]> {
  const { results } = await env.DB.prepare("SELECT id, title, done, position FROM subtasks WHERE task_id = ?1 ORDER BY position, id")
    .bind(taskId)
    .all<{ id: number; title: string; done: number; position: number }>();
  return results.map((s) => ({ id: s.id, title: s.title, done: s.done === 1, position: s.position }));
}

function historyStatement(env: Env, taskId: number, actorId: number, field: string, oldValue: string | null, newValue: string | null, at: number) {
  return env.DB.prepare(
    "INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  ).bind(taskId, actorId, field, oldValue, newValue, at);
}

/** Finds the task that owns a subtask or comment, then checks `action` on it. */
async function guardItem(c: Context<AppEnv>, table: "subtasks" | "comments", action: Action) {
  const id = idParam(c, "id");
  if (id === null) return { error: forbidden(c, 404) } as const;
  const row = await c.env.DB.prepare(
    table === "subtasks"
      ? "SELECT id, task_id, title, done, position FROM subtasks WHERE id = ?1"
      : "SELECT id, task_id, author_id, body_json FROM comments WHERE id = ?1 AND deleted_at IS NULL",
  )
    .bind(id)
    .first<{ id: number; task_id: number; title?: string; done?: number; position?: number; author_id?: number; body_json?: string }>();
  if (!row) return { error: forbidden(c, 404) } as const;
  const access = await guardTask(c, action, row.task_id);
  if (access instanceof Response) return { error: access } as const;
  return { row, access } as const;
}

export function itemRoutes() {
  const routes = new Hono<AppEnv>();

  // ---- Subtasks: a checklist inside the task, progress shown on the card (TASK-3).
  routes.post("/tasks/:id/subtasks", requireSession, async (c) => {
    const access = await guardTask(c, "task.edit");
    if (access instanceof Response) return access;
    const parsed = createSubtaskBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { user } = c.get("auth");
    const now = Date.now();
    const [inserted] = await c.env.DB.batch([
      // Inserts nothing once the task has the maximum number of items.
      c.env.DB.prepare(
        `INSERT INTO subtasks (task_id, title, done, position, created_at, updated_at, created_by)
         SELECT ?1, ?2, 0, coalesce(max(position) + 1, 0), ?3, ?3, ?4 FROM subtasks WHERE task_id = ?1 HAVING count(*) < ?5
         RETURNING id`,
      ).bind(access.task.id, parsed.data.title, now, user.id, TASK_LIMITS.subtasksPerTask),
      c.env.DB.prepare(
        `INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at)
         SELECT ?1, ?2, 'subtask_added', NULL, ?3, ?4 WHERE changes() = 1`,
      ).bind(access.task.id, user.id, parsed.data.title, now),
    ]);
    if ((inserted!.results as unknown[]).length === 0) return c.json({ error: TASK_ERRORS.tooMany }, 409);
    return c.json({ subtasks: await listSubtasks(c.env, access.task.id) }, 201);
  });

  routes.patch("/subtasks/:id", requireSession, async (c) => {
    const found = await guardItem(c, "subtasks", "task.edit");
    if ("error" in found) return found.error;
    const parsed = updateSubtaskBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { row, access } = found;
    const { user } = c.get("auth");
    const now = Date.now();
    const db = c.env.DB;
    const statements: D1PreparedStatement[] = [];
    const body = parsed.data;
    if (body.title !== undefined && body.title !== row.title) {
      statements.push(db.prepare("UPDATE subtasks SET title = ?2, updated_at = ?3 WHERE id = ?1").bind(row.id, body.title, now));
    }
    if (body.done !== undefined && body.done !== (row.done === 1)) {
      statements.push(
        db.prepare("UPDATE subtasks SET done = ?2, updated_at = ?3 WHERE id = ?1").bind(row.id, body.done ? 1 : 0, now),
        historyStatement(c.env, access.task.id, user.id, body.done ? "subtask_done" : "subtask_undone", null, body.title ?? row.title!, now),
      );
    }
    if (body.position !== undefined && body.position !== row.position) {
      // Renumber the checklist with this item at its new place.
      const current = await listSubtasks(c.env, access.task.id);
      const others = current.filter((s) => s.id !== row.id);
      const at = Math.min(body.position, others.length);
      const order = [...others.slice(0, at).map((s) => s.id), row.id, ...others.slice(at).map((s) => s.id)];
      statements.push(
        db
          .prepare(
            `UPDATE subtasks SET position = (SELECT key FROM json_each(?2) WHERE value = subtasks.id), updated_at = ?3
             WHERE task_id = ?1`,
          )
          .bind(access.task.id, JSON.stringify(order), now),
      );
    }
    if (statements.length > 0) await db.batch(statements);
    return c.json({ subtasks: await listSubtasks(c.env, access.task.id) });
  });

  routes.delete("/subtasks/:id", requireSession, async (c) => {
    const found = await guardItem(c, "subtasks", "task.edit");
    if ("error" in found) return found.error;
    const notConfirmed = unconfirmed(c, TASK_CONFIRM.deleteSubtask);
    if (notConfirmed) return notConfirmed;
    const { row, access } = found;
    const { user } = c.get("auth");
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM subtasks WHERE id = ?1").bind(row.id),
      historyStatement(c.env, access.task.id, user.id, "subtask_removed", row.title!, null, now),
      auditStatement(
        c.env,
        {
          actorId: user.id,
          action: AUDIT.subtaskDeleted,
          targetType: "subtask",
          targetId: row.id,
          detail: { task: `${access.task.project_key}-${access.task.number}`, title: row.title },
          ipHash: await ipHash(c),
        },
        now,
      ),
    ]);
    return c.json({ subtasks: await listSubtasks(c.env, access.task.id) });
  });

  // ---- Comments with @mentions (TASK-4, section 11.5). Viewers can comment (section 2).
  routes.post("/tasks/:id/comments", requireSession, async (c) => {
    const access = await guardTask(c, "task.comment");
    if (access instanceof Response) return access;
    const parsed = commentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { doc, text, mentions } = parsed.data.body;
    if (text.length === 0) return invalid(c, [{ message: "Write a comment first." }]);
    const { user } = c.get("auth");
    const now = Date.now();
    const { task, project } = access;
    // The new comment, found again within the batch by its task, author and time.
    const commentIdSql = "(SELECT id FROM comments WHERE task_id = ?6 AND author_id = ?3 AND created_at = ?4 ORDER BY id DESC LIMIT 1)";
    // NOTIF-1 / section 8: assignee, reporter and watchers hear about the comment; the people @mentioned get
    // a mention instead (never both).
    const { results: watching } = await c.env.DB.prepare("SELECT user_id FROM watchers WHERE task_id = ?1").bind(task.id).all<{ user_id: number }>();
    const followers = [task.assignee_id, task.reporter_id, ...watching.map((w) => w.user_id)].filter(
      (id): id is number => id !== null && !mentions.includes(id),
    );
    const [inserted] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO comments (task_id, author_id, body_json, body_text, created_at, updated_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?2) RETURNING id`,
      ).bind(task.id, user.id, JSON.stringify(doc), text, now),
      insertMentions(c.env, { projectId: project.id, isSystem: project.isSystem, userIds: mentions, actorId: user.id, now, taskIdSql: "?6", taskId: task.id, commentIdSql }),
      refreshSearch(c.env, task.id),
      ...noticesStatements(
        c.env,
        [
          { type: "task.mentioned", recipients: mentions, actorId: user.id, task: { id: task.id }, projectId: project.id, payload: {} },
          { type: "task.commented", recipients: followers, actorId: user.id, task: { id: task.id }, projectId: project.id, payload: {} },
        ],
        now,
      ),
    ]);
    const id = (inserted!.results as { id: number }[])[0]!.id;
    const comment: Comment = { id, authorId: user.id, body: doc, createdAt: now, editedAt: null };
    return c.json({ comment }, 201);
  });

  // Only the author edits a comment; the edit shows "edited" (TASK-4).
  routes.patch("/comments/:id", requireSession, async (c) => {
    const found = await guardItem(c, "comments", "task.comment");
    if ("error" in found) return found.error;
    const { row, access } = found;
    const { user } = c.get("auth");
    if (row.author_id !== user.id) return forbidden(c, 403);
    const parsed = commentBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { doc, text, mentions } = parsed.data.body;
    if (text.length === 0) return invalid(c, [{ message: "Write a comment first." }]);
    const now = Date.now();
    const before = mentionsIn(JSON.parse(row.body_json!));
    const added = mentions.filter((id) => !before.has(id));
    const statements = [
      c.env.DB.prepare("UPDATE comments SET body_json = ?2, body_text = ?3, edited_at = ?4, updated_at = ?4 WHERE id = ?1").bind(
        row.id,
        JSON.stringify(doc),
        text,
        now,
      ),
      refreshSearch(c.env, access.task.id),
    ];
    if (added.length > 0) {
      statements.push(
        insertMentions(c.env, {
          projectId: access.project.id,
          isSystem: access.project.isSystem,
          userIds: added,
          actorId: user.id,
          now,
          taskIdSql: "?6",
          taskId: access.task.id,
          commentIdSql: String(row.id),
        }),
        ...noticesStatements(c.env, [
          { type: "task.mentioned", recipients: added, actorId: user.id, task: { id: access.task.id }, projectId: access.project.id, payload: {} },
        ]),
      );
    }
    await c.env.DB.batch(statements);
    const { results } = await c.env.DB.prepare("SELECT created_at FROM comments WHERE id = ?1").bind(row.id).all<{ created_at: number }>();
    const comment: Comment = { id: row.id, authorId: user.id, body: doc, createdAt: results[0]!.created_at, editedAt: now };
    return c.json({ comment });
  });

  // The author, a Project Admin or an App Admin can delete a comment. Soft delete, audited (section 11.14).
  routes.delete("/comments/:id", requireSession, async (c) => {
    const found = await guardItem(c, "comments", "task.comment");
    if ("error" in found) return found.error;
    const { row, access } = found;
    const { user } = c.get("auth");
    const isAdmin = user.appRole === "admin" || access.project.role === "admin";
    if (row.author_id !== user.id && !isAdmin) return forbidden(c, 403);
    const notConfirmed = unconfirmed(c, TASK_CONFIRM.deleteComment);
    if (notConfirmed) return notConfirmed;
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE comments SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1").bind(row.id, now),
      c.env.DB.prepare("DELETE FROM mentions WHERE comment_id = ?1").bind(row.id),
      refreshSearch(c.env, access.task.id),
      auditStatement(
        c.env,
        {
          actorId: user.id,
          action: AUDIT.commentDeleted,
          targetType: "comment",
          targetId: row.id,
          detail: { task: `${access.task.project_key}-${access.task.number}`, authorId: row.author_id },
          ipHash: await ipHash(c),
        },
        now,
      ),
    ]);
    return c.json({ ok: true });
  });

  return routes;
}

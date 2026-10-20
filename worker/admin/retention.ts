import { type Context, Hono } from "hono";
import { ADMIN_ERRORS, DELETION_CONFIRM, type DeletionRequestRow, RETENTION_MS, type RetentionResponse } from "../../shared/admin";
import { AUDIT, auditStatement } from "../audit";
import { forbidden, idParam, requireConfirmation, requirePermission } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";

// Data deletion requests (ADM-6) and the retention purge (ADM-8). Nothing is ever deleted automatically: a
// person asks, or six months pass, and an App Admin confirms each one with type-to-confirm (section 11.14).
// The "Eligible for deletion" queue is computed when it's opened, which lists exactly what a daily job would,
// without storing a copy that can go stale.

/**
 * ADM-6: the person's name, email, avatar and Google id become "Deleted User [ID]"; their tasks and comments
 * stay under that name; sessions end; memberships, watches, settings, bell and unsent emails go. The audit
 * entries about them are kept (section 6). Everything in one batch.
 */
export function anonymiseStatements(env: Pick<Env, "DB">, userId: number, now: number): D1PreparedStatement[] {
  const db = env.DB;
  return [
    db.prepare(
      `UPDATE users SET name = 'Deleted User ' || id, email = 'Deleted User ' || id, google_sub = 'Deleted User ' || id, avatar_url = NULL,
         app_role = 'member', status = 'suspended', suspended_at = coalesce(suspended_at, ?2), deleted_at = ?2, updated_at = ?2
       WHERE id = ?1`,
    ).bind(userId, now),
    db.prepare("UPDATE sessions SET revoked_at = ?2, updated_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL").bind(userId, now),
    db.prepare("DELETE FROM project_members WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM watchers WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM notification_prefs WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM user_news_seen WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM notifications WHERE user_id = ?1").bind(userId),
    db.prepare("UPDATE email_outbox SET status = 'failed', last_error = 'User deleted', payload_json = '{}' WHERE user_id = ?1 AND status = 'pending'").bind(userId),
    db.prepare("UPDATE access_requests SET status = 'withdrawn', updated_at = ?2 WHERE user_id = ?1 AND status = 'pending'").bind(userId, now),
    db.prepare("UPDATE data_deletion_requests SET status = 'completed', updated_at = ?2 WHERE user_id = ?1 AND status IN ('pending', 'approved')").bind(userId, now),
  ];
}

const TASKS = "(SELECT id FROM tasks WHERE project_id = ?1)";

/** ADM-8 for an archived project: its tasks and everything under them, then the project's own lists. */
export function purgeProjectStatements(env: Pick<Env, "DB">, projectId: number, now: number): D1PreparedStatement[] {
  const db = env.DB;
  const run = (sql: string) => db.prepare(sql).bind(projectId);
  return [
    ...["task_labels", "subtasks", "mentions", "comments", "watchers", "task_events", "notifications"].map((t) => run(`DELETE FROM ${t} WHERE task_id IN ${TASKS}`)),
    // Rows only; the daily R2 clean-up removes objects that no row points to (worker/jobs/orphans.ts).
    run(`DELETE FROM attachments WHERE task_id IN ${TASKS}`),
    run(`DELETE FROM tasks_fts WHERE rowid IN ${TASKS}`),
    run("UPDATE tasks SET epic_id = NULL WHERE project_id = ?1"),
    run("DELETE FROM tasks WHERE project_id = ?1"),
    ...["labels", "components", "milestones", "workflow_states", "saved_filters", "invites", "access_requests", "project_members"].map((t) => run(`DELETE FROM ${t} WHERE project_id = ?1`)),
    run("DELETE FROM report_snapshots WHERE project_id = ?1"),
    // The row stays, emptied, so its key isn't reused by a new project that old links would then open.
    db.prepare("UPDATE projects SET name = 'Deleted project', description = '', hidden = 1, deleted_at = ?2, updated_at = ?2 WHERE id = ?1").bind(projectId, now),
  ];
}

async function isLastAdmin(env: Env, userId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT (SELECT app_role = 'admin' AND status = 'active' FROM users WHERE id = ?1) AS is_admin,
            (SELECT count(*) FROM users WHERE app_role = 'admin' AND status = 'active' AND deleted_at IS NULL AND id != ?1) AS others`,
  )
    .bind(userId)
    .first<{ is_admin: number | null; others: number }>();
  return row?.is_admin === 1 && row.others === 0;
}

type DeletionDbRow = {
  id: number;
  user_id: number;
  name: string;
  email: string;
  app_role: "admin" | "member";
  status: DeletionRequestRow["status"];
  requested_at: number;
  decided_at: number | null;
  decided_by: string | null;
};

async function loadRequest(c: Context<AppEnv>) {
  const id = idParam(c, "id");
  if (id === null) return null;
  return c.env.DB.prepare("SELECT id, user_id, status FROM data_deletion_requests WHERE id = ?1").bind(id).first<{ id: number; user_id: number; status: string }>();
}

export function retentionRoutes() {
  const routes = new Hono<AppEnv>();
  const admin = [requireSession, requirePermission("user.manage")] as const;

  // ---- The person's own request (any signed-in status may ask; section 2 matrix).
  routes.get("/me/deletion-request", requireSession, async (c) => {
    const { user } = c.get("auth");
    const row = await c.env.DB.prepare("SELECT status, requested_at, decided_at FROM data_deletion_requests WHERE user_id = ?1 ORDER BY id DESC LIMIT 1")
      .bind(user.id)
      .first<{ status: DeletionRequestRow["status"]; requested_at: number; decided_at: number | null }>();
    return c.json({ request: row ? { status: row.status, requestedAt: row.requested_at, decidedAt: row.decided_at } : null });
  });

  routes.post("/me/deletion-request", requireSession, requirePermission("data.requestDeletion"), requireConfirmation(DELETION_CONFIRM.request), async (c) => {
    const { user } = c.get("auth");
    const now = Date.now();
    const [inserted] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO data_deletion_requests (user_id, requested_at, status, created_at, updated_at, created_by)
         SELECT ?1, ?2, 'pending', ?2, ?2, ?1 WHERE NOT EXISTS (SELECT 1 FROM data_deletion_requests WHERE user_id = ?1 AND status = 'pending')`,
      ).bind(user.id, now),
      c.env.DB.prepare("UPDATE users SET deletion_requested_at = ?2, updated_at = ?2 WHERE id = ?1 AND changes() = 1").bind(user.id, now),
      c.env.DB.prepare(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
         SELECT ?1, ?2, 'user', CAST(CAST(?1 AS INTEGER) AS TEXT), '{}', ?3, ?4 WHERE EXISTS (SELECT 1 FROM data_deletion_requests WHERE user_id = ?1 AND requested_at = ?4)`,
      ).bind(user.id, AUDIT.deletionRequested, await ipHash(c), now),
    ]);
    return c.json({ ok: true }, inserted!.meta.changes === 1 ? 201 : 200);
  });

  // ---- ADM-6 queue for App Admins: pending first, then the last 90 days of decisions.
  routes.get("/admin/deletions", ...admin, async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.user_id, u.name, u.email, u.app_role, r.status, r.requested_at, r.decided_at, d.name AS decided_by
       FROM data_deletion_requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by
       WHERE r.status = 'pending' OR r.requested_at >= ?1
       ORDER BY r.status = 'pending' DESC, r.requested_at DESC LIMIT 200`,
    )
      .bind(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .all<DeletionDbRow>();
    const requests: DeletionRequestRow[] = results.map((r) => ({
      id: r.id,
      user: { id: r.user_id, name: r.name, email: r.email, appRole: r.app_role },
      status: r.status,
      requestedAt: r.requested_at,
      decidedAt: r.decided_at,
      decidedBy: r.decided_by,
    }));
    return c.json({ requests });
  });

  routes.post("/admin/deletions/:id/approve", ...admin, requireConfirmation(DELETION_CONFIRM.approve), async (c) => {
    const request = await loadRequest(c);
    if (!request) return forbidden(c, 404);
    if (request.status !== "pending") return c.json({ error: "already_decided" }, 409);
    const { user } = c.get("auth");
    if (request.user_id === user.id) return c.json({ error: ADMIN_ERRORS.self }, 409);
    if (await isLastAdmin(c.env, request.user_id)) return c.json({ error: ADMIN_ERRORS.lastAdmin }, 409);
    const now = Date.now();
    const ip = await ipHash(c);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE data_deletion_requests SET status = 'approved', decided_by = ?2, decided_at = ?3, updated_at = ?3 WHERE id = ?1").bind(request.id, user.id, now),
      auditStatement(c.env, { actorId: user.id, action: AUDIT.deletionApproved, targetType: "user", targetId: request.user_id, detail: { request: request.id }, ipHash: ip }, now),
      ...anonymiseStatements(c.env, request.user_id, now),
      auditStatement(c.env, { actorId: user.id, action: AUDIT.deletionCompleted, targetType: "user", targetId: request.user_id, detail: { request: request.id }, ipHash: ip }, now),
    ]);
    return c.json({ ok: true });
  });

  routes.post("/admin/deletions/:id/reject", ...admin, async (c) => {
    const request = await loadRequest(c);
    if (!request) return forbidden(c, 404);
    if (request.status !== "pending") return c.json({ error: "already_decided" }, 409);
    const { user } = c.get("auth");
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE data_deletion_requests SET status = 'rejected', decided_by = ?2, decided_at = ?3, updated_at = ?3 WHERE id = ?1").bind(request.id, user.id, now),
      c.env.DB.prepare("UPDATE users SET deletion_requested_at = NULL, updated_at = ?2 WHERE id = ?1").bind(request.user_id, now),
      auditStatement(c.env, { actorId: user.id, action: AUDIT.deletionRejected, targetType: "user", targetId: request.user_id, detail: { request: request.id }, ipHash: await ipHash(c) }, now),
    ]);
    return c.json({ ok: true });
  });

  // ---- ADM-8 "Eligible for deletion": archived projects and suspended users past six months.
  routes.get("/admin/retention", ...admin, async (c) => {
    const cutoff = Date.now() - RETENTION_MS;
    const [projects, users] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT p.id, p.key, p.name, p.archived_at, (SELECT count(*) FROM tasks t WHERE t.project_id = p.id) AS tasks
         FROM projects p WHERE p.archived_at IS NOT NULL AND p.archived_at <= ?1 AND p.deleted_at IS NULL AND p.is_system = 0 ORDER BY p.archived_at`,
      ).bind(cutoff),
      c.env.DB.prepare(
        `SELECT id, name, email, suspended_at FROM users
         WHERE status = 'suspended' AND suspended_at IS NOT NULL AND suspended_at <= ?1 AND deleted_at IS NULL ORDER BY suspended_at`,
      ).bind(cutoff),
    ]);
    const body: RetentionResponse = {
      projects: (projects!.results as { id: number; key: string; name: string; archived_at: number; tasks: number }[]).map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        archivedAt: p.archived_at,
        tasks: p.tasks,
      })),
      users: (users!.results as { id: number; name: string; email: string; suspended_at: number }[]).map((u) => ({ id: u.id, name: u.name, email: u.email, suspendedAt: u.suspended_at })),
    };
    return c.json(body);
  });

  routes.post("/admin/retention/projects/:id/purge", ...admin, requireConfirmation(DELETION_CONFIRM.purge), async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const project = await c.env.DB.prepare(
      "SELECT key FROM projects WHERE id = ?1 AND archived_at IS NOT NULL AND archived_at <= ?2 AND deleted_at IS NULL AND is_system = 0",
    )
      .bind(id, Date.now() - RETENTION_MS)
      .first<{ key: string }>();
    if (!project) return forbidden(c, 404);
    const { user } = c.get("auth");
    const now = Date.now();
    await c.env.DB.batch([
      ...purgeProjectStatements(c.env, id, now),
      auditStatement(c.env, { actorId: user.id, action: AUDIT.retentionPurged, targetType: "project", targetId: id, detail: { key: project.key }, ipHash: await ipHash(c) }, now),
    ]);
    return c.json({ ok: true });
  });

  routes.post("/admin/retention/users/:id/purge", ...admin, requireConfirmation(DELETION_CONFIRM.purge), async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const eligible = await c.env.DB.prepare("SELECT 1 FROM users WHERE id = ?1 AND status = 'suspended' AND suspended_at <= ?2 AND deleted_at IS NULL")
      .bind(id, Date.now() - RETENTION_MS)
      .first();
    if (!eligible) return forbidden(c, 404);
    const { user } = c.get("auth");
    const now = Date.now();
    await c.env.DB.batch([
      ...anonymiseStatements(c.env, id, now),
      auditStatement(c.env, { actorId: user.id, action: AUDIT.retentionPurged, targetType: "user", targetId: id, detail: {}, ipHash: await ipHash(c) }, now),
    ]);
    return c.json({ ok: true });
  });

  return routes;
}

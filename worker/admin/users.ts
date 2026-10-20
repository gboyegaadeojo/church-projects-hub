import { type Context, Hono } from "hono";
import { ACCESS_ERRORS } from "../../shared/access";
import { ADMIN_CONFIRM, ADMIN_ERRORS, type AdminUserDetail, type AdminUserRow, appRoleBody, USER_SORTS, type UserSort } from "../../shared/admin";
import { AUDIT, auditStatement } from "../audit";
import { forbidden, idParam, requireConfirmation, requirePermission } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { noticeStatements } from "../notify";
import type { AppEnv } from "../types";

// The user directory (ADM-2, section 11.12): search, view projects and roles, suspend, restore, App Admin
// role, and signing someone out everywhere. App Admins only. Safety rules (section 2): the last App Admin
// can't be demoted or suspended, and a suspended user's sessions end at once — checkSession refuses a
// suspended user on their very next request, and their sessions are revoked here as well.

const PAGE_SIZE = 50;

const SORT_SQL: Record<UserSort, string> = {
  name: "u.name COLLATE NOCASE",
  email: "u.email COLLATE NOCASE",
  status: "u.status",
  lastSeen: "coalesce(u.last_seen_at, 0)",
  joined: "u.created_at",
};

type UserRow = {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  app_role: "admin" | "member";
  status: "pending" | "active" | "suspended";
  last_seen_at: number | null;
  created_at: number;
  project_count: number;
  timezone: string;
};

const USER_COLUMNS = `u.id, u.name, u.email, u.avatar_url, u.app_role, u.status, u.last_seen_at, u.created_at, u.timezone,
  (SELECT count(*) FROM project_members m JOIN projects p ON p.id = m.project_id WHERE m.user_id = u.id AND p.deleted_at IS NULL) AS project_count`;

function toRow(r: UserRow): AdminUserRow {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    avatarUrl: r.avatar_url,
    appRole: r.app_role,
    status: r.status,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at,
    projectCount: r.project_count,
  };
}

/** "Chrome on Windows" from a user agent; never the raw string (it can be long and identifying). */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}

async function loadUser(env: Env, id: number) {
  return env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?1 AND u.deleted_at IS NULL`).bind(id).first<UserRow>();
}

async function otherActiveAdmins(env: Env, id: number): Promise<number> {
  return (
    (await env.DB.prepare("SELECT count(*) AS n FROM users WHERE app_role = 'admin' AND status = 'active' AND deleted_at IS NULL AND id != ?1")
      .bind(id)
      .first<number>("n")) ?? 0
  );
}

async function target(c: Context<AppEnv>) {
  const id = idParam(c, "id");
  return id === null ? null : loadUser(c.env, id);
}

export function adminUserRoutes() {
  const routes = new Hono<AppEnv>();
  const guard = [requireSession, requirePermission("user.manage")] as const;

  routes.get("/admin/users", ...guard, async (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 100);
    const status = c.req.query("status");
    const sort: UserSort = (USER_SORTS as readonly string[]).includes(c.req.query("sort") ?? "") ? (c.req.query("sort") as UserSort) : "name";
    const desc = c.req.query("dir") === "desc";
    const page = Math.max(1, Number(c.req.query("page")) || 1);
    const where = [
      "u.deleted_at IS NULL",
      ...(q ? ["(lower(u.name) LIKE ?1 ESCAPE '\\' OR lower(u.email) LIKE ?1 ESCAPE '\\')"] : []),
      ...(status === "pending" || status === "active" || status === "suspended" ? [`u.status = '${status}'`] : []),
      ...(c.req.query("role") === "admin" ? ["u.app_role = 'admin'"] : []),
    ].join(" AND ");
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const bind = q ? [like] : [];
    const [rows, total] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT ${USER_COLUMNS} FROM users u WHERE ${where}
         ORDER BY ${SORT_SQL[sort]} ${desc ? "DESC" : "ASC"}, u.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      ).bind(...bind),
      c.env.DB.prepare(`SELECT count(*) AS n FROM users u WHERE ${where}`).bind(...bind),
    ]);
    return c.json({ users: (rows!.results as UserRow[]).map(toRow), total: (total!.results as { n: number }[])[0]!.n });
  });

  routes.get("/admin/users/:id", ...guard, async (c) => {
    const user = await target(c);
    if (!user) return forbidden(c, 404);
    const [memberships, sessions] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT p.id, p.key, p.name, m.role FROM project_members m JOIN projects p ON p.id = m.project_id
         WHERE m.user_id = ?1 AND p.deleted_at IS NULL ORDER BY p.name COLLATE NOCASE`,
      ).bind(user.id),
      c.env.DB.prepare(
        "SELECT created_at, expires_at, user_agent FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2 ORDER BY created_at DESC",
      ).bind(user.id, Date.now()),
    ]);
    const body: AdminUserDetail = {
      ...toRow(user),
      timezone: user.timezone,
      memberships: (memberships!.results as { id: number; key: string; name: string; role: "admin" | "contributor" | "viewer" }[]).map((m) => ({
        projectId: m.id,
        key: m.key,
        name: m.name,
        role: m.role,
      })),
      activeSessions: (sessions!.results as { created_at: number; expires_at: number; user_agent: string | null }[]).map((s) => ({
        createdAt: s.created_at,
        expiresAt: s.expires_at,
        device: deviceLabel(s.user_agent),
      })),
    };
    return c.json(body);
  });

  // App Admin role. Demoting the last active App Admin is refused (section 2 safety rule).
  routes.patch("/admin/users/:id/role", ...guard, async (c) => {
    const parsed = appRoleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid }, 400);
    const user = await target(c);
    if (!user) return forbidden(c, 404);
    const { user: actor } = c.get("auth");
    if (user.app_role === parsed.data.appRole) return c.json({ ok: true });
    if (parsed.data.appRole === "member" && user.status === "active" && (await otherActiveAdmins(c.env, user.id)) === 0) {
      return c.json({ error: ADMIN_ERRORS.lastAdmin }, 409);
    }
    if (user.status !== "active" && parsed.data.appRole === "admin") return c.json({ error: ACCESS_ERRORS.invalid }, 400);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET app_role = ?2, updated_at = ?3 WHERE id = ?1").bind(user.id, parsed.data.appRole, now),
      auditStatement(
        c.env,
        { actorId: actor.id, action: AUDIT.appRoleChanged, targetType: "user", targetId: user.id, detail: { from: user.app_role, to: parsed.data.appRole }, ipHash: await ipHash(c) },
        now,
      ),
    ]);
    return c.json({ ok: true });
  });

  // Suspend (high impact: type-to-confirm in the UI, X-Confirm-Action here). Ends every session in the same batch.
  routes.post("/admin/users/:id/suspend", ...guard, requireConfirmation(ADMIN_CONFIRM.suspend), async (c) => {
    const user = await target(c);
    if (!user) return forbidden(c, 404);
    const { user: actor } = c.get("auth");
    if (user.id === actor.id) return c.json({ error: ADMIN_ERRORS.self }, 409);
    if (user.status === "suspended") return c.json({ ok: true });
    if (user.app_role === "admin" && (await otherActiveAdmins(c.env, user.id)) === 0) return c.json({ error: ADMIN_ERRORS.lastAdmin }, 409);
    const now = Date.now();
    const ip = await ipHash(c);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET status = 'suspended', suspended_at = ?2, updated_at = ?2 WHERE id = ?1").bind(user.id, now),
      c.env.DB.prepare("UPDATE sessions SET revoked_at = ?2, updated_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL").bind(user.id, now),
      auditStatement(c.env, { actorId: actor.id, action: AUDIT.userSuspended, targetType: "user", targetId: user.id, detail: { previousStatus: user.status }, ipHash: ip }, now),
    ]);
    return c.json({ ok: true });
  });

  // Restore: back to Active if they had been approved (they hold a project or are an App Admin), else Pending.
  routes.post("/admin/users/:id/restore", ...guard, async (c) => {
    const user = await target(c);
    if (!user) return forbidden(c, 404);
    if (user.status !== "suspended") return c.json({ ok: true });
    const { user: actor } = c.get("auth");
    const status = user.project_count > 0 || user.app_role === "admin" ? "active" : "pending";
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET status = ?2, suspended_at = NULL, updated_at = ?3 WHERE id = ?1").bind(user.id, status, now),
      auditStatement(c.env, { actorId: actor.id, action: AUDIT.userRestored, targetType: "user", targetId: user.id, detail: { status }, ipHash: await ipHash(c) }, now),
    ]);
    return c.json({ ok: true, status });
  });

  // "Revoke another user's session" (section 2): signs them out on every device, audited, and emailed (section 8).
  routes.post("/admin/users/:id/revoke-sessions", requireSession, requirePermission("session.revoke"), requireConfirmation(ADMIN_CONFIRM.revokeSessions), async (c) => {
    const user = await target(c);
    if (!user) return forbidden(c, 404);
    const { user: actor } = c.get("auth");
    if (user.id === actor.id) return c.json({ error: ADMIN_ERRORS.self }, 409);
    const now = Date.now();
    const [revoked] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE sessions SET revoked_at = ?2, updated_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2").bind(user.id, now),
      c.env.DB.prepare(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
         SELECT ?1, ?2, 'user', ?3, json_object('reason', 'admin', 'sessions', changes()), ?4, ?5 WHERE changes() > 0`,
      ).bind(actor.id, AUDIT.sessionRevoked, String(user.id), await ipHash(c), now),
      ...noticeStatements(
        c.env,
        {
          type: "session.revoked",
          recipients: [user.id],
          actorId: actor.id,
          payload: {},
          onlyIf: `EXISTS (SELECT 1 FROM audit_log WHERE action = '${AUDIT.sessionRevoked}' AND target_id = '${user.id}' AND at = ${now})`,
        },
        now,
      ),
    ]);
    return c.json({ ok: true, revoked: revoked!.meta.changes });
  });

  return routes;
}

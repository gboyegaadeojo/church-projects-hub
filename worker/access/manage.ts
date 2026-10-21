import { type Context, Hono } from "hono";
import { ACCESS_ERRORS, INVITE_TTL_MS } from "../../shared/access";
import { type InviteRow, type InviteStatus, MANAGE_CONFIRM, type MemberRow, memberRoleBody, ROLE_RANK } from "../../shared/admin";
import { AUDIT, auditStatement } from "../audit";
import { authorize, forbidden, idParam, requireConfirmation } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { can } from "../auth/permissions";
import { randomToken, sha256Base64url } from "../lib/crypto";
import type { AppEnv } from "../types";

// Invite management (ADM-7, section 11.12) and project members (section 2 "Change member roles").
// App Admins manage every team project; Project Admins their own. Cancelling an invite, removing a member and
// lowering a role go through the confirmation dialog (section 11.14). Everything is audited (section 6).

type InviteDbRow = {
  id: number;
  email: string;
  role: InviteRow["role"];
  project_id: number;
  project_key: string;
  project_name: string;
  sent_by: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  cancelled_at: number | null;
};

function inviteStatus(r: Pick<InviteDbRow, "used_at" | "cancelled_at" | "expires_at">, now: number): InviteStatus {
  if (r.used_at !== null) return "used";
  if (r.cancelled_at !== null) return "cancelled";
  return r.expires_at <= now ? "expired" : "pending";
}

const INVITE_SQL = `
  SELECT i.id, i.email, i.role, i.project_id, p.key AS project_key, p.name AS project_name, u.name AS sent_by,
         i.created_at, i.expires_at, i.used_at, i.cancelled_at
  FROM invites i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.invited_by
  WHERE p.deleted_at IS NULL`;

/** Loads an invite the signed-in person may manage (they could create invites for its project). */
async function manageableInvite(c: Context<AppEnv>): Promise<InviteDbRow | Response> {
  const id = idParam(c, "id");
  if (id === null) return forbidden(c, 404);
  const row = await c.env.DB.prepare(`${INVITE_SQL} AND i.id = ?1`).bind(id).first<InviteDbRow>();
  if (!row) return forbidden(c, 404);
  const allowed = await authorize(c, "invite.create", row.project_id);
  return allowed.ok ? row : forbidden(c, allowed.status);
}

type MemberDbRow = { user_id: number; name: string; email: string; avatar_url: string | null; role: MemberRow["role"]; created_at: number };

export function manageRoutes() {
  const routes = new Hono<AppEnv>();

  // ADM-7: outstanding and recent invites (last 90 days) for every project the person can invite to.
  routes.get("/invites", requireSession, async (c) => {
    const { user } = c.get("auth");
    if (user.status !== "active") return forbidden(c, 403);
    const now = Date.now();
    const scope = user.appRole === "admin" ? "" : "AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = i.project_id AND m.user_id = ?2 AND m.role = 'admin')";
    const { results } = await c.env.DB.prepare(`${INVITE_SQL} AND p.is_system = 0 AND i.created_at >= ?1 ${scope} ORDER BY i.created_at DESC LIMIT 200`)
      .bind(...[now - 90 * 24 * 60 * 60 * 1000, ...(scope ? [user.id] : [])])
      .all<InviteDbRow>();
    const invites: InviteRow[] = results.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      project: { id: r.project_id, key: r.project_key, name: r.project_name },
      sentBy: r.sent_by,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      status: inviteStatus(r, now),
    }));
    return c.json({ invites });
  });

  routes.post("/invites/:id/cancel", requireSession, requireConfirmation(MANAGE_CONFIRM.cancelInvite), async (c) => {
    const invite = await manageableInvite(c);
    if (invite instanceof Response) return invite;
    const now = Date.now();
    if (inviteStatus(invite, now) !== "pending") return c.json({ error: ACCESS_ERRORS.alreadyDecided }, 409);
    const { user } = c.get("auth");
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE invites SET cancelled_at = ?2, updated_at = ?2 WHERE id = ?1 AND used_at IS NULL AND cancelled_at IS NULL").bind(invite.id, now),
      auditStatement(
        c.env,
        { actorId: user.id, action: AUDIT.inviteCancelled, targetType: "invite", targetId: invite.id, detail: { projectKey: invite.project_key, role: invite.role }, ipHash: await ipHash(c) },
        now,
      ),
    ]);
    return c.json({ ok: true });
  });

  // Resend an expired invite (section 2: "Project admins can resend"): a fresh link for 7 more days, emailed again.
  routes.post("/invites/:id/resend", requireSession, async (c) => {
    const invite = await manageableInvite(c);
    if (invite instanceof Response) return invite;
    const now = Date.now();
    if (inviteStatus(invite, now) !== "expired") return c.json({ error: ACCESS_ERRORS.alreadyDecided }, 409);
    const { user } = c.get("auth");
    const token = randomToken(32);
    const expiresAt = now + INVITE_TTL_MS;
    const link = `${c.env.APP_BASE_URL}/invite/${token}`;
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE invites SET token = ?2, expires_at = ?3, invited_by = ?4, updated_at = ?5 WHERE id = ?1").bind(
        invite.id,
        await sha256Base64url(token),
        expiresAt,
        user.id,
        now,
      ),
      auditStatement(
        c.env,
        { actorId: user.id, action: AUDIT.inviteResent, targetType: "invite", targetId: invite.id, detail: { projectKey: invite.project_key, role: invite.role }, ipHash: await ipHash(c) },
        now,
      ),
      c.env.DB.prepare(
        `INSERT INTO email_outbox (user_id, to_email, template, payload_json, mode, send_after, created_at)
         VALUES (NULL, ?1, 'invite', ?2, 'instant', ?3, ?3)`,
      ).bind(invite.email, JSON.stringify({ link, projectName: invite.project_name, role: invite.role, actorName: user.name, expiresAt }), now),
    ]);
    return c.json({ link, expiresAt });
  });

  // ---- Members of one project. Anyone who can see the project sees the list (PROJ-5).
  routes.get("/projects/:id/members", requireSession, async (c) => {
    const projectId = idParam(c, "id");
    const allowed = await authorize(c, "task.view", projectId);
    if (!allowed.ok) return forbidden(c, allowed.status);
    const { results } = await c.env.DB.prepare(
      `SELECT m.user_id, u.name, u.email, u.avatar_url, m.role, m.created_at
       FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ?1 AND u.deleted_at IS NULL
       ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'contributor' THEN 1 ELSE 2 END, u.name COLLATE NOCASE`,
    )
      .bind(projectId)
      .all<MemberDbRow>();
    const { user } = c.get("auth");
    // Shown to people who can change at least a non-admin's role; the API checks each change.
    const canManage = can(user, "member.changeRole", allowed.project, { targetMemberRole: "viewer" });
    const members: MemberRow[] = results.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, avatarUrl: r.avatar_url, role: r.role, addedAt: r.created_at }));
    return c.json({ members, canManage });
  });

  async function memberTarget(c: Context<AppEnv>) {
    const projectId = idParam(c, "id");
    const userId = idParam(c, "userId");
    if (projectId === null || userId === null) return forbidden(c, 404);
    const member = await c.env.DB.prepare(
      "SELECT m.role, p.key FROM project_members m JOIN projects p ON p.id = m.project_id WHERE m.project_id = ?1 AND m.user_id = ?2",
    )
      .bind(projectId, userId)
      .first<{ role: MemberRow["role"]; key: string }>();
    if (!member) return forbidden(c, 404);
    const allowed = await authorize(c, "member.changeRole", projectId, { targetMemberRole: member.role });
    if (!allowed.ok) return forbidden(c, allowed.status);
    return { projectId, userId, ...member };
  }

  /**
   * v4.7: a Project Admin can't leave their project without an admin (demoting or removing the last one, themselves
   * included). App Admins manage every project, so they may.
   */
  async function wouldLeaveNoAdmin(c: Context<AppEnv>, target: { projectId: number; role: MemberRow["role"] }) {
    if (c.get("auth").user.appRole === "admin" || target.role !== "admin") return false;
    const row = await c.env.DB.prepare("SELECT count(*) AS n FROM project_members WHERE project_id = ?1 AND role = 'admin'").bind(target.projectId).first<{ n: number }>();
    return (row?.n ?? 0) <= 1;
  }

  routes.patch("/projects/:id/members/:userId", requireSession, async (c) => {
    const parsed = memberRoleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid }, 400);
    const target = await memberTarget(c);
    if (target instanceof Response) return target;
    const { user } = c.get("auth");
    if (parsed.data.role === target.role) return c.json({ ok: true });
    if (await wouldLeaveNoAdmin(c, target)) return c.json({ error: ACCESS_ERRORS.lastProjectAdmin }, 409);
    if (ROLE_RANK[parsed.data.role] < ROLE_RANK[target.role] && c.req.header("X-Confirm-Action") !== MANAGE_CONFIRM.lowerRole) {
      return c.json({ error: ACCESS_ERRORS.confirmationRequired }, 428);
    }
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE project_members SET role = ?3, updated_at = ?4 WHERE project_id = ?1 AND user_id = ?2").bind(target.projectId, target.userId, parsed.data.role, now),
      auditStatement(
        c.env,
        {
          actorId: user.id,
          action: AUDIT.memberRoleChanged,
          targetType: "project",
          targetId: target.projectId,
          detail: { key: target.key, userId: target.userId, from: target.role, to: parsed.data.role },
          ipHash: await ipHash(c),
        },
        now,
      ),
    ]);
    return c.json({ ok: true });
  });

  routes.delete("/projects/:id/members/:userId", requireSession, requireConfirmation(MANAGE_CONFIRM.removeMember), async (c) => {
    const target = await memberTarget(c);
    if (target instanceof Response) return target;
    if (await wouldLeaveNoAdmin(c, target)) return c.json({ error: ACCESS_ERRORS.lastProjectAdmin }, 409);
    const { user } = c.get("auth");
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM project_members WHERE project_id = ?1 AND user_id = ?2").bind(target.projectId, target.userId),
      // They stop watching the project's tasks; their tasks and comments stay.
      c.env.DB.prepare("DELETE FROM watchers WHERE user_id = ?2 AND task_id IN (SELECT id FROM tasks WHERE project_id = ?1)").bind(target.projectId, target.userId),
      auditStatement(
        c.env,
        { actorId: user.id, action: AUDIT.memberRemoved, targetType: "project", targetId: target.projectId, detail: { key: target.key, userId: target.userId, role: target.role }, ipHash: await ipHash(c) },
        now,
      ),
    ]);
    return c.json({ ok: true });
  });

  return routes;
}

/**
 * Daily (section 6 "invite expired"): one audit row for each invite that expired unused since the last run.
 * Written by the system, once per invite.
 */
export function inviteExpiryStatement(env: Pick<Env, "DB">, now: number) {
  return env.DB.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
     SELECT NULL, ?1, 'invite', CAST(i.id AS TEXT), json_object('projectId', i.project_id, 'role', i.role), NULL, ?2
     FROM invites i
     WHERE i.used_at IS NULL AND i.cancelled_at IS NULL AND i.expires_at <= ?2 AND i.expires_at > ?2 - 8 * 86400000
       AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.action = ?1 AND a.target_type = 'invite' AND a.target_id = CAST(i.id AS TEXT) AND a.at >= i.expires_at)`,
  ).bind(AUDIT.inviteExpired, now);
}

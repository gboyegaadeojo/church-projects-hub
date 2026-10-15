import { Hono } from "hono";
import {
  ACCESS_ERRORS,
  createInviteBody,
  INVITE_TTL_MS,
  type InviteLookup,
  type InviteOutcome,
  inviteToken,
  type ProjectRole,
} from "../../shared/access";
import { AUDIT } from "../audit";
import { forbidden, idParam, requirePermission } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { randomToken, sha256Base64url } from "../lib/crypto";
import type { AppEnv } from "../types";

// Invites (AUTH-9): pre-approved for one project and role, single-use, 7 days, tied to the invited email.
// The link carries a random 256-bit token; the table stores only its SHA-256.

type InviteRow = {
  id: number;
  project_id: number;
  project_key: string;
  project_name: string;
  role: ProjectRole;
  email: string;
  invited_by: number;
  expires_at: number;
  used_at: number | null;
  project_open: number;
};

async function findInvite(env: Env, token: string): Promise<InviteRow | null> {
  return env.DB.prepare(
    `SELECT i.id, i.project_id, p.key AS project_key, p.name AS project_name, i.role, i.email, i.invited_by,
            i.expires_at, i.used_at,
            (p.archived_at IS NULL AND p.deleted_at IS NULL AND p.is_system = 0) AS project_open
     FROM invites i JOIN projects p ON p.id = i.project_id
     WHERE i.token = ?1`,
  )
    .bind(await sha256Base64url(token))
    .first<InviteRow>();
}

function usable(invite: InviteRow | null, now: number): invite is InviteRow {
  return !!invite && invite.used_at === null && invite.expires_at > now && invite.project_open === 1;
}

/**
 * Accept an invite for a signed-in person. Atomic: the invite is marked used only once, and only that
 * winning request adds the membership, activates a Pending user and writes "invite used".
 * A different email (case-insensitive) leaves the invite untouched.
 */
export async function redeemInvite(
  env: Env,
  params: { token: string; user: { id: number; email: string }; ipHash: string | null; now: number },
): Promise<InviteOutcome> {
  if (!inviteToken.safeParse(params.token).success) return "expired";
  const invite = await findInvite(env, params.token);
  if (!usable(invite, params.now)) return "expired";
  if (invite.email.toLowerCase() !== params.user.email.trim().toLowerCase()) return "mismatch";

  const { now } = params;
  // Steps 2–4 run only if step 1 marked the invite used in this batch.
  const won = (idParam: string, nowParam: string) =>
    `EXISTS (SELECT 1 FROM invites WHERE id = ${idParam} AND used_at = ${nowParam})`;
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE invites SET used_at = ?2, updated_at = ?2 WHERE id = ?1 AND used_at IS NULL AND expires_at > ?2",
    ).bind(invite.id, now),
    // An existing membership is left as it is (an invite never changes someone's current role).
    env.DB.prepare(
      `INSERT INTO project_members (project_id, user_id, role, added_by, created_at, updated_at, created_by)
       SELECT ?1, ?2, ?3, ?4, ?5, ?5, ?4 WHERE ${won("?6", "?5")}
       ON CONFLICT (project_id, user_id) DO NOTHING`,
    ).bind(invite.project_id, params.user.id, invite.role, invite.invited_by, now, invite.id),
    env.DB.prepare(
      `UPDATE users SET status = 'active', updated_at = ?2 WHERE id = ?1 AND status = 'pending' AND ${won("?3", "?2")}`,
    ).bind(params.user.id, now, invite.id),
    env.DB.prepare(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
       SELECT ?1, ?2, 'invite', CAST(CAST(?3 AS INTEGER) AS TEXT), ?4, ?5, ?6 WHERE ${won("?3", "?6")}`,
    ).bind(
      params.user.id,
      AUDIT.inviteUsed,
      invite.id,
      JSON.stringify({ projectId: invite.project_id, projectKey: invite.project_key, role: invite.role }),
      params.ipHash,
      now,
    ),
  ]);
  return results[0]?.meta.changes === 1 ? "accepted" : "expired";
}

export function inviteRoutes() {
  const routes = new Hono<AppEnv>();

  // Create an invite: App Admins for any team project, Project Admins for their own (section 2).
  routes.post(
    "/projects/:projectId/invites",
    requireSession,
    requirePermission("invite.create", { projectId: (c) => idParam(c, "projectId") }),
    async (c) => {
      const project = c.get("project");
      if (project.isSystem) return forbidden(c, 403); // Hub Feedback is App Admins only; no invites.
      const parsed = createInviteBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);

      const { user } = c.get("auth");
      const now = Date.now();
      const token = randomToken(32);
      const tokenHash = await sha256Base64url(token);
      const expiresAt = now + INVITE_TTL_MS;
      const key = await c.env.DB.prepare("SELECT key FROM projects WHERE id = ?").bind(project.id).first<string>("key");

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO invites (project_id, role, email, invited_by, token, expires_at, created_at, updated_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?4)`,
        ).bind(project.id, parsed.data.role, parsed.data.email, user.id, tokenHash, expiresAt, now),
        c.env.DB.prepare(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
           SELECT ?1, ?2, 'invite', CAST(id AS TEXT), ?3, ?4, ?5 FROM invites WHERE token = ?6`,
        ).bind(
          user.id,
          AUDIT.inviteSent,
          JSON.stringify({ projectId: project.id, projectKey: key, role: parsed.data.role }),
          await ipHash(c),
          now,
          tokenHash,
        ),
        // TODO(Stage 5, section 8 "Invite link sent"): queue an email_outbox row in this same batch —
        // template "invite", recipient parsed.data.email, payload { link, projectName, role, invitedBy }.
      ]);

      // Until email exists (Stage 5) the inviter copies this link. It is shown once and never stored.
      return c.json({ link: `${c.env.APP_BASE_URL}/invite/${token}`, expiresAt }, 201);
    },
  );

  // Public: what the invite link is for. Expired, used and unknown links all read as "expired".
  routes.get("/invites/:token", async (c) => {
    c.header("Cache-Control", "no-store");
    const token = c.req.param("token");
    const invite = inviteToken.safeParse(token).success ? await findInvite(c.env, token) : null;
    const body: InviteLookup = usable(invite, Date.now())
      ? { status: "valid", projectName: invite.project_name, role: invite.role }
      : { status: "expired" };
    return c.json(body);
  });

  // A signed-in person accepts directly (signed-out people accept through sign-in, see auth/routes.ts).
  routes.post("/invites/:token/accept", requireSession, async (c) => {
    const { user } = c.get("auth");
    const outcome = await redeemInvite(c.env, {
      token: c.req.param("token"),
      user,
      ipHash: await ipHash(c),
      now: Date.now(),
    });
    return c.json({ outcome });
  });

  return routes;
}

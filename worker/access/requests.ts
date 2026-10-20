import { type Context, Hono } from "hono";
import {
  ACCESS_COPY,
  ACCESS_ERRORS,
  ACCESS_REQUESTS_PER_DAY,
  type AccessQueueResponse,
  approveBody,
  CONFIRM_ACTIONS,
  createAccessRequestBody,
  denyBody,
  type MyAccessRequest,
  NUDGE_AFTER_MS,
  NUDGE_INTERVAL_MS,
  type ProjectRole,
  type ProjectTile,
} from "../../shared/access";
import { AUDIT } from "../audit";
import { authorize, forbidden, idParam, requireConfirmation } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { startOfDay } from "../lib/time";
import { noticeStatements, requestDeciders } from "../notify";
import type { AppEnv } from "../types";

// Access requests and approvals (AUTH-3, AUTH-5, AUTH-8, RATE-2, section 7).

/** Team projects a person could ask to join: not hidden, system, archived, already joined or already requested. */
const REQUESTABLE_SQL = `
  SELECT p.id, p.key, p.name, p.description, p.colour, p.icon
  FROM projects p
  WHERE p.hidden = 0 AND p.is_system = 0 AND p.archived_at IS NULL AND p.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM access_requests r WHERE r.project_id = p.id AND r.user_id = ?1 AND r.status = 'pending')`;

/** Pending and Active people may ask for access (AUTH-3, AUTH-5); suspended people never reach here. */
function canRequest(c: Context<AppEnv>): boolean {
  const { status } = c.get("auth").user;
  return status === "pending" || status === "active";
}

type DecisionTarget = {
  id: number;
  status: string;
  user_id: number;
  user_status: string;
  project_id: number;
  project_key: string;
  project_name: string;
};

async function loadDecisionTarget(c: Context<AppEnv>, requestId: number): Promise<DecisionTarget | null> {
  return c.env.DB.prepare(
    `SELECT r.id, r.status, r.user_id, u.status AS user_status, r.project_id, p.key AS project_key, p.name AS project_name
     FROM access_requests r JOIN users u ON u.id = r.user_id JOIN projects p ON p.id = r.project_id
     WHERE r.id = ?1`,
  )
    .bind(requestId)
    .first<DecisionTarget>();
}

export function accessRequestRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/projects/requestable", requireSession, async (c) => {
    if (!canRequest(c)) return forbidden(c, 403);
    const { results } = await c.env.DB.prepare(`${REQUESTABLE_SQL} ORDER BY p.name`)
      .bind(c.get("auth").user.id)
      .all<ProjectTile>();
    return c.json({ projects: results });
  });

  // AUTH-3 / AUTH-5: one row per chosen project, each audited, in one batch.
  routes.post("/access-requests", requireSession, async (c) => {
    if (!canRequest(c)) return forbidden(c, 403);
    const parsed = createAccessRequestBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const { projectIds, note } = parsed.data;
    const { user } = c.get("auth");
    const now = Date.now();

    // RATE-2: one per project, per calendar day in the person's timezone; over the limit rejects the whole submission.
    const today = await c.env.DB.prepare(
      "SELECT count(*) AS n FROM access_requests WHERE user_id = ?1 AND created_at >= ?2",
    )
      .bind(user.id, startOfDay(now, user.timezone))
      .first<number>("n");
    if ((today ?? 0) + projectIds.length > ACCESS_REQUESTS_PER_DAY) {
      return c.json({ error: ACCESS_ERRORS.rateLimited, message: ACCESS_COPY.rateLimited }, 429);
    }

    const { results: projects } = await c.env.DB.prepare(
      `${REQUESTABLE_SQL} AND p.id IN (SELECT value FROM json_each(?2))`,
    )
      .bind(user.id, JSON.stringify(projectIds))
      .all<ProjectTile>();
    if (projects.length !== projectIds.length) {
      // Hidden, system, archived, unknown, already joined or already requested.
      return c.json({ error: ACCESS_ERRORS.alreadyRequested }, 409);
    }

    const ip = await ipHash(c);
    const statements = projects.flatMap((p) => [
      c.env.DB.prepare(
        `INSERT INTO access_requests (user_id, project_id, note, created_at, updated_at, created_by)
         VALUES (?1, ?2, ?3, ?4, ?4, ?1)`,
      ).bind(user.id, p.id, note, now),
      c.env.DB.prepare(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
         SELECT ?1, ?2, 'access_request', CAST(id AS TEXT), ?3, ?4, ?5
         FROM access_requests WHERE user_id = ?1 AND project_id = ?6 AND status = 'pending'`,
      ).bind(user.id, AUDIT.requestSubmitted, JSON.stringify({ projectId: p.id, projectKey: p.key }), ip, now, p.id),
    ]);
    // NOTIF-3: each project's deciders (its Project Admins, or App Admins if it has none) hear about it.
    for (const p of projects) {
      statements.push(
        ...noticeStatements(c.env, {
          type: "access.requested",
          recipients: await requestDeciders(c.env, p.id),
          actorId: user.id,
          payload: { projectKey: p.key, projectName: p.name },
        }, now),
      );
    }
    try {
      await c.env.DB.batch(statements);
    } catch (err) {
      // The one-open-request-per-project index caught a double submit.
      if (String(err).includes("UNIQUE")) return c.json({ error: ACCESS_ERRORS.alreadyRequested }, 409);
      throw err;
    }
    return c.json({ ok: true }, 201);
  });

  // The live status screen (section 11.6). Latest request per project, newest first.
  routes.get("/access-requests/mine", requireSession, async (c) => {
    const { user } = c.get("auth");
    const now = Date.now();
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.status, r.decision_reason, r.created_at, r.last_nudged_at,
              p.id AS project_id, p.key, p.name, p.colour, p.icon
       FROM access_requests r JOIN projects p ON p.id = r.project_id
       WHERE r.user_id = ?1 AND p.deleted_at IS NULL
       ORDER BY r.created_at DESC, r.id DESC`,
    )
      .bind(user.id)
      .all<{
        id: number;
        status: MyAccessRequest["status"];
        decision_reason: string | null;
        created_at: number;
        last_nudged_at: number | null;
        project_id: number;
        key: string;
        name: string;
        colour: string;
        icon: string;
      }>();
    const seen = new Set<number>();
    const requests: MyAccessRequest[] = [];
    for (const r of results) {
      if (seen.has(r.project_id)) continue;
      seen.add(r.project_id);
      const stillWaiting = r.status === "pending" && now - r.created_at >= NUDGE_AFTER_MS;
      requests.push({
        id: r.id,
        status: r.status,
        project: { id: r.project_id, key: r.key, name: r.name, colour: r.colour, icon: r.icon },
        decisionReason: r.status === "denied" ? r.decision_reason : null,
        createdAt: r.created_at,
        stillWaiting,
        canNudge: stillWaiting && (r.last_nudged_at === null || now - r.last_nudged_at >= NUDGE_INTERVAL_MS),
      });
    }
    c.header("Cache-Control", "no-store");
    return c.json({ requests });
  });

  // AUTH-8: "Still waiting?" — own pending request, at least 48 h old, once per 24 h. One conditional write.
  routes.post("/access-requests/:id/nudge", requireSession, async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const { user } = c.get("auth");
    const now = Date.now();
    const request = await c.env.DB.prepare(
      "SELECT r.project_id, p.key, p.name FROM access_requests r JOIN projects p ON p.id = r.project_id WHERE r.id = ?1 AND r.user_id = ?2",
    )
      .bind(id, user.id)
      .first<{ project_id: number; key: string; name: string }>();
    const [updated] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE access_requests SET last_nudged_at = ?3, updated_at = ?3
         WHERE id = ?1 AND user_id = ?2 AND status = 'pending' AND created_at <= ?4
           AND (last_nudged_at IS NULL OR last_nudged_at <= ?5)`,
      ).bind(id, user.id, now, now - NUDGE_AFTER_MS, now - NUDGE_INTERVAL_MS),
      // AUTH-8: the reminder reaches the project's deciders, only when the nudge above was allowed.
      ...(request
        ? noticeStatements(
            c.env,
            {
              type: "access.nudge",
              recipients: await requestDeciders(c.env, request.project_id),
              actorId: user.id,
              payload: { projectKey: request.key, projectName: request.name },
              // Several deciders: check the nudge was recorded rather than changes(), which the bell insert alters.
              onlyIf: `EXISTS (SELECT 1 FROM access_requests WHERE id = ${Number(id)} AND last_nudged_at = ${now})`,
              dedupeKey: `nudge:${id}:${new Date(now).toISOString().slice(0, 10)}`,
            },
            now,
          )
        : []),
    ]);
    if (updated!.meta.changes === 1) return c.json({ ok: true });
    const own = await c.env.DB.prepare("SELECT 1 FROM access_requests WHERE id = ?1 AND user_id = ?2")
      .bind(id, user.id)
      .first();
    return own ? c.json({ error: ACCESS_ERRORS.nudgeNotAvailable }, 409) : forbidden(c, 404);
  });

  // The queue a person may decide: App Admins see everything; Project Admins their own projects (section 7).
  routes.get("/admin/access-queue", requireSession, async (c) => {
    const { user } = c.get("auth");
    if (user.status !== "active") return forbidden(c, 403);
    const isAppAdmin = user.appRole === "admin" ? 1 : 0;
    const adminProjects = `(?1 = 1 OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?2 AND role = 'admin'))`;

    const [requests, projects] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT r.id, r.note, r.created_at, u.id AS user_id, u.name, u.email, u.avatar_url,
                p.id AS project_id, p.key, p.name AS project_name,
                NOT EXISTS (SELECT 1 FROM project_members m JOIN users a ON a.id = m.user_id
                            WHERE m.project_id = p.id AND m.role = 'admin' AND a.status = 'active') AS no_admin
         FROM access_requests r JOIN users u ON u.id = r.user_id JOIN projects p ON p.id = r.project_id
         WHERE r.status = 'pending' AND u.status != 'suspended'
           AND p.archived_at IS NULL AND p.deleted_at IS NULL AND ${adminProjects}
         ORDER BY r.created_at, r.id`,
      ).bind(isAppAdmin, user.id),
      c.env.DB.prepare(
        `SELECT p.id, p.key, p.name FROM projects p
         WHERE p.is_system = 0 AND p.archived_at IS NULL AND p.deleted_at IS NULL AND ${adminProjects}
         ORDER BY p.name`,
      ).bind(isAppAdmin, user.id),
    ]);
    const invitableProjects = (projects?.results ?? []) as AccessQueueResponse["invitableProjects"];
    // Matrix row "Approve access requests": Contributors and Viewers get 403.
    if (!isAppAdmin && invitableProjects.length === 0) return forbidden(c, 403);

    const body: AccessQueueResponse = {
      requests: (requests?.results ?? []).map((r) => ({
        id: r.id as number,
        note: r.note as string,
        createdAt: r.created_at as number,
        requester: {
          id: r.user_id as number,
          name: r.name as string,
          email: r.email as string,
          avatarUrl: r.avatar_url as string | null,
        },
        project: { id: r.project_id as number, key: r.key as string, name: r.project_name as string },
        noProjectAdmin: r.no_admin === 1,
      })),
      invitableProjects,
    };
    c.header("Cache-Control", "no-store");
    return c.json(body);
  });

  /** Shared checks before a decision: exists, the actor may decide it, still pending. */
  async function decisionGuard(c: Context<AppEnv>) {
    const id = idParam(c, "id");
    const target = id === null ? null : await loadDecisionTarget(c, id);
    if (!target) return { response: forbidden(c, 404) } as const;
    const allowed = await authorize(c, "access.approve", target.project_id);
    if (!allowed.ok) return { response: forbidden(c, allowed.status) } as const;
    if (target.status !== "pending") return { response: c.json({ error: ACCESS_ERRORS.alreadyDecided }, 409) } as const;
    return { target } as const;
  }

  // Approve with a role (default Contributor). Adds the membership and makes a Pending user Active.
  routes.post("/access-requests/:id/approve", requireSession, async (c) => {
    const parsed = approveBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const guard = await decisionGuard(c);
    if ("response" in guard) return guard.response;
    const { target } = guard;
    if (target.user_status === "suspended") return c.json({ error: ACCESS_ERRORS.requesterSuspended }, 409);

    const { user } = c.get("auth");
    const role: ProjectRole = parsed.data.role;
    const now = Date.now();
    // Steps 2–4 run only if step 1 recorded this exact decision (safe against two admins at once).
    const decided = "EXISTS (SELECT 1 FROM access_requests WHERE id = ?1 AND status = 'approved' AND decided_at = ?2 AND decided_by = ?3)";
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE access_requests SET status = 'approved', decided_by = ?3, decided_at = ?2, updated_at = ?2
         WHERE id = ?1 AND status = 'pending'`,
      ).bind(target.id, now, user.id),
      // The audit row and the notice each follow only if the step before changed a row (changes() = 1), so a
      // second admin deciding in the same millisecond can't log or notify twice.
      c.env.DB.prepare(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
         SELECT ?3, ?4, 'access_request', CAST(CAST(?1 AS INTEGER) AS TEXT), ?5, ?6, ?2 WHERE changes() = 1`,
      ).bind(
        target.id,
        now,
        user.id,
        AUDIT.requestApproved,
        JSON.stringify({ projectId: target.project_id, projectKey: target.project_key, userId: target.user_id, role }),
        await ipHash(c),
      ),
      // NOTIF-3: the requester.
      ...noticeStatements(
        c.env,
        {
          type: "access.decided",
          recipients: [target.user_id],
          actorId: user.id,
          payload: { projectKey: target.project_key, projectName: target.project_name, decision: "approved" },
          onlyIf: "changes() = 1",
        },
        now,
      ),
      // An existing membership (e.g. from an invite) keeps its role.
      c.env.DB.prepare(
        `INSERT INTO project_members (project_id, user_id, role, added_by, created_at, updated_at, created_by)
         SELECT ?4, ?5, ?6, ?3, ?2, ?2, ?3 WHERE ${decided}
         ON CONFLICT (project_id, user_id) DO NOTHING`,
      ).bind(target.id, now, user.id, target.project_id, target.user_id, role),
      c.env.DB.prepare(
        `UPDATE users SET status = 'active', updated_at = ?2 WHERE id = ?4 AND status = 'pending' AND ${decided}`,
      ).bind(target.id, now, user.id, target.user_id),
    ]);
    if (results[0]?.meta.changes !== 1) return c.json({ error: ACCESS_ERRORS.alreadyDecided }, 409);
    return c.json({ ok: true });
  });

  // Deny with a required reason, through the confirmation dialog (section 11.14).
  routes.post(
    "/access-requests/:id/deny",
    requireSession,
    requireConfirmation(CONFIRM_ACTIONS.denyAccessRequest),
    async (c) => {
      const parsed = denyBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
      const guard = await decisionGuard(c);
      if ("response" in guard) return guard.response;
      const { target } = guard;

      const { user } = c.get("auth");
      const now = Date.now();
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE access_requests SET status = 'denied', decided_by = ?3, decided_at = ?2, decision_reason = ?4, updated_at = ?2
           WHERE id = ?1 AND status = 'pending'`,
        ).bind(target.id, now, user.id, parsed.data.reason),
        c.env.DB.prepare(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
           SELECT ?3, ?4, 'access_request', CAST(CAST(?1 AS INTEGER) AS TEXT), ?5, ?6, ?2 WHERE changes() = 1`,
        ).bind(
          target.id,
          now,
          user.id,
          AUDIT.requestDenied,
          JSON.stringify({
            projectId: target.project_id,
            projectKey: target.project_key,
            userId: target.user_id,
            reason: parsed.data.reason,
          }),
          await ipHash(c),
        ),
        // NOTIF-3: the requester, only after the audit row above (which follows only a recorded decision).
        ...noticeStatements(
          c.env,
          {
            type: "access.decided",
            recipients: [target.user_id],
            actorId: user.id,
            payload: { projectKey: target.project_key, projectName: target.project_name, decision: "denied", reason: parsed.data.reason },
            onlyIf: "changes() = 1",
          },
          now,
        ),
      ]);
      if (results[0]?.meta.changes !== 1) return c.json({ error: ACCESS_ERRORS.alreadyDecided }, 409);
      return c.json({ ok: true });
    },
  );

  return routes;
}

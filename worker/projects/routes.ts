import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { ACCESS_ERRORS, type ProjectRole } from "../../shared/access";
import {
  createProjectBody,
  DEFAULT_WORKFLOW,
  HUB_FEEDBACK,
  PROJECT_COPY,
  PROJECT_ERRORS,
  type ProjectSummary,
  updateProjectBody,
} from "../../shared/projects";
import { ADMIN_CONFIRM } from "../../shared/admin";
import { AUDIT, auditInsert, auditStatement } from "../audit";
import { authorize, forbidden, idParam, requireConfirmation, requirePermission } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { can } from "../auth/permissions";
import { getDb } from "../db/client";
import { projects } from "../db/schema";
import type { AppEnv } from "../types";

// Projects (PROJ-1, PROJ-6, PROJ-7). Create and edit are App Admin only ("Create or archive projects",
// section 2); everyone sees only the projects the matrix lets them see.

type ProjectRow = {
  id: number;
  key: string;
  name: string;
  description: string;
  colour: ProjectSummary["colour"];
  icon: ProjectSummary["icon"];
  hidden: number;
  is_system: number;
  archived_at: number | null;
  role: ProjectRole | null;
};

/** Projects with the person's role. App Admins see every project; others only team projects they belong to. */
const PROJECT_SQL = `
  SELECT p.id, p.key, p.name, p.description, p.colour, p.icon, p.hidden, p.is_system, p.archived_at, m.role
  FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?1
  WHERE p.deleted_at IS NULL AND (?2 = 1 OR (m.role IS NOT NULL AND p.is_system = 0))`;

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    colour: row.colour,
    icon: row.icon,
    hidden: row.hidden === 1,
    isSystem: row.is_system === 1,
    archived: row.archived_at !== null,
    role: row.role,
  };
}

/** Inserts the default columns (PROJ-2) for the project matched by `where`, which binds ?1. */
function seedWorkflow(env: Env, where: string, bind: unknown, now: number, actorId: number | null) {
  return env.DB.prepare(
    `INSERT INTO workflow_states (project_id, name, category, position, blocks, created_at, updated_at, created_by)
     SELECT p.id, json_extract(s.value, '$.name'), json_extract(s.value, '$.category'), s.key, coalesce(json_extract(s.value, '$.blocks'), 0), ?2, ?2, ?3
     FROM projects p, json_each(?4) s WHERE ${where}`,
  ).bind(bind, now, actorId, JSON.stringify(DEFAULT_WORKFLOW));
}

/**
 * PROJ-7 / section 18: creates Hub Feedback with its columns if it doesn't exist. Idempotent, one batch,
 * and no writes when it already exists. Called when an App Admin loads the app: the first App Admin is
 * promoted by script after their first sign-in, so this can't wait for a sign-in.
 */
export async function ensureHubFeedback(env: Env, now = Date.now()): Promise<void> {
  // Each step runs only if the one before changed a row (changes() = 1), so a no-op stays a no-op.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO projects (key, name, description, colour, icon, hidden, is_system, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, 1, 1, ?6, ?6
       WHERE NOT EXISTS (SELECT 1 FROM projects WHERE is_system = 1 OR key = ?1)`,
    ).bind(HUB_FEEDBACK.key, HUB_FEEDBACK.name, HUB_FEEDBACK.description, HUB_FEEDBACK.colour, HUB_FEEDBACK.icon, now),
    env.DB.prepare(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
       SELECT NULL, ?1, 'project', CAST(id AS TEXT), ?2, NULL, ?3 FROM projects WHERE key = ?4 AND changes() = 1`,
    ).bind(AUDIT.projectCreated, JSON.stringify({ key: HUB_FEEDBACK.key, system: true }), now, HUB_FEEDBACK.key),
    seedWorkflow(env, "p.key = ?1 AND changes() = 1", HUB_FEEDBACK.key, now, null),
  ]);
}

async function loadSummary(c: Context<AppEnv>, where: string, bind: unknown): Promise<ProjectSummary | null> {
  const { user } = c.get("auth");
  const row = await c.env.DB.prepare(`${PROJECT_SQL} AND ${where}`)
    .bind(user.id, user.appRole === "admin" ? 1 : 0, bind)
    .first<ProjectRow>();
  return row ? toSummary(row) : null;
}

export function projectRoutes() {
  const routes = new Hono<AppEnv>();

  // The sidebar and the projects page. Pending people have no projects (section 2).
  routes.get("/projects", requireSession, async (c) => {
    const { user } = c.get("auth");
    if (user.status !== "active") return forbidden(c, 403);
    const { results } = await c.env.DB.prepare(`${PROJECT_SQL} ORDER BY p.is_system, p.name COLLATE NOCASE`)
      .bind(user.id, user.appRole === "admin" ? 1 : 0)
      .all<ProjectRow>();
    return c.json({ projects: results.map(toSummary) });
  });

  routes.get("/projects/by-key/:key", requireSession, async (c) => {
    const { user } = c.get("auth");
    const key = c.req.param("key").toUpperCase();
    const row = await c.env.DB.prepare(
      `SELECT p.id, p.key, p.name, p.description, p.colour, p.icon, p.hidden, p.is_system, p.archived_at, m.role
       FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?1
       WHERE p.deleted_at IS NULL AND p.key = ?2`,
    )
      .bind(user.id, key)
      .first<ProjectRow>();
    if (!row) return forbidden(c, 404);
    const context = { id: row.id, archived: row.archived_at !== null, isSystem: row.is_system === 1, role: row.role };
    if (!can(user, "task.view", context)) return forbidden(c, 403);
    return c.json({ project: toSummary(row) });
  });

  // PROJ-1: the project, its default columns and the audit event in one batch.
  routes.post("/projects", requireSession, requirePermission("project.manage"), async (c) => {
    const parsed = createProjectBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    const body = parsed.data;
    const { user } = c.get("auth");
    const now = Date.now();
    const ip = await ipHash(c);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO projects (key, name, description, colour, icon, hidden, created_at, updated_at, created_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)`,
        ).bind(body.key, body.name, body.description, body.colour, body.icon, body.hidden ? 1 : 0, now, user.id),
        seedWorkflow(c.env, "p.key = ?1", body.key, now, user.id),
        c.env.DB.prepare(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
           SELECT ?1, ?2, 'project', CAST(id AS TEXT), ?3, ?4, ?5 FROM projects WHERE key = ?6`,
        ).bind(
          user.id,
          AUDIT.projectCreated,
          JSON.stringify({ key: body.key, name: body.name, hidden: body.hidden }),
          ip,
          now,
          body.key,
        ),
      ]);
    } catch (err) {
      if (String(err).includes("UNIQUE")) {
        return c.json({ error: PROJECT_ERRORS.keyTaken, message: PROJECT_COPY.keyTaken }, 409);
      }
      throw err;
    }
    return c.json({ project: await loadSummary(c, "p.key = ?3", body.key) }, 201);
  });

  // App Admins edit any project, including the Hidden flag (PROJ-6); a Project Admin edits their own project's name,
  // description, colour and icon (v4.7). Hub Feedback is fixed (PROJ-7).
  routes.patch("/projects/:id", requireSession, async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const allowed = await authorize(c, "project.edit", id);
    if (!allowed.ok) return forbidden(c, allowed.status);
    const parsed = updateProjectBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: ACCESS_ERRORS.invalid, issues: parsed.error.issues }, 400);
    if (parsed.data.hidden !== undefined && c.get("auth").user.appRole !== "admin") return forbidden(c, 403);

    const db = getDb(c.env);
    const current = await db.query.projects.findFirst({ where: eq(projects.id, id) });
    if (!current || current.deletedAt !== null) return forbidden(c, 404);
    if (current.isSystem) return c.json({ error: PROJECT_ERRORS.system }, 403);

    const changes = Object.fromEntries(
      Object.entries(parsed.data).filter(([field, value]) => current[field as keyof typeof current] !== value),
    ) as typeof parsed.data;
    const { hidden, ...details } = changes;
    const editedFields = Object.keys(details);
    if (hidden === undefined && editedFields.length === 0) {
      return c.json({ project: await loadSummary(c, "p.id = ?3", id) });
    }

    const { user } = c.get("auth");
    const ip = await ipHash(c);
    const now = Date.now();
    const audit = (action: typeof AUDIT.projectEdited | typeof AUDIT.projectHiddenChanged, detail: Record<string, unknown>) =>
      auditInsert(db, { actorId: user.id, action, targetType: "project", targetId: id, detail, ipHash: ip });
    await db.batch([
      db.update(projects).set({ ...changes, updatedAt: now }).where(eq(projects.id, id)),
      ...(editedFields.length > 0 ? [audit(AUDIT.projectEdited, { key: current.key, fields: editedFields })] : []),
      ...(hidden !== undefined ? [audit(AUDIT.projectHiddenChanged, { key: current.key, hidden })] : []),
    ]);
    return c.json({ project: await loadSummary(c, "p.id = ?3", id) });
  });

  // PROJ-4: archive (read-only; high impact, type-to-confirm the key) and restore. Never hard-deleted from the UI.
  // Hub Feedback can't be archived (PROJ-7). Writes to an archived project are refused by can() (section 2).
  for (const [path, archive] of [
    ["archive", true],
    ["restore", false],
  ] as const) {
    routes.post(
      `/projects/:id/${path}`,
      requireSession,
      // v4.7: a Project Admin archives or restores their own project too.
      requirePermission("project.edit", { projectId: (c) => idParam(c, "id") }),
      archive ? requireConfirmation(ADMIN_CONFIRM.archiveProject) : (_c, next) => next(),
      async (c) => {
        const id = idParam(c, "id");
        if (id === null) return forbidden(c, 404);
        const current = await c.env.DB.prepare("SELECT key, is_system, archived_at FROM projects WHERE id = ?1 AND deleted_at IS NULL")
          .bind(id)
          .first<{ key: string; is_system: number; archived_at: number | null }>();
        if (!current) return forbidden(c, 404);
        if (current.is_system) return c.json({ error: PROJECT_ERRORS.system }, 403);
        if ((current.archived_at !== null) !== archive) {
          const { user } = c.get("auth");
          const now = Date.now();
          await c.env.DB.batch([
            c.env.DB.prepare("UPDATE projects SET archived_at = ?2, updated_at = ?3 WHERE id = ?1").bind(id, archive ? now : null, now),
            auditStatement(
              c.env,
              {
                actorId: user.id,
                action: archive ? AUDIT.projectArchived : AUDIT.projectRestored,
                targetType: "project",
                targetId: id,
                detail: { key: current.key },
                ipHash: await ipHash(c),
              },
              now,
            ),
          ]);
        }
        return c.json({ project: await loadSummary(c, "p.id = ?3", id) });
      },
    );
  }

  return routes;
}

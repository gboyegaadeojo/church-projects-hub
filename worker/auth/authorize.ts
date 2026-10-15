import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { ACCESS_ERRORS, CONFIRM_HEADER, type ProjectRole } from "../../shared/access";
import type { AppEnv } from "../types";
import { type Action, can, PROJECT_ACTIONS, type ProjectContext, type ResourceContext } from "./permissions";

// Applying the section 2 matrix in the API (NFR-1). Use after requireSession.

/** The project and the person's role on it, in one query. Null if the project doesn't exist. */
export async function loadProjectContext(env: Env, projectId: number, userId: number): Promise<ProjectContext | null> {
  const row = await env.DB.prepare(
    `SELECT p.id, p.archived_at, p.is_system, m.role
     FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?2
     WHERE p.id = ?1 AND p.deleted_at IS NULL`,
  )
    .bind(projectId, userId)
    .first<{ id: number; archived_at: number | null; is_system: number; role: ProjectRole | null }>();
  if (!row) return null;
  return { id: row.id, archived: row.archived_at !== null, isSystem: row.is_system === 1, role: row.role };
}

export type AuthorizeResult = { ok: true; project: ProjectContext | null } | { ok: false; status: 403 | 404 };

/**
 * Checks `action` for the signed-in person: 404 if a project action names no existing project,
 * 403 if the matrix says no (section 17: every role not allowed gets 403).
 */
export async function authorize(
  c: Context<AppEnv>,
  action: Action,
  projectId: number | null = null,
  resource: ResourceContext = {},
): Promise<AuthorizeResult> {
  const { user } = c.get("auth");
  let project: ProjectContext | null = null;
  if (PROJECT_ACTIONS.has(action)) {
    if (projectId === null) return { ok: false, status: 404 };
    project = await loadProjectContext(c.env, projectId, user.id);
    if (!project) return { ok: false, status: 404 };
  }
  return can(user, action, project, resource) ? { ok: true, project } : { ok: false, status: 403 };
}

export function forbidden(c: Context<AppEnv>, status: 403 | 404) {
  return c.json({ error: status === 403 ? ACCESS_ERRORS.forbidden : ACCESS_ERRORS.notFound }, status);
}

/**
 * Route guard for an action. `projectId` reads the project from the request (usually a path param).
 * The resolved project context is left in c.var.project for the handler.
 */
export function requirePermission(action: Action, opts: { projectId?: (c: Context<AppEnv>) => number | null } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const projectId = opts.projectId ? opts.projectId(c) : null;
    const result = await authorize(c, action, projectId);
    if (!result.ok) return forbidden(c, result.status);
    if (result.project) c.set("project", result.project);
    return next();
  });
}

/** Reads a positive integer path param, or null. */
export function idParam(c: Context<AppEnv>, name: string): number | null {
  const n = Number(c.req.param(name));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Destructive actions (section 11.14): the confirmation dialog sends `X-Confirm-Action: <action>`.
 * Without it the API refuses with 428, so nothing can skip the confirmation.
 */
export function requireConfirmation(confirmAction: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.header(CONFIRM_HEADER) !== confirmAction) {
      return c.json({ error: ACCESS_ERRORS.confirmationRequired }, 428);
    }
    return next();
  });
}

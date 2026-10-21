import { Hono } from "hono";
import { EMPTY_FILTER, type SavedFilter, savedFilterBody, taskFilter } from "../../shared/filters";
import { TASK_CONFIRM } from "../../shared/tasks";
import { AUDIT, auditStatement } from "../audit";
import { authorize, forbidden, idParam, requirePermission } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { can } from "../auth/permissions";
import type { AppEnv } from "../types";
import { invalid, unconfirmed } from "./routes";

// Saved filters (ORG-5): private to their owner, or shared with everyone in the project.
// Anyone who can see the project saves private filters; sharing needs "Create, edit, move tasks".

type Row = { id: number; name: string; query_json: string; shared: number; owner_id: number };

function toDto(r: Row): SavedFilter {
  const query = taskFilter.safeParse(JSON.parse(r.query_json));
  return {
    id: r.id,
    name: r.name,
    query: query.success ? query.data : EMPTY_FILTER,
    shared: r.shared === 1,
    ownerId: r.owner_id,
  };
}

const MAX_PER_PERSON = 20;

export function filterRoutes() {
  const routes = new Hono<AppEnv>();
  const projectId = { projectId: (c: Parameters<typeof idParam>[0]) => idParam(c, "id") };

  routes.get("/projects/:id/saved-filters", requireSession, requirePermission("task.view", projectId), async (c) => {
    const { user } = c.get("auth");
    const { results } = await c.env.DB.prepare(
      `SELECT id, name, query_json, shared, owner_id FROM saved_filters
       WHERE project_id = ?1 AND (owner_id = ?2 OR shared = 1) ORDER BY name COLLATE NOCASE`,
    )
      .bind(c.get("project").id, user.id)
      .all<Row>();
    return c.json({ filters: results.map(toDto) });
  });

  routes.post("/projects/:id/saved-filters", requireSession, requirePermission("task.view", projectId), async (c) => {
    const parsed = savedFilterBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { user } = c.get("auth");
    const project = c.get("project");
    if (parsed.data.shared && !can(user, "task.edit", project)) return forbidden(c, 403);
    const now = Date.now();
    const row = await c.env.DB.prepare(
      `INSERT INTO saved_filters (project_id, owner_id, name, query_json, shared, created_at, updated_at, created_by)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6, ?2
       WHERE (SELECT count(*) FROM saved_filters WHERE project_id = ?1 AND owner_id = ?2) < ?7
       RETURNING id, name, query_json, shared, owner_id`,
    )
      .bind(project.id, user.id, parsed.data.name, JSON.stringify(parsed.data.query), parsed.data.shared ? 1 : 0, now, MAX_PER_PERSON)
      .first<Row>();
    if (!row) return c.json({ error: "too_many" }, 409);
    return c.json({ filter: toDto(row) }, 201);
  });

  // The owner deletes their filter; a Project Admin or App Admin can also remove a shared one.
  routes.delete("/saved-filters/:id", requireSession, async (c) => {
    const id = idParam(c, "id");
    if (id === null) return forbidden(c, 404);
    const row = await c.env.DB.prepare("SELECT id, name, project_id, owner_id, shared FROM saved_filters WHERE id = ?1")
      .bind(id)
      .first<{ id: number; name: string; project_id: number; owner_id: number; shared: number }>();
    if (!row) return forbidden(c, 404);
    const { user } = c.get("auth");
    const view = await authorize(c, "task.view", row.project_id);
    if (!view.ok) return forbidden(c, view.status);
    const isOwner = row.owner_id === user.id;
    if (!isOwner && !(row.shared === 1 && can(user, "workflow.edit", view.project))) return forbidden(c, row.shared ? 403 : 404);
    const notConfirmed = unconfirmed(c, TASK_CONFIRM.deleteSavedFilter);
    if (notConfirmed) return notConfirmed;
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM saved_filters WHERE id = ?1").bind(id),
      auditStatement(c.env, {
        actorId: user.id,
        action: AUDIT.savedFilterDeleted,
        targetType: "saved_filter",
        targetId: id,
        detail: { name: row.name, shared: row.shared === 1 },
        ipHash: await ipHash(c),
      }),
    ]);
    return c.json({ ok: true });
  });

  return routes;
}

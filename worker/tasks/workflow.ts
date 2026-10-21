import { type Context, Hono } from "hono";
import { stateBody, stateOrderBody, TASK_CONFIRM, TASK_ERRORS, TASK_LIMITS } from "../../shared/tasks";
import { AUDIT, auditStatement } from "../audit";
import { authorize, forbidden, idParam } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";
import { invalid, unconfirmed } from "./routes";

// Workflow columns (PROJ-2, PROJ-3): Project Admins add, rename, recategorise, reorder and remove columns, up to 8.
// A column is removed only when it holds no tasks (so nothing disappears from the board), and a project always
// keeps at least one. Every change is audited as a workflow change (section 6).

type StateRow = { id: number; project_id: number; name: string; category: string; position: number };

async function audit(c: Context<AppEnv>, change: string, id: number, detail: Record<string, unknown>, now: number) {
  return auditStatement(
    c.env,
    { actorId: c.get("auth").user.id, action: AUDIT.workflowChanged, targetType: "workflow_state", targetId: id, detail: { change, ...detail }, ipHash: await ipHash(c) },
    now,
  );
}

/** Loads the column and checks workflow.edit on its project. */
async function guard(c: Context<AppEnv>): Promise<StateRow | Response> {
  const id = idParam(c, "id");
  if (id === null) return forbidden(c, 404);
  const row = await c.env.DB.prepare("SELECT id, project_id, name, category, position FROM workflow_states WHERE id = ?1").bind(id).first<StateRow>();
  if (!row) return forbidden(c, 404);
  const result = await authorize(c, "workflow.edit", row.project_id);
  if (!result.ok) return forbidden(c, result.status);
  return row;
}

const toDto = (r: StateRow) => ({ id: r.id, name: r.name, category: r.category, position: r.position });

export function workflowRoutes() {
  const routes = new Hono<AppEnv>();

  routes.post("/projects/:id/states", requireSession, async (c) => {
    const projectId = idParam(c, "id");
    const result = await authorize(c, "workflow.edit", projectId);
    if (!result.ok) return forbidden(c, result.status);
    const parsed = stateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const now = Date.now();
    // The cap is enforced in the insert itself, so two admins adding at once can't pass 8.
    const [inserted] = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO workflow_states (project_id, name, category, position, created_at, updated_at, created_by)
         SELECT ?1, ?2, ?3, coalesce(max(position), -1) + 1, ?4, ?4, ?5 FROM workflow_states WHERE project_id = ?1
         HAVING count(*) < ?6
         RETURNING id, project_id, name, category, position`,
      ).bind(projectId, parsed.data.name, parsed.data.category, now, c.get("auth").user.id, TASK_LIMITS.columns),
    ]);
    const row = (inserted!.results as StateRow[])[0];
    if (!row) return c.json({ error: TASK_ERRORS.tooMany }, 400);
    await (await audit(c, "column added", row.id, { name: row.name, category: row.category }, now)).run();
    return c.json({ state: toDto(row) }, 201);
  });

  routes.patch("/states/:id", requireSession, async (c) => {
    const row = await guard(c);
    if (row instanceof Response) return row;
    const parsed = stateBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const now = Date.now();
    const [updated] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE workflow_states SET name = ?2, category = ?3, updated_at = ?4 WHERE id = ?1 RETURNING id, project_id, name, category, position").bind(
        row.id,
        parsed.data.name,
        parsed.data.category,
        now,
      ),
      await audit(c, "column edited", row.id, { from: row.name, name: parsed.data.name, category: parsed.data.category }, now),
    ]);
    return c.json({ state: toDto((updated!.results as StateRow[])[0]!) });
  });

  // Reorder: the full list of the project's column ids in their new order.
  routes.put("/projects/:id/states/order", requireSession, async (c) => {
    const projectId = idParam(c, "id");
    const result = await authorize(c, "workflow.edit", projectId);
    if (!result.ok) return forbidden(c, result.status);
    const parsed = stateOrderBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { results } = await c.env.DB.prepare("SELECT id FROM workflow_states WHERE project_id = ?1").bind(projectId).all<{ id: number }>();
    const current = results.map((r) => r.id).sort((a, b) => a - b);
    const next = [...parsed.data.ids].sort((a, b) => a - b);
    if (current.join(",") !== next.join(",")) return c.json({ error: TASK_ERRORS.invalidReference, field: "ids" }, 400);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE workflow_states SET position = (SELECT key FROM json_each(?2) WHERE value = workflow_states.id), updated_at = ?3
         WHERE project_id = ?1`,
      ).bind(projectId, JSON.stringify(parsed.data.ids), now),
      await audit(c, "columns reordered", projectId!, { order: parsed.data.ids }, now),
    ]);
    return c.json({ ok: true });
  });

  routes.delete("/states/:id", requireSession, async (c) => {
    const row = await guard(c);
    if (row instanceof Response) return row;
    const notConfirmed = unconfirmed(c, TASK_CONFIRM.deleteState);
    if (notConfirmed) return notConfirmed;
    // Reports read each move's column from task_events (section 16), so a column any task has ever been in stays:
    // removing it would change history. Deleted tasks count too.
    const counts = await c.env.DB.prepare(
      `SELECT EXISTS (SELECT 1 FROM tasks WHERE state_id = ?1)
              OR EXISTS (SELECT 1 FROM task_events e JOIN tasks t ON t.id = e.task_id
                         WHERE t.project_id = ?2 AND e.field IN ('state', 'created') AND (e.new_value = ?3 OR e.old_value = ?3)) AS used,
              (SELECT count(*) FROM workflow_states WHERE project_id = ?2) AS columns`,
    )
      .bind(row.id, row.project_id, String(row.id))
      .first<{ used: number; columns: number }>();
    if (counts!.used) return c.json({ error: TASK_ERRORS.notEmpty }, 409);
    if (counts!.columns <= 1) return c.json({ error: TASK_ERRORS.lastColumn }, 409);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM workflow_states WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM tasks WHERE state_id = ?1)").bind(row.id),
      await audit(c, "column removed", row.id, { name: row.name }, now),
    ]);
    return c.json({ ok: true });
  });

  return routes;
}

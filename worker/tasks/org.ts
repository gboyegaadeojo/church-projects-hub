import { type Context, Hono } from "hono";
import type { z } from "zod";
import { componentBody, labelBody, milestoneBody, TASK_CONFIRM, TASK_ERRORS } from "../../shared/tasks";
import { AUDIT, type AuditTargetType, auditStatement } from "../audit";
import { authorize, forbidden, idParam } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";
import { badReference, invalid, unconfirmed } from "./routes";

// Labels (ORG-1), components (ORG-2) and milestones (ORG-4). Project Admins manage them ("Edit workflow,
// labels, components", section 2). Every change is audited as a workflow change (section 6).

type Kind<S extends z.ZodType> = {
  path: string;
  table: string;
  target: AuditTargetType;
  body: S;
  confirm: string;
  /** Column values from the parsed body. */
  columns: (body: z.output<S>, now: number) => Record<string, unknown>;
  select: string;
  toDto: (row: Record<string, unknown>) => unknown;
  /** Clean-up run in the same batch as the delete, binding ?1 = the item id. */
  onDelete: string[];
};

const KINDS = [
  {
    path: "labels",
    table: "labels",
    target: "label",
    body: labelBody,
    confirm: TASK_CONFIRM.deleteLabel,
    columns: (b: z.output<typeof labelBody>) => ({ name: b.name, colour: b.colour }),
    select: "id, name, colour",
    toDto: (r: Record<string, unknown>) => ({ id: r.id, name: r.name, colour: r.colour }),
    onDelete: ["DELETE FROM task_labels WHERE label_id = ?1"],
  } satisfies Kind<typeof labelBody>,
  {
    path: "components",
    table: "components",
    target: "component",
    body: componentBody,
    confirm: TASK_CONFIRM.deleteComponent,
    columns: (b: z.output<typeof componentBody>) => ({ name: b.name, lead_id: b.leadId }),
    select: "id, name, lead_id",
    toDto: (r: Record<string, unknown>) => ({ id: r.id, name: r.name, leadId: r.lead_id }),
    onDelete: ["UPDATE tasks SET component_id = NULL, version = version + 1 WHERE component_id = ?1"],
  } satisfies Kind<typeof componentBody>,
  {
    path: "milestones",
    table: "milestones",
    target: "milestone",
    body: milestoneBody,
    confirm: TASK_CONFIRM.deleteMilestone,
    columns: (b: z.output<typeof milestoneBody>, now: number) => ({
      name: b.name,
      target_date: b.targetDate,
      released_at: b.released ? now : null,
    }),
    select: "id, name, target_date, released_at",
    toDto: (r: Record<string, unknown>) => ({ id: r.id, name: r.name, targetDate: r.target_date, released: r.released_at !== null }),
    onDelete: ["UPDATE tasks SET milestone_id = NULL, version = version + 1 WHERE milestone_id = ?1"],
  } satisfies Kind<typeof milestoneBody>,
] as const;

/** A component lead must be in the project. */
async function badLead(env: Env, projectId: number, leadId: unknown): Promise<boolean> {
  if (leadId === null || leadId === undefined) return false;
  const row = await env.DB.prepare("SELECT 1 AS ok FROM project_members WHERE project_id = ?1 AND user_id = ?2").bind(projectId, leadId).first();
  return !row;
}

const isUnique = (err: unknown) => String(err).includes("UNIQUE");

export function orgRoutes() {
  const routes = new Hono<AppEnv>();

  for (const kind of KINDS) {
    const auditWorkflow = async (c: Context<AppEnv>, change: string, id: number, detail: Record<string, unknown>, now: number) =>
      auditStatement(
        c.env,
        {
          actorId: c.get("auth").user.id,
          action: AUDIT.workflowChanged,
          targetType: kind.target,
          targetId: id,
          detail: { change, ...detail },
          ipHash: await ipHash(c),
        },
        now,
      );

    /** Loads the item and checks workflow.edit on its project. */
    const guard = async (c: Context<AppEnv>) => {
      const id = idParam(c, "id");
      if (id === null) return forbidden(c, 404);
      const row = await c.env.DB.prepare(`SELECT ${kind.select}, project_id FROM ${kind.table} WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
      if (!row) return forbidden(c, 404);
      const result = await authorize(c, "workflow.edit", row.project_id as number);
      if (!result.ok) return forbidden(c, result.status);
      return row;
    };

    routes.post(`/projects/:id/${kind.path}`, requireSession, async (c) => {
      const projectId = idParam(c, "id");
      const result = await authorize(c, "workflow.edit", projectId);
      if (!result.ok) return forbidden(c, result.status);
      const parsed = (kind.body as z.ZodType).safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return invalid(c, parsed.error.issues);
      const now = Date.now();
      const columns = (kind.columns as (b: unknown, n: number) => Record<string, unknown>)(parsed.data, now);
      if (await badLead(c.env, projectId!, columns.lead_id)) return badReference(c, "leadId");
      const names = Object.keys(columns);
      try {
        const [inserted] = await c.env.DB.batch([
          c.env.DB.prepare(
            `INSERT INTO ${kind.table} (project_id, ${names.join(", ")}, created_at, updated_at, created_by)
             VALUES (?1, ${names.map((_, i) => `?${i + 4}`).join(", ")}, ?2, ?2, ?3) RETURNING ${kind.select}`,
          ).bind(projectId, now, c.get("auth").user.id, ...Object.values(columns)),
          // The audit row finds the new item by project and creation time.
          c.env.DB.prepare(
            `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
             SELECT ?1, ?2, ?3, CAST(max(id) AS TEXT), ?4, ?5, ?6 FROM ${kind.table} WHERE project_id = ?7 AND created_at = ?6`,
          ).bind(
            c.get("auth").user.id,
            AUDIT.workflowChanged,
            kind.target,
            JSON.stringify({ change: "created", name: columns.name }),
            await ipHash(c),
            now,
            projectId,
          ),
        ]);
        return c.json({ [kind.target]: kind.toDto((inserted!.results as Record<string, unknown>[])[0]!) }, 201);
      } catch (err) {
        if (isUnique(err)) return c.json({ error: TASK_ERRORS.nameTaken }, 409);
        throw err;
      }
    });

    routes.patch(`/${kind.path}/:id`, requireSession, async (c) => {
      const row = await guard(c);
      if (row instanceof Response) return row;
      const parsed = (kind.body as z.ZodType).safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return invalid(c, parsed.error.issues);
      const now = Date.now();
      const columns = (kind.columns as (b: unknown, n: number) => Record<string, unknown>)(parsed.data, now);
      // Keep the original release time when a released milestone stays released.
      if ("released_at" in columns && columns.released_at !== null && row.released_at !== null) columns.released_at = row.released_at;
      if (await badLead(c.env, row.project_id as number, columns.lead_id)) return badReference(c, "leadId");
      const names = Object.keys(columns);
      try {
        const [updated] = await c.env.DB.batch([
          c.env.DB.prepare(
            `UPDATE ${kind.table} SET ${names.map((n, i) => `${n} = ?${i + 3}`).join(", ")}, updated_at = ?2 WHERE id = ?1
             RETURNING ${kind.select}`,
          ).bind(row.id, now, ...Object.values(columns)),
          await auditWorkflow(c, "edited", row.id as number, { name: columns.name }, now),
        ]);
        return c.json({ [kind.target]: kind.toDto((updated!.results as Record<string, unknown>[])[0]!) });
      } catch (err) {
        if (isUnique(err)) return c.json({ error: TASK_ERRORS.nameTaken }, 409);
        throw err;
      }
    });

    routes.delete(`/${kind.path}/:id`, requireSession, async (c) => {
      const row = await guard(c);
      if (row instanceof Response) return row;
      const notConfirmed = unconfirmed(c, kind.confirm);
      if (notConfirmed) return notConfirmed;
      const now = Date.now();
      await c.env.DB.batch([
        ...kind.onDelete.map((sql) => c.env.DB.prepare(sql).bind(row.id)),
        c.env.DB.prepare(`DELETE FROM ${kind.table} WHERE id = ?1`).bind(row.id),
        await auditWorkflow(c, "deleted", row.id as number, { name: row.name }, now),
      ]);
      return c.json({ ok: true });
    });
  }

  return routes;
}

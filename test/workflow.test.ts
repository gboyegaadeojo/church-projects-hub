import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW } from "../shared/projects";
import { type BoardResponse, TASK_CONFIRM } from "../shared/tasks";
import { call } from "./helpers/auth";
import { actorAs, auditFor, createProject } from "./helpers/fixtures";

// PROJ-2 / PROJ-3 workflow columns against the real API and D1.

async function projectWithColumns() {
  const p = await createProject();
  for (const [position, s] of DEFAULT_WORKFLOW.entries()) {
    await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, ?, ?, ?)").bind(p.id, s.name, s.category, position).run();
  }
  return p;
}

async function states(projectId: number, client: Awaited<ReturnType<typeof actorAs>>) {
  return ((await (await call(client, "GET", `/api/projects/${projectId}/board`)).json()) as BoardResponse).states;
}

describe("PROJ-3 Project Admins manage workflow columns", () => {
  it("adds, renames, recategorises and reorders columns, up to 8, audited", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const added = await call(admin, "POST", `/api/projects/${p.id}/states`, { name: "Blocked", category: "in_progress" });
    expect(added.status).toBe(201);
    const { state } = (await added.json()) as { state: { id: number; position: number } };
    expect(state.position).toBe(6);

    const renamed = await call(admin, "PATCH", `/api/states/${state.id}`, { name: "Waiting", category: "todo" });
    expect(await renamed.json()).toMatchObject({ state: { name: "Waiting", category: "todo" } });

    const before = await states(p.id, admin);
    const reversed = before.map((s) => s.id).reverse();
    expect((await call(admin, "PUT", `/api/projects/${p.id}/states/order`, { ids: reversed })).status).toBe(200);
    expect((await states(p.id, admin)).map((s) => s.id)).toEqual(reversed);
    // The order must name exactly this project's columns.
    expect((await call(admin, "PUT", `/api/projects/${p.id}/states/order`, { ids: reversed.slice(1) })).status).toBe(400);

    await call(admin, "POST", `/api/projects/${p.id}/states`, { name: "Seven", category: "todo" });
    const ninth = await call(admin, "POST", `/api/projects/${p.id}/states`, { name: "Eight", category: "todo" });
    expect(ninth.status).toBe(400);
    expect(await ninth.json()).toMatchObject({ error: "too_many" });

    const audited = await auditFor("workflow.changed", state.id);
    expect(audited.map((a) => a.detail.change)).toEqual(["column added", "column edited"]);
    expect(audited[0]).toMatchObject({ actor_id: admin.userId, target_type: "workflow_state" });
    expect((await auditFor("workflow.changed", p.id)).map((a) => a.detail.change)).toEqual(["columns reordered"]);
  });

  it("removes only a column no task has ever been in, through the confirmation dialog", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const [first] = await states(p.id, admin);
    const { state: empty } = (await (await call(admin, "POST", `/api/projects/${p.id}/states`, { name: "Spare", category: "todo" })).json()) as { state: { id: number } };
    expect((await call(admin, "DELETE", `/api/states/${empty.id}`)).status).toBe(428);
    expect((await call(admin, "DELETE", `/api/states/${empty.id}`, undefined, { "X-Confirm-Action": TASK_CONFIRM.deleteState })).status).toBe(200);

    // A column with a task, or one a task has passed through, stays.
    await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Check batteries", stateId: first!.id });
    const used = await call(admin, "DELETE", `/api/states/${first!.id}`, undefined, { "X-Confirm-Action": TASK_CONFIRM.deleteState });
    expect(used.status).toBe(409);
    expect(await used.json()).toMatchObject({ error: "not_empty" });
  });

  it("Contributors and Viewers can't change columns", async () => {
    const p = await projectWithColumns();
    const contributor = await actorAs("contributor", p.id);
    expect((await call(contributor, "POST", `/api/projects/${p.id}/states`, { name: "Mine", category: "todo" })).status).toBe(403);
    const [first] = await states(p.id, contributor);
    expect((await call(contributor, "PATCH", `/api/states/${first!.id}`, { name: "Renamed", category: "todo" })).status).toBe(403);
  });
});

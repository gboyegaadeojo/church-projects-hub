import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW } from "../shared/projects";
import type { BoardResponse, TaskDetail } from "../shared/tasks";
import { call, type Client } from "./helpers/auth";
import { actorAs, createProject } from "./helpers/fixtures";

// v4.7 Blocked work: a blocking column needs a reason on the way in, by every route; leaving it clears the reason.
// Against the real API and D1.

async function setup() {
  const p = await createProject();
  const ids: Record<string, number> = {};
  for (const [position, s] of DEFAULT_WORKFLOW.entries()) {
    const row = await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position, blocks) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(p.id, s.name, s.category, position, s.blocks ? 1 : 0)
      .first<{ id: number }>();
    ids[s.name] = row!.id;
  }
  const admin = await actorAs("projectAdmin", p.id);
  const lead = await actorAs("contributor", p.id);
  return { p, ids, admin, lead };
}

async function create(client: Client, projectId: number, body: Record<string, unknown>) {
  const res = await call(client, "POST", `/api/projects/${projectId}/tasks`, { title: "Fix the monitor mix", ...body });
  return { res, task: res.status === 201 ? ((await res.json()) as { task: TaskDetail }).task : null };
}

async function detail(client: Client, id: number) {
  return ((await (await call(client, "GET", `/api/tasks/${id}`)).json()) as { task: TaskDetail }).task;
}

describe("v4.7 Blocked column", () => {
  it("moving a task in needs a reason; it is kept with who and when, recorded and sent; moving out clears it", async () => {
    const { p, ids, admin, lead } = await setup();
    const { task } = await create(admin, p.id, { stateId: ids["In Progress"], assigneeId: lead.userId });

    const missing = await call(admin, "POST", `/api/tasks/${task!.id}/move`, { stateId: ids.Blocked });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: "reason_required", field: "blockedReason" });
    expect((await call(admin, "POST", `/api/tasks/${task!.id}/move`, { stateId: ids.Blocked, blockedReason: "  " })).status).toBe(400);

    const moved = await call(admin, "POST", `/api/tasks/${task!.id}/move`, { stateId: ids.Blocked, blockedReason: "Waiting on the new DI box" });
    expect(moved.status).toBe(200);
    let t = await detail(admin, task!.id);
    expect(t).toMatchObject({ stateId: ids.Blocked, blockedReason: "Waiting on the new DI box", blockedBy: admin.userId });
    expect(t.blockedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(t.events.map((e) => e.field)).toEqual(expect.arrayContaining(["blocked", "state"]));
    const bell = await env.DB.prepare("SELECT user_id, payload_json FROM notifications WHERE type = 'task.blocked' AND task_id = ?").bind(task!.id).all<{ user_id: number; payload_json: string }>();
    expect(bell.results.map((r) => r.user_id)).toEqual([lead.userId]);
    expect(JSON.parse(bell.results[0]!.payload_json)).toMatchObject({ reason: "Waiting on the new DI box" });

    // The board card carries it, and the column says it blocks.
    const board = (await (await call(admin, "GET", `/api/projects/${p.id}/board`)).json()) as BoardResponse;
    expect(board.states.find((s) => s.id === ids.Blocked)).toMatchObject({ blocks: true });
    expect(board.tasks.find((x) => x.id === task!.id)).toMatchObject({ blockedReason: "Waiting on the new DI box" });

    // Reordering inside the column needs no new reason; editing it is recorded.
    expect((await call(admin, "POST", `/api/tasks/${task!.id}/move`, { stateId: ids.Blocked })).status).toBe(200);
    t = await detail(admin, task!.id);
    const edited = await call(admin, "PATCH", `/api/tasks/${task!.id}`, { version: t.version, blockedReason: "DI box arrives Friday" });
    expect(((await edited.json()) as { task: TaskDetail }).task.blockedReason).toBe("DI box arrives Friday");

    // Out of the column: cleared, with history.
    expect((await call(admin, "POST", `/api/tasks/${task!.id}/move`, { stateId: ids["In Progress"] })).status).toBe(200);
    t = await detail(admin, task!.id);
    expect(t).toMatchObject({ blockedReason: null, blockedAt: null, blockedBy: null });
    expect(t.events.at(-2)).toMatchObject({ field: "unblocked", oldValue: "DI box arrives Friday" });
  });

  it("the status field, bulk edit and creating straight into the column all need a reason", async () => {
    const { p, ids, admin } = await setup();
    const { task } = await create(admin, p.id, {});
    const t = await detail(admin, task!.id);
    expect((await call(admin, "PATCH", `/api/tasks/${t.id}`, { version: t.version, stateId: ids.Blocked })).status).toBe(400);
    const patched = await call(admin, "PATCH", `/api/tasks/${t.id}`, { version: t.version, stateId: ids.Blocked, blockedReason: "Needs a budget OK" });
    expect(((await patched.json()) as { task: TaskDetail }).task.blockedReason).toBe("Needs a budget OK");

    const { res: noReason } = await create(admin, p.id, { stateId: ids.Blocked });
    expect(noReason.status).toBe(400);
    const { task: born } = await create(admin, p.id, { stateId: ids.Blocked, blockedReason: "Venue not booked" });
    expect(born).toMatchObject({ blockedReason: "Venue not booked", blockedBy: admin.userId });

    const { task: a } = await create(admin, p.id, {});
    const { task: b } = await create(admin, p.id, {});
    expect((await call(admin, "POST", `/api/projects/${p.id}/tasks/bulk`, { taskIds: [a!.id, b!.id], stateId: ids.Blocked })).status).toBe(400);
    expect((await call(admin, "POST", `/api/projects/${p.id}/tasks/bulk`, { taskIds: [a!.id, b!.id, born!.id], stateId: ids.Blocked, blockedReason: "Easter freeze" })).status).toBe(200);
    // Tasks already blocked keep their own reason.
    expect((await detail(admin, born!.id)).blockedReason).toBe("Venue not booked");
    expect((await detail(admin, a!.id)).blockedReason).toBe("Easter freeze");
    await call(admin, "POST", `/api/projects/${p.id}/tasks/bulk`, { taskIds: [a!.id], stateId: ids.Done });
    expect((await detail(admin, a!.id)).blockedReason).toBeNull();
  });

  it("a column stops blocking: its tasks' reasons are cleared", async () => {
    const { p, ids, admin } = await setup();
    const { task } = await create(admin, p.id, { stateId: ids.Blocked, blockedReason: "Waiting for keys" });
    expect((await call(admin, "PATCH", `/api/states/${ids.Blocked}`, { name: "On hold", category: "in_progress", blocks: false })).status).toBe(200);
    expect((await detail(admin, task!.id)).blockedReason).toBeNull();
  });

  it("migration 0013 adds a Blocked column after the in-progress columns, shifting later ones, once", async () => {
    const p = await createProject();
    for (const [position, [name, category]] of [
      ["To Do", "todo"],
      ["Doing", "in_progress"],
      ["Done", "done"],
    ].entries()) {
      await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, ?, ?, ?)").bind(p.id, name, category, position).run();
    }
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0013"))!;
    // The data step is the last two statements; run them twice to show it only adds once.
    const dataStep = migration.queries.slice(-2);
    for (let i = 0; i < 2; i++) for (const sql of dataStep) await env.DB.prepare(sql).run();
    const { results } = await env.DB.prepare("SELECT name, position, blocks FROM workflow_states WHERE project_id = ? ORDER BY position").bind(p.id).all();
    expect(results).toEqual([
      { name: "To Do", position: 0, blocks: 0 },
      { name: "Doing", position: 1, blocks: 0 },
      { name: "Blocked", position: 2, blocks: 1 },
      { name: "Done", position: 3, blocks: 0 },
    ]);
  });
});

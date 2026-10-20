import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { docFromText } from "../shared/richtext";
import type { TaskDetail } from "../shared/tasks";
import { ftsQuery, type SearchResponse, type WorkResponse } from "../shared/work";
import { call, type Client } from "./helpers/auth";
import { actorAs, addMember, createProject } from "./helpers/fixtures";

// NAV-3 My Work and NAV-1 search against the real API, D1 and FTS5 index.

type P = { id: number; key: string; states: Record<string, number> };

async function projectWithColumns(opts: { isSystem?: boolean; archived?: boolean } = {}): Promise<P> {
  const p = await createProject(opts);
  const states: Record<string, number> = {};
  for (const [position, [name, category]] of [
    ["To Do", "todo"],
    ["Done", "done"],
  ].entries()) {
    const row = await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(p.id, name, category, position)
      .first<{ id: number }>();
    states[name!] = row!.id;
  }
  return { ...p, states };
}

async function newTask(client: Client, p: P, body: Record<string, unknown>) {
  const res = await call(client, "POST", `/api/projects/${p.id}/tasks`, body);
  expect(res.status).toBe(201);
  return ((await res.json()) as { task: TaskDetail }).task;
}

let a: P;
let b: P;
let me: Client;
let other: Client;

beforeAll(async () => {
  a = await projectWithColumns();
  b = await projectWithColumns();
  me = await actorAs("contributor", a.id);
  other = await actorAs("projectAdmin", a.id);
  await addMember(b.id, other.userId, "admin");
});

describe("NAV-3 My Work", () => {
  it("lists open tasks assigned to me across my projects, with unread mentions", async () => {
    const due = await newTask(other, a, { title: "Order new cables", assigneeId: me.userId, dueDate: "2026-01-02" });
    await newTask(other, a, { title: "Not mine", assigneeId: other.userId });
    await newTask(other, a, { title: "Already done", assigneeId: me.userId, stateId: a.states.Done });
    await newTask(other, b, { title: "Other project, not a member", assigneeId: other.userId });
    const mention = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Over to " }, { type: "mention", attrs: { id: String(me.userId), label: "Me" } }] }],
    };
    await call(other, "POST", `/api/tasks/${due.id}/comments`, { body: mention });

    const res = await call(me, "GET", "/api/me/work");
    const work = (await res.json()) as WorkResponse;
    expect(work.tasks.map((t) => t.title)).toEqual(["Order new cables"]);
    expect(work.tasks[0]).toMatchObject({ key: due.key, stateName: "To Do", dueDate: "2026-01-02", project: { key: a.key } });
    expect(work.mentions).toHaveLength(1);
    expect(work.mentions[0]).toMatchObject({ taskKey: due.key, inComment: true });

    // Opening the task clears the mention.
    await call(me, "GET", `/api/tasks/${due.id}`);
    expect(((await (await call(me, "GET", "/api/me/work")).json()) as WorkResponse).mentions).toHaveLength(0);
  });

  it("Pending people have no work page", async () => {
    const pending = await actorAs("pending", a.id);
    expect((await call(pending, "GET", "/api/me/work")).status).toBe(403);
  });
});

describe("NAV-1 search", () => {
  it("finds tasks by words in the title, description and comments, by prefix, only in visible projects", async () => {
    const t = await newTask(other, a, { title: "Projector lamp", description: docFromText("The lamp in the sanctuary flickers.") });
    await call(other, "POST", `/api/tasks/${t.id}/comments`, { body: docFromText("Ordered a spare from the supplier.") });
    await newTask(other, b, { title: "Projector lamp in the hall" });

    const search = async (client: Client, q: string) => (await (await call(client, "GET", `/api/search?q=${encodeURIComponent(q)}`)).json()) as SearchResponse;
    for (const q of ["projec", "sanctuary flick", "supplier"]) {
      const res = await search(me, q);
      expect(res.tasks.map((x) => x.key), q).toEqual([t.key]);
    }
    // Project b is invisible to `me`, visible to `other`.
    expect((await search(other, "projector lamp")).tasks.map((x) => x.key).sort()).toHaveLength(2);
    // App Admins search everything.
    const admin = await actorAs("appAdmin", a.id);
    expect((await search(admin, "projector lamp")).tasks.length).toBeGreaterThanOrEqual(2);
  });

  it("a key jumps straight to that task, and only if the person can see it", async () => {
    const t = await newTask(other, b, { title: "Hall speakers" });
    expect(((await (await call(other, "GET", `/api/search?q=${t.key}`)).json()) as SearchResponse).exact?.key).toBe(t.key);
    expect(((await (await call(me, "GET", `/api/search?q=${t.key}`)).json()) as SearchResponse).exact).toBeNull();
  });

  it("matches projects by name, needs 2 characters, and treats FTS syntax as plain words", async () => {
    const res = (await (await call(me, "GET", `/api/search?q=${encodeURIComponent("Test project")}`)).json()) as SearchResponse;
    expect(res.projects.map((p) => p.key)).toContain(a.key);
    expect(res.projects.map((p) => p.key)).not.toContain(b.key);
    expect(await (await call(me, "GET", "/api/search?q=p")).json()).toEqual({ exact: null, tasks: [], projects: [] });
    for (const q of ['"', "NEAR(a b)", "*", "a OR b", "title:x", "%_\\"]) {
      expect((await call(me, "GET", `/api/search?q=${encodeURIComponent(q)}`)).status, q).toBe(200);
    }
    expect(ftsQuery('lamp "OR" near(')).toBe('"lamp"* "or"* "near"*');
    expect(ftsQuery("Café")).toBe('"cafe"*');
    expect(ftsQuery("!!")).toBeNull();
  });
});

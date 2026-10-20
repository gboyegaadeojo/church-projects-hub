import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CONFIRM_HEADER } from "../shared/access";
import { type NotificationsResponse, UNREAD_HEADER } from "../shared/notifications";
import { docFromText } from "../shared/richtext";
import type { TaskDetail } from "../shared/tasks";
import { call, type Client } from "./helpers/auth";
import { actorAs, createProject, setUser } from "./helpers/fixtures";

// NOTIF-1, NOTIF-3, NOTIF-4 / section 11.8 against the real API and D1.

type P = { id: number; key: string; states: number[] };

async function projectWithColumns(): Promise<P> {
  const p = await createProject();
  const states: number[] = [];
  for (const [position, [name, category]] of [
    ["To Do", "todo"],
    ["Doing", "in_progress"],
  ].entries()) {
    const row = await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(p.id, name, category, position)
      .first<{ id: number }>();
    states.push(row!.id);
  }
  return { ...p, states };
}

async function bell(client: Client) {
  const res = await call(client, "GET", "/api/notifications");
  return (await res.json()) as NotificationsResponse;
}

let p: P;
let admin: Client;
let alex: Client;
let sam: Client;

beforeAll(async () => {
  p = await projectWithColumns();
  admin = await actorAs("projectAdmin", p.id);
  alex = await actorAs("contributor", p.id);
  sam = await actorAs("contributor", p.id);
});

describe("NOTIF-1 task notifications", () => {
  it("the new assignee hears about it with the task's real key; the actor never notifies themselves", async () => {
    const res = await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Rig the projector", assigneeId: alex.userId });
    const { task } = (await res.json()) as { task: TaskDetail };
    const items = (await bell(alex)).items.filter((n) => n.type === "task.assigned");
    expect(items[0]).toMatchObject({ actor: { id: admin.userId }, payload: { taskKey: task.key, taskTitle: "Rig the projector", projectKey: p.key }, read: false });
    expect((await bell(admin)).items.filter((n) => n.payload.taskKey === task.key)).toHaveLength(0);

    // Assigning yourself sends nothing.
    await call(alex, "POST", `/api/projects/${p.id}/tasks`, { title: "Mine", assigneeId: alex.userId });
    expect((await bell(alex)).items.filter((n) => n.payload.taskTitle === "Mine")).toHaveLength(0);
  });

  it("a comment reaches assignee, reporter and watchers; people @mentioned get a mention instead", async () => {
    const { task } = (await (await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Sound check", assigneeId: alex.userId })).json()) as {
      task: TaskDetail;
    };
    await call(sam, "PUT", `/api/tasks/${task.id}/watch`);
    const outsider = await actorAs("contributor", (await projectWithColumns()).id);
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ready " },
            { type: "mention", attrs: { id: String(alex.userId), label: "Alex" } },
            { type: "mention", attrs: { id: String(outsider.userId), label: "Outsider" } },
          ],
        },
      ],
    };
    await call(sam, "POST", `/api/tasks/${task.id}/comments`, { body });
    const forTask = async (c: Client) => (await bell(c)).items.filter((n) => n.payload.taskKey === task.key).map((n) => n.type);
    expect(await forTask(alex)).toEqual(expect.arrayContaining(["task.mentioned"]));
    expect(await forTask(alex)).not.toContain("task.commented");
    expect(await forTask(admin)).toContain("task.commented");
    // The commenter, and people who can't see the project, get nothing.
    expect(await forTask(sam)).not.toContain("task.commented");
    expect(await forTask(outsider)).toHaveLength(0);
  });

  it("a status change tells the reporter, with the column name", async () => {
    const { task } = (await (await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Order cables" })).json()) as { task: TaskDetail };
    await call(alex, "POST", `/api/tasks/${task.id}/move`, { stateId: p.states[1] });
    const n = (await bell(admin)).items.find((x) => x.type === "task.status_changed" && x.payload.taskKey === task.key);
    expect(n).toMatchObject({ actor: { id: alex.userId }, payload: { stateName: "Doing" } });
  });
});

describe("NOTIF-3 access request notifications", () => {
  it("deciders hear about a request and the requester about the decision, once", async () => {
    const team = await projectWithColumns();
    const teamAdmin = await actorAs("projectAdmin", team.id);
    const newcomer = await actorAs("pending", team.id);
    expect((await call(newcomer, "POST", "/api/access-requests", { projectIds: [team.id], note: "" })).status).toBe(201);
    const requested = (await bell(teamAdmin)).items.find((n) => n.type === "access.requested");
    expect(requested).toMatchObject({ actor: { id: newcomer.userId }, payload: { projectKey: team.key } });

    const request = await env.DB.prepare("SELECT id FROM access_requests WHERE user_id = ? AND project_id = ?").bind(newcomer.userId, team.id).first<{ id: number }>();
    const [a, b] = await Promise.all([
      call(teamAdmin, "POST", `/api/access-requests/${request!.id}/approve`, { role: "contributor" }),
      call(teamAdmin, "POST", `/api/access-requests/${request!.id}/approve`, { role: "viewer" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const decided = (await bell(newcomer)).items.filter((n) => n.type === "access.decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]!.payload).toMatchObject({ decision: "approved", projectKey: team.key });
  });

  it("a denial tells the requester", async () => {
    const team = await projectWithColumns();
    const teamAdmin = await actorAs("projectAdmin", team.id);
    const newcomer = await actorAs("pending", team.id);
    await call(newcomer, "POST", "/api/access-requests", { projectIds: [team.id] });
    const request = await env.DB.prepare("SELECT id FROM access_requests WHERE user_id = ?").bind(newcomer.userId).first<{ id: number }>();
    await call(teamAdmin, "POST", `/api/access-requests/${request!.id}/deny`, { reason: "Full this season." }, { [CONFIRM_HEADER]: "access_request.deny" });
    // Pending people have no bell page; the row is there for when they're approved later.
    const row = await env.DB.prepare("SELECT payload_json FROM notifications WHERE user_id = ? AND type = 'access.decided'").bind(newcomer.userId).first<{ payload_json: string }>();
    expect(JSON.parse(row!.payload_json)).toMatchObject({ decision: "denied" });
  });
});

describe("NOTIF-4 / section 11.8 the bell", () => {
  it("every signed-in response carries the unread count; read one, read all", async () => {
    const reader = await actorAs("contributor", p.id);
    for (const title of ["A", "B", "C"]) await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title, assigneeId: reader.userId });
    const res = await call(reader, "GET", "/api/projects");
    expect(res.headers.get(UNREAD_HEADER)).toBe("3");
    const list = await bell(reader);
    expect(list.unread).toBe(3);
    await call(reader, "POST", `/api/notifications/${list.items[0]!.id}/read`);
    expect((await call(reader, "GET", "/api/projects")).headers.get(UNREAD_HEADER)).toBe("2");
    // Someone else's notification can't be marked.
    await call(admin, "POST", `/api/notifications/${list.items[1]!.id}/read`);
    expect((await bell(reader)).unread).toBe(2);
    await call(reader, "POST", "/api/notifications/read-all");
    expect((await bell(reader)).unread).toBe(0);
  });

  it("pages back through older notifications", async () => {
    const reader = await actorAs("contributor", p.id);
    for (let i = 0; i < 5; i++) await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: `T${i}`, assigneeId: reader.userId });
    const first = (await (await call(reader, "GET", "/api/notifications?limit=3")).json()) as NotificationsResponse;
    expect(first.items.map((n) => n.payload.taskTitle)).toEqual(["T4", "T3", "T2"]);
    const second = (await (await call(reader, "GET", `/api/notifications?limit=3&before=${first.nextBefore}`)).json()) as NotificationsResponse;
    expect(second.items.map((n) => n.payload.taskTitle)).toEqual(["T1", "T0"]);
    expect(second.nextBefore).toBeNull();
  });

  it("suspended people get nothing new", async () => {
    const gone = await actorAs("contributor", p.id);
    await setUser(gone.userId, { status: "suspended" });
    const res = await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "x", description: docFromText("hi") });
    expect(res.status).toBe(201);
    const rows = await env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE user_id = ?").bind(gone.userId).first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });
});

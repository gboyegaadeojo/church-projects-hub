import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW } from "../shared/projects";
import { docFromText } from "../shared/richtext";
import { type BoardResponse, TASK_CONFIRM, type TaskCard, type TaskDetail } from "../shared/tasks";
import { REBUILD_SEARCH_SQL } from "../worker/tasks/search";
import { call, type Client } from "./helpers/auth";
import { actorAs, addMember, auditFor, createProject, MATRIX_ROLES, type MatrixRole } from "./helpers/fixtures";

// Tasks (TASK-1 to TASK-10, ORG-1/2/4, NFR-10, NFR-12) against the real API and D1. No real people (NFR-24).

type Project = { id: number; key: string; states: number[] };

async function projectWithColumns(opts: { archived?: boolean } = {}): Promise<Project> {
  const p = await createProject(opts);
  const states: number[] = [];
  for (const [position, s] of DEFAULT_WORKFLOW.entries()) {
    const row = await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(p.id, s.name, s.category, position)
      .first<{ id: number }>();
    states.push(row!.id);
  }
  return { ...p, states };
}

async function newTask(client: Client, project: Project, body: Record<string, unknown> = {}) {
  const res = await call(client, "POST", `/api/projects/${project.id}/tasks`, { title: "Replace mic batteries", ...body });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { task: TaskDetail }).task;
}

async function board(client: Client, project: Project) {
  const res = await call(client, "GET", `/api/projects/${project.id}/board`);
  expect(res.status).toBe(200);
  return (await res.json()) as BoardResponse;
}

const confirm = (action: string) => ({ "X-Confirm-Action": action });

async function ftsRow(taskId: number) {
  return env.DB.prepare("SELECT key, title, body FROM tasks_fts WHERE rowid = ?").bind(taskId).first<{ key: string; title: string; body: string }>();
}

let project: Project;
let actors: Record<MatrixRole, Client>;

beforeAll(async () => {
  project = await projectWithColumns();
  actors = {} as Record<MatrixRole, Client>;
  for (const role of MATRIX_ROLES) actors[role] = await actorAs(role, project.id);
});

describe("TASK-1 Creating tasks", () => {
  it("gives each task the next key, defaults and the first column, and records history", async () => {
    const a = await newTask(actors.contributor, project);
    const b = await newTask(actors.contributor, project, { title: "Check stream encoder" });
    expect(a.key).toBe(`${project.key}-${a.number}`);
    expect(b.number).toBe(a.number + 1);
    expect(a).toMatchObject({ type: "task", priority: "medium", scope: "in_scope", stateId: project.states[0], assigneeId: null, dueDate: null });
    expect(a.reporterId).toBe(actors.contributor.userId);
    // TASK-8: the reporter watches automatically. TASK-6: creation is in the history.
    expect(a.watcherIds).toEqual([actors.contributor.userId]);
    expect(a.events.map((e) => e.field)).toEqual(["created"]);
  });

  it("keys never collide when tasks are created at the same time", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const created = await Promise.all(Array.from({ length: 8 }, (_, i) => newTask(admin, p, { title: `Task ${i}` })));
    expect(new Set(created.map((t) => t.number)).size).toBe(8);
  });

  it("stores every TASK-1 field, with labels, assignee, component, milestone and epic from the same project", async () => {
    const admin = actors.projectAdmin;
    const label = (await (await call(admin, "POST", `/api/projects/${project.id}/labels`, { name: `Audio ${crypto.randomUUID().slice(0, 6)}`, colour: "teal" })).json()) as {
      label: { id: number };
    };
    const component = (await (await call(admin, "POST", `/api/projects/${project.id}/components`, { name: `Stage ${crypto.randomUUID().slice(0, 6)}` })).json()) as {
      component: { id: number };
    };
    const milestone = (await (
      await call(admin, "POST", `/api/projects/${project.id}/milestones`, { name: `Easter ${crypto.randomUUID().slice(0, 6)}`, targetDate: "2027-03-28" })
    ).json()) as { milestone: { id: number } };
    const epic = await newTask(admin, project, { title: "Easter production", type: "epic" });
    const task = await newTask(admin, project, {
      title: "Program lighting cues",
      description: docFromText("Use the new fixtures."),
      type: "bug",
      stateId: project.states[2],
      priority: "urgent",
      scope: "parked",
      assigneeId: actors.contributor.userId,
      dueDate: "2027-03-20",
      labelIds: [label.label.id],
      componentId: component.component.id,
      milestoneId: milestone.milestone.id,
      epicId: epic.id,
    });
    expect(task).toMatchObject({
      type: "bug",
      stateId: project.states[2],
      priority: "urgent",
      scope: "parked",
      assigneeId: actors.contributor.userId,
      dueDate: "2027-03-20",
      labelIds: [label.label.id],
      componentId: component.component.id,
      milestoneId: milestone.milestone.id,
      epicId: epic.id,
    });
    expect(task.description.content?.length).toBe(1);
    expect(task.watcherIds.sort()).toEqual([actors.projectAdmin.userId, actors.contributor.userId].sort());
  });

  it("rejects references from another project, viewers as assignees, and nested epics", async () => {
    const other = await projectWithColumns();
    const res = await call(actors.projectAdmin, "POST", `/api/projects/${project.id}/tasks`, { title: "x", stateId: other.states[0] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_reference", field: "stateId" });
    const viewer = await call(actors.projectAdmin, "POST", `/api/projects/${project.id}/tasks`, { title: "x", assigneeId: actors.viewer.userId });
    expect(await viewer.json()).toMatchObject({ field: "assigneeId" });
    const epic = await newTask(actors.projectAdmin, project, { type: "epic" });
    const nested = await call(actors.projectAdmin, "POST", `/api/projects/${project.id}/tasks`, { title: "x", type: "epic", epicId: epic.id });
    expect(await nested.json()).toMatchObject({ field: "epicId" });
  });

  it("validates fields with the shared schema", async () => {
    for (const body of [{ title: "" }, { title: "x".repeat(201) }, { title: "x", dueDate: "2027-02-30" }, { title: "x", priority: "critical" }]) {
      expect((await call(actors.contributor, "POST", `/api/projects/${project.id}/tasks`, body)).status).toBe(400);
    }
  });
});

describe("Section 2 matrix for tasks", () => {
  it("create, edit and move: App Admin, Project Admin and Contributor yes; Viewer and Pending no", async () => {
    const allowed: Record<MatrixRole, boolean> = { appAdmin: true, projectAdmin: true, contributor: true, viewer: false, pending: false };
    const task = await newTask(actors.projectAdmin, project);
    for (const role of MATRIX_ROLES) {
      const create = await call(actors[role], "POST", `/api/projects/${project.id}/tasks`, { title: `By ${role}` });
      expect(create.status, `create as ${role}`).toBe(allowed[role] ? 201 : 403);
      const current = (await (await call(actors.projectAdmin, "GET", `/api/tasks/${task.id}`)).json()) as { task: TaskDetail };
      const edit = await call(actors[role], "PATCH", `/api/tasks/${task.id}`, { version: current.task.version, priority: role === "viewer" ? "low" : "high" });
      expect(edit.status, `edit as ${role}`).toBe(allowed[role] ? 200 : 403);
      const move = await call(actors[role], "POST", `/api/tasks/${task.id}/move`, { stateId: project.states[1] });
      expect(move.status, `move as ${role}`).toBe(allowed[role] ? 200 : 403);
    }
  });

  it("see tasks: members and App Admins yes; Pending and non-members no", async () => {
    const task = await newTask(actors.contributor, project);
    for (const role of MATRIX_ROLES) {
      expect((await call(actors[role], "GET", `/api/tasks/${task.id}`)).status, role).toBe(role === "pending" ? 403 : 200);
      expect((await call(actors[role], "GET", `/api/projects/${project.id}/board`)).status, role).toBe(role === "pending" ? 403 : 200);
    }
    const outsider = await actorAs("contributor", (await projectWithColumns()).id);
    expect((await call(outsider, "GET", `/api/tasks/${task.id}`)).status).toBe(403);
    expect((await call(outsider, "GET", `/api/tasks/by-key/${task.key}`)).status).toBe(403);
  });

  it("delete: Contributors only their own tasks within 24 hours, and only through the confirmation dialog", async () => {
    const own = await newTask(actors.contributor, project);
    const others = await newTask(actors.projectAdmin, project);
    expect((await call(actors.contributor, "DELETE", `/api/tasks/${others.id}`, undefined, confirm(TASK_CONFIRM.deleteTask))).status).toBe(403);
    expect((await call(actors.viewer, "DELETE", `/api/tasks/${own.id}`, undefined, confirm(TASK_CONFIRM.deleteTask))).status).toBe(403);
    // Without the X-Confirm-Action header: 428 (section 11.14).
    expect((await call(actors.contributor, "DELETE", `/api/tasks/${own.id}`)).status).toBe(428);

    const old = await newTask(actors.contributor, project);
    await env.DB.prepare("UPDATE tasks SET created_at = ? WHERE id = ?").bind(Date.now() - 25 * 3600_000, old.id).run();
    expect((await call(actors.contributor, "DELETE", `/api/tasks/${old.id}`, undefined, confirm(TASK_CONFIRM.deleteTask))).status).toBe(403);

    const res = await call(actors.contributor, "DELETE", `/api/tasks/${own.id}`, undefined, confirm(TASK_CONFIRM.deleteTask));
    expect(res.status).toBe(200);
    expect((await call(actors.contributor, "GET", `/api/tasks/${own.id}`)).status).toBe(404);
    expect(await ftsRow(own.id)).toBeNull();
    const [audit] = await auditFor("task.deleted", own.id);
    expect(audit).toMatchObject({ actor_id: actors.contributor.userId, detail: { key: own.key } });
    // Project Admins can delete anyone's.
    expect((await call(actors.projectAdmin, "DELETE", `/api/tasks/${old.id}`, undefined, confirm(TASK_CONFIRM.deleteTask))).status).toBe(200);
  });

  it("an archived project is read-only (PROJ-4)", async () => {
    const archived = await projectWithColumns();
    const admin = await actorAs("projectAdmin", archived.id);
    const task = await newTask(admin, archived);
    await env.DB.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").bind(Date.now(), archived.id).run();
    expect((await call(admin, "GET", `/api/tasks/${task.id}`)).status).toBe(200);
    expect((await call(admin, "PATCH", `/api/tasks/${task.id}`, { version: task.version, title: "New" })).status).toBe(403);
    expect((await call(admin, "POST", `/api/tasks/${task.id}/comments`, { body: docFromText("hi") })).status).toBe(403);
  });
});

describe("NFR-10 Optimistic concurrency", () => {
  it("an edit based on an old version gets 409 with the current task, never a silent overwrite", async () => {
    const task = await newTask(actors.contributor, project);
    const first = await call(actors.contributor, "PATCH", `/api/tasks/${task.id}`, { version: task.version, title: "First" });
    expect(first.status).toBe(200);
    const stale = await call(actors.projectAdmin, "PATCH", `/api/tasks/${task.id}`, { version: task.version, title: "Second" });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; task: TaskDetail };
    expect(body.error).toBe("conflict");
    expect(body.task).toMatchObject({ title: "First", version: task.version + 1 });
  });

  it("two edits racing on the same version: exactly one wins", async () => {
    const task = await newTask(actors.contributor, project);
    const results = await Promise.all(
      ["A", "B", "C"].map((t) => call(actors.contributor, "PATCH", `/api/tasks/${task.id}`, { version: task.version, title: t })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it("an edit that changes nothing writes nothing", async () => {
    const task = await newTask(actors.contributor, project);
    const res = await call(actors.contributor, "PATCH", `/api/tasks/${task.id}`, { version: task.version, title: task.title });
    expect(((await res.json()) as { task: TaskDetail }).task.version).toBe(task.version);
  });
});

describe("TASK-6 and TASK-7 History and scope", () => {
  it("records who changed which field from what to what", async () => {
    const task = await newTask(actors.contributor, project);
    const res = await call(actors.contributor, "PATCH", `/api/tasks/${task.id}`, {
      version: task.version,
      scope: "out_of_scope",
      assigneeId: actors.projectAdmin.userId,
      dueDate: "2027-01-10",
      description: docFromText("Batteries are in the cupboard."),
    });
    const { task: after } = (await res.json()) as { task: TaskDetail };
    const changes = after.events.filter((e) => e.field !== "created").map((e) => [e.field, e.oldValue, e.newValue, e.actorId]);
    expect(changes).toEqual([
      ["scope", "in_scope", "out_of_scope", actors.contributor.userId],
      ["due_date", null, "2027-01-10", actors.contributor.userId],
      ["assignee", null, String(actors.projectAdmin.userId), actors.contributor.userId],
      ["description", null, null, actors.contributor.userId],
    ]);
    // The new assignee watches, and names in the history are available.
    expect(after.watcherIds).toContain(actors.projectAdmin.userId);
    expect(after.people.map((p) => p.id)).toContain(actors.projectAdmin.userId);
  });
});

describe("TASK-2 / NFR-12 Moving cards on the board", () => {
  it("places a card between its neighbours and records the column change", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const [a, b, c] = [await newTask(admin, p, { title: "a" }), await newTask(admin, p, { title: "b" }), await newTask(admin, p, { title: "c" })];
    // c goes between a and b.
    let res = await call(admin, "POST", `/api/tasks/${c.id}/move`, { stateId: p.states[0], afterId: a.id, beforeId: b.id });
    expect(res.status).toBe(200);
    let cards = (await board(admin, p)).tasks.filter((t) => t.stateId === p.states[0]).map((t) => t.title);
    expect(cards).toEqual(["a", "c", "b"]);
    // a goes to the top of In Progress, then b below it.
    await call(admin, "POST", `/api/tasks/${a.id}/move`, { stateId: p.states[2] });
    res = await call(admin, "POST", `/api/tasks/${b.id}/move`, { stateId: p.states[2], afterId: a.id });
    const moved = ((await res.json()) as { task: TaskCard }).task;
    expect(moved.stateId).toBe(p.states[2]);
    cards = (await board(admin, p)).tasks.filter((t) => t.stateId === p.states[2]).map((t) => t.title);
    expect(cards).toEqual(["a", "b"]);
    const detail = ((await (await call(admin, "GET", `/api/tasks/${a.id}`)).json()) as { task: TaskDetail }).task;
    expect(detail.events.at(-1)).toMatchObject({ field: "state", oldValue: String(p.states[0]), newValue: String(p.states[2]) });
  });

  it("refuses a column from another project", async () => {
    const other = await projectWithColumns();
    const task = await newTask(actors.contributor, project);
    expect((await call(actors.contributor, "POST", `/api/tasks/${task.id}/move`, { stateId: other.states[0] })).status).toBe(400);
  });
});

describe("TASK-2 Board data", () => {
  it("returns columns, cards with label and checklist counts, members and the people on cards", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const contributor = await actorAs("contributor", p.id);
    const task = await newTask(admin, p, { assigneeId: contributor.userId });
    await call(admin, "POST", `/api/tasks/${task.id}/subtasks`, { title: "One" });
    const two = (await (await call(admin, "POST", `/api/tasks/${task.id}/subtasks`, { title: "Two" })).json()) as { subtasks: { id: number }[] };
    await call(admin, "PATCH", `/api/subtasks/${two.subtasks[1]!.id}`, { done: true });
    const data = await board(admin, p);
    expect(data.states.map((s) => s.name)).toEqual(DEFAULT_WORKFLOW.map((s) => s.name));
    expect(data.tasks[0]).toMatchObject({ id: task.id, subtasksTotal: 2, subtasksDone: 1 });
    expect(data.members.map((m) => [m.id, m.role]).sort()).toEqual(
      [
        [admin.userId, "admin"],
        [contributor.userId, "contributor"],
      ].sort(),
    );
    expect(data.people.map((x) => x.id).sort()).toEqual([admin.userId, contributor.userId].sort());
  });
});

describe("TASK-3 Subtasks", () => {
  it("adds, ticks, reorders and deletes checklist items, with history and an audited delete", async () => {
    const task = await newTask(actors.contributor, project);
    for (const title of ["Buy AA", "Buy 9V", "Swap"]) await call(actors.contributor, "POST", `/api/tasks/${task.id}/subtasks`, { title });
    let res = await call(actors.contributor, "GET", `/api/tasks/${task.id}`);
    let { subtasks } = ((await res.json()) as { task: TaskDetail }).task;
    expect(subtasks.map((s) => s.title)).toEqual(["Buy AA", "Buy 9V", "Swap"]);

    res = await call(actors.contributor, "PATCH", `/api/subtasks/${subtasks[2]!.id}`, { position: 0 });
    subtasks = ((await res.json()) as { subtasks: TaskDetail["subtasks"] }).subtasks;
    expect(subtasks.map((s) => s.title)).toEqual(["Swap", "Buy AA", "Buy 9V"]);

    res = await call(actors.contributor, "PATCH", `/api/subtasks/${subtasks[0]!.id}`, { done: true });
    expect(((await res.json()) as { subtasks: TaskDetail["subtasks"] }).subtasks[0]).toMatchObject({ title: "Swap", done: true });

    expect((await call(actors.contributor, "DELETE", `/api/subtasks/${subtasks[1]!.id}`)).status).toBe(428);
    expect((await call(actors.viewer, "DELETE", `/api/subtasks/${subtasks[1]!.id}`, undefined, confirm(TASK_CONFIRM.deleteSubtask))).status).toBe(403);
    res = await call(actors.contributor, "DELETE", `/api/subtasks/${subtasks[1]!.id}`, undefined, confirm(TASK_CONFIRM.deleteSubtask));
    expect(((await res.json()) as { subtasks: unknown[] }).subtasks).toHaveLength(2);
    expect(await auditFor("subtask.deleted", subtasks[1]!.id)).toHaveLength(1);

    const detail = ((await (await call(actors.contributor, "GET", `/api/tasks/${task.id}`)).json()) as { task: TaskDetail }).task;
    expect(detail.events.map((e) => e.field)).toEqual(["created", "subtask_added", "subtask_added", "subtask_added", "subtask_done", "subtask_removed"]);
  });

  it("caps a checklist at 50 items", async () => {
    const task = await newTask(actors.contributor, project);
    await env.DB.prepare(
      "INSERT INTO subtasks (task_id, title, position) SELECT ?1, 'Item ' || value, value FROM json_each(?2)",
    )
      .bind(task.id, JSON.stringify(Array.from({ length: 50 }, (_, i) => i)))
      .run();
    expect((await call(actors.contributor, "POST", `/api/tasks/${task.id}/subtasks`, { title: "One more" })).status).toBe(409);
  });
});

describe("TASK-4 Comments with @mentions", () => {
  const mentionDoc = (id: number, text = "Can you check this? ") => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }, { type: "mention", attrs: { id: String(id), label: "Admin" } }] }],
  });

  it("Viewers can comment; mentions of project members are saved; only the author edits, shown as edited", async () => {
    const task = await newTask(actors.contributor, project);
    const outsider = await actorAs("contributor", (await projectWithColumns()).id);
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ping " },
            { type: "mention", attrs: { id: String(actors.projectAdmin.userId), label: "Admin" } },
            { type: "mention", attrs: { id: String(outsider.userId), label: "Outsider" } },
          ],
        },
      ],
    };
    const res = await call(actors.viewer, "POST", `/api/tasks/${task.id}/comments`, { body: doc });
    expect(res.status).toBe(201);
    const { comment } = (await res.json()) as { comment: { id: number; editedAt: number | null } };
    expect(comment.editedAt).toBeNull();
    const { results } = await env.DB.prepare("SELECT user_id, comment_id FROM mentions WHERE task_id = ?").bind(task.id).all();
    // The outsider can't see the project, so isn't recorded.
    expect(results).toEqual([{ user_id: actors.projectAdmin.userId, comment_id: comment.id }]);

    expect((await call(actors.contributor, "PATCH", `/api/comments/${comment.id}`, { body: docFromText("Not mine") })).status).toBe(403);
    const edited = await call(actors.viewer, "PATCH", `/api/comments/${comment.id}`, { body: mentionDoc(actors.projectAdmin.userId, "Updated ") });
    expect(((await edited.json()) as { comment: { editedAt: number } }).comment.editedAt).toBeGreaterThan(0);
    // The same person mentioned again isn't a new mention.
    const count = await env.DB.prepare("SELECT count(*) AS n FROM mentions WHERE task_id = ?").bind(task.id).first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it("opening the task marks the viewer's mentions seen", async () => {
    const task = await newTask(actors.contributor, project);
    await call(actors.contributor, "POST", `/api/tasks/${task.id}/comments`, { body: mentionDoc(actors.projectAdmin.userId) });
    const unseen = () => env.DB.prepare("SELECT count(*) AS n FROM mentions WHERE task_id = ? AND seen_at IS NULL").bind(task.id).first<{ n: number }>();
    expect((await unseen())!.n).toBe(1);
    await call(actors.projectAdmin, "GET", `/api/tasks/${task.id}`);
    expect((await unseen())!.n).toBe(0);
  });

  it("the author or an admin deletes a comment, through the confirmation dialog, audited", async () => {
    const task = await newTask(actors.contributor, project);
    const res = await call(actors.contributor, "POST", `/api/tasks/${task.id}/comments`, { body: docFromText("Spare cables are in box 3") });
    const { comment } = (await res.json()) as { comment: { id: number } };
    expect((await ftsRow(task.id))!.body).toContain("Spare cables");
    expect((await call(actors.viewer, "DELETE", `/api/comments/${comment.id}`, undefined, confirm(TASK_CONFIRM.deleteComment))).status).toBe(403);
    expect((await call(actors.projectAdmin, "DELETE", `/api/comments/${comment.id}`)).status).toBe(428);
    expect((await call(actors.projectAdmin, "DELETE", `/api/comments/${comment.id}`, undefined, confirm(TASK_CONFIRM.deleteComment))).status).toBe(200);
    expect((await ftsRow(task.id))!.body).not.toContain("Spare cables");
    expect(await auditFor("comment.deleted", comment.id)).toHaveLength(1);
    const detail = ((await (await call(actors.contributor, "GET", `/api/tasks/${task.id}`)).json()) as { task: TaskDetail }).task;
    expect(detail.comments).toHaveLength(0);
  });

  it("rejects empty comments and formats comments don't allow", async () => {
    const task = await newTask(actors.contributor, project);
    expect((await call(actors.contributor, "POST", `/api/tasks/${task.id}/comments`, { body: { type: "doc", content: [] } })).status).toBe(400);
    const heading = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "x" }] }] };
    expect((await call(actors.contributor, "POST", `/api/tasks/${task.id}/comments`, { body: heading })).status).toBe(400);
  });
});

describe("TASK-8 Watchers", () => {
  it("anyone who can see a task can follow and unfollow it", async () => {
    const task = await newTask(actors.contributor, project);
    expect((await call(actors.viewer, "PUT", `/api/tasks/${task.id}/watch`)).status).toBe(200);
    let detail = ((await (await call(actors.viewer, "GET", `/api/tasks/${task.id}`)).json()) as { task: TaskDetail }).task;
    expect(detail.watcherIds).toContain(actors.viewer.userId);
    await call(actors.viewer, "DELETE", `/api/tasks/${task.id}/watch`);
    detail = ((await (await call(actors.viewer, "GET", `/api/tasks/${task.id}`)).json()) as { task: TaskDetail }).task;
    expect(detail.watcherIds).not.toContain(actors.viewer.userId);
    expect((await call(actors.pending, "PUT", `/api/tasks/${task.id}/watch`)).status).toBe(403);
  });
});

describe("TASK-10 Bulk edit", () => {
  it("changes assignee, status, labels and due date for several tasks, with history", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const helper = await actorAs("contributor", p.id);
    const label = ((await (await call(admin, "POST", `/api/projects/${p.id}/labels`, { name: "Sunday", colour: "amber" })).json()) as { label: { id: number } }).label;
    const tasks = [await newTask(admin, p), await newTask(admin, p)];
    const res = await call(admin, "POST", `/api/projects/${p.id}/tasks/bulk`, {
      taskIds: tasks.map((t) => t.id),
      assigneeId: helper.userId,
      stateId: p.states[1],
      dueDate: "2027-02-07",
      addLabelIds: [label.id],
    });
    expect(await res.json()).toEqual({ updated: 2 });
    const cards = (await board(admin, p)).tasks;
    for (const card of cards) {
      expect(card).toMatchObject({ assigneeId: helper.userId, stateId: p.states[1], dueDate: "2027-02-07", labelIds: [label.id], version: 1 });
    }
    const detail = ((await (await call(admin, "GET", `/api/tasks/${tasks[0]!.id}`)).json()) as { task: TaskDetail }).task;
    expect(detail.events.map((e) => e.field).sort()).toEqual(["assignee", "created", "due_date", "labels", "state"]);
    expect(detail.watcherIds).toContain(helper.userId);
    // Tasks from another project are refused.
    const elsewhere = await newTask(actors.contributor, project);
    expect((await call(admin, "POST", `/api/projects/${p.id}/tasks/bulk`, { taskIds: [elsewhere.id], dueDate: null })).status).toBe(400);
    // Viewers can't.
    const viewer = await actorAs("viewer", p.id);
    expect((await call(viewer, "POST", `/api/projects/${p.id}/tasks/bulk`, { taskIds: [tasks[0]!.id], dueDate: null })).status).toBe(403);
  });
});

describe("ORG-1, ORG-2, ORG-4 Labels, components and milestones", () => {
  it("Project Admins manage them; Contributors can't; names are unique per project; changes are audited", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const contributor = await actorAs("contributor", p.id);
    expect((await call(contributor, "POST", `/api/projects/${p.id}/labels`, { name: "Audio", colour: "blue" })).status).toBe(403);
    const res = await call(admin, "POST", `/api/projects/${p.id}/labels`, { name: "Audio", colour: "blue" });
    expect(res.status).toBe(201);
    const { label } = (await res.json()) as { label: { id: number; name: string } };
    expect((await call(admin, "POST", `/api/projects/${p.id}/labels`, { name: "audio", colour: "red" })).status).toBe(409);
    const renamed = await call(admin, "PATCH", `/api/labels/${label.id}`, { name: "Sound", colour: "teal" });
    expect(await renamed.json()).toEqual({ label: { id: label.id, name: "Sound", colour: "teal" } });
    expect((await auditFor("workflow.changed", label.id)).map((a) => a.detail.change)).toEqual(["created", "edited"]);

    const component = ((await (await call(admin, "POST", `/api/projects/${p.id}/components`, { name: "Lighting", leadId: contributor.userId })).json()) as {
      component: { id: number; leadId: number };
    }).component;
    expect(component.leadId).toBe(contributor.userId);
    expect((await call(admin, "POST", `/api/projects/${p.id}/components`, { name: "Video", leadId: actors.viewer.userId })).status).toBe(400);
    const milestone = ((await (await call(admin, "POST", `/api/projects/${p.id}/milestones`, { name: "Easter 2027", targetDate: "2027-03-28" })).json()) as {
      milestone: { id: number; released: boolean };
    }).milestone;
    expect(milestone.released).toBe(false);
  });

  it("deleting a label, component or milestone needs confirmation and clears it from tasks", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const label = ((await (await call(admin, "POST", `/api/projects/${p.id}/labels`, { name: "Old", colour: "red" })).json()) as { label: { id: number } }).label;
    const component = ((await (await call(admin, "POST", `/api/projects/${p.id}/components`, { name: "Old" })).json()) as { component: { id: number } }).component;
    const task = await newTask(admin, p, { labelIds: [label.id], componentId: component.id });
    expect((await call(admin, "DELETE", `/api/labels/${label.id}`)).status).toBe(428);
    expect((await call(admin, "DELETE", `/api/labels/${label.id}`, undefined, confirm(TASK_CONFIRM.deleteLabel))).status).toBe(200);
    expect((await call(admin, "DELETE", `/api/components/${component.id}`, undefined, confirm(TASK_CONFIRM.deleteComponent))).status).toBe(200);
    const card = (await board(admin, p)).tasks.find((t) => t.id === task.id)!;
    expect(card).toMatchObject({ labelIds: [], componentId: null });
    expect((await auditFor("workflow.changed", label.id)).map((a) => a.detail.change)).toEqual(["created", "deleted"]);
  });
});

describe("NAV-1 Search index stays in step", () => {
  it("indexes key, title, description and comments, and the rebuild script produces the same rows", async () => {
    const task = await newTask(actors.contributor, project, { title: "Fix projector", description: docFromText("Lamp hours exceeded") });
    expect(await ftsRow(task.id)).toMatchObject({ key: task.key, title: "Fix projector" });
    expect((await ftsRow(task.id))!.body).toContain("Lamp hours exceeded");
    await call(actors.contributor, "PATCH", `/api/tasks/${task.id}`, { version: task.version, title: "Replace projector lamp" });
    expect((await ftsRow(task.id))!.title).toBe("Replace projector lamp");
    const match = await env.DB.prepare("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ?").bind("projec*").all<{ rowid: number }>();
    expect(match.results.map((r) => r.rowid)).toContain(task.id);

    const before = await env.DB.prepare("SELECT rowid, project_id, key, title, body FROM tasks_fts ORDER BY rowid").all();
    await env.DB.batch(REBUILD_SEARCH_SQL.map((sql) => env.DB.prepare(sql)));
    const after = await env.DB.prepare("SELECT rowid, project_id, key, title, body FROM tasks_fts ORDER BY rowid").all();
    expect(after.results).toEqual(before.results);
  });
});

describe("Hub Feedback assignees (PROJ-7)", () => {
  it("App Admins can be assigned on the system project, which has no members", async () => {
    const hub = await createProject({ isSystem: true, hidden: true });
    await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, 'Backlog', 'todo', 0)").bind(hub.id).run();
    const admin = actors.appAdmin;
    const res = await call(admin, "POST", `/api/projects/${hub.id}/tasks`, { title: "Bug: board slow", assigneeId: admin.userId });
    expect(res.status).toBe(201);
    const data = (await (await call(admin, "GET", `/api/projects/${hub.id}/board`)).json()) as BoardResponse;
    expect(data.members.map((m) => m.id)).toContain(admin.userId);
    // A Project Admin of a team project still can't see it.
    expect((await call(actors.projectAdmin, "GET", `/api/projects/${hub.id}/board`)).status).toBe(403);
    await addMember(hub.id, actors.contributor.userId, "admin");
    expect((await call(actors.contributor, "GET", `/api/projects/${hub.id}/board`)).status).toBe(403);
  });
});

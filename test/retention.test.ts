import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CONFIRM_HEADER } from "../shared/access";
import { ADMIN_CONFIRM, DELETION_CONFIRM, type DeletionRequestRow, RETENTION_MS, type RetentionResponse } from "../shared/admin";
import { call, type Client, signedInClient } from "./helpers/auth";
import { actorAs, auditFor, createProject, setUser } from "./helpers/fixtures";

// ADM-6 data deletion requests and ADM-8 retention purge, against the real API and D1.

const REQUEST = { [CONFIRM_HEADER]: DELETION_CONFIRM.request };
const APPROVE = { [CONFIRM_HEADER]: DELETION_CONFIRM.approve };
const PURGE = { [CONFIRM_HEADER]: DELETION_CONFIRM.purge };

let admin: Client;

beforeAll(async () => {
  admin = await signedInClient({ name: "Retention Admin" });
  await setUser(admin.userId, { status: "active", appRole: "admin" });
});

async function requestIdFor(userId: number) {
  return (await env.DB.prepare("SELECT id FROM data_deletion_requests WHERE user_id = ? ORDER BY id DESC").bind(userId).first<number>("id"))!;
}

describe("ADM-6 data deletion requests", () => {
  it("anyone signed in (Pending included) can ask once; it's audited and shows on the admin queue", async () => {
    const pending = await signedInClient();
    expect((await call(pending, "POST", "/api/me/deletion-request")).status).toBe(428);
    expect((await call(pending, "POST", "/api/me/deletion-request", undefined, REQUEST)).status).toBe(201);
    expect((await call(pending, "POST", "/api/me/deletion-request", undefined, REQUEST)).status).toBe(200);
    expect(await (await call(pending, "GET", "/api/me/deletion-request")).json()).toMatchObject({ request: { status: "pending", decidedAt: null } });
    expect(await auditFor("user.deletion_requested", pending.userId)).toHaveLength(1);

    const queue = (await (await call(admin, "GET", "/api/admin/deletions")).json()) as { requests: DeletionRequestRow[] };
    expect(queue.requests.filter((r) => r.user.id === pending.userId)).toHaveLength(1);
    expect((await call(pending, "GET", "/api/admin/deletions")).status).toBe(403);
  });

  it("approving needs confirmation, replaces the person's details with 'Deleted User [ID]', keeps their tasks, and is audited", async () => {
    const p = await createProject();
    await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, 'To Do', 'todo', 0)").bind(p.id).run();
    const person = await actorAs("contributor", p.id, { email: `leaving-${crypto.randomUUID().slice(0, 6)}@example.org` });
    const task = ((await (await call(person, "POST", `/api/projects/${p.id}/tasks`, { title: "Still needed" })).json()) as { task: { id: number } }).task;
    await call(person, "POST", "/api/me/deletion-request", undefined, REQUEST);
    const id = await requestIdFor(person.userId);

    expect((await call(admin, "POST", `/api/admin/deletions/${id}/approve`)).status).toBe(428);
    expect((await call(admin, "POST", `/api/admin/deletions/${id}/approve`, undefined, APPROVE)).status).toBe(200);

    const user = await env.DB.prepare("SELECT name, email, google_sub, avatar_url, deleted_at FROM users WHERE id = ?").bind(person.userId).first<Record<string, unknown>>();
    expect(user).toMatchObject({ name: `Deleted User ${person.userId}`, email: `Deleted User ${person.userId}`, google_sub: `Deleted User ${person.userId}`, avatar_url: null });
    expect(user!.deleted_at).not.toBeNull();
    expect((await call(person, "GET", "/api/auth/me")).status).toBe(401);
    const kept = await env.DB.prepare("SELECT reporter_id FROM tasks WHERE id = ?").bind(task.id).first<number>("reporter_id");
    expect(kept).toBe(person.userId);
    const memberships = await env.DB.prepare("SELECT count(*) AS n FROM project_members WHERE user_id = ?").bind(person.userId).first<number>("n");
    expect(memberships).toBe(0);
    expect((await env.DB.prepare("SELECT status FROM data_deletion_requests WHERE id = ?").bind(id).first<string>("status"))).toBe("completed");
    expect(await auditFor("user.deletion_approved", person.userId)).toHaveLength(1);
    expect(await auditFor("user.deletion_completed", person.userId)).toHaveLength(1);
    expect((await call(admin, "POST", `/api/admin/deletions/${id}/approve`, undefined, APPROVE)).status).toBe(409);
  });

  it("rejecting clears the request flag and is audited; the last App Admin can't be deleted", async () => {
    const person = await signedInClient();
    await setUser(person.userId, { status: "active" });
    await call(person, "POST", "/api/me/deletion-request", undefined, REQUEST);
    const id = await requestIdFor(person.userId);
    expect((await call(admin, "POST", `/api/admin/deletions/${id}/reject`)).status).toBe(200);
    expect(await (await call(person, "GET", "/api/me/deletion-request")).json()).toMatchObject({ request: { status: "rejected" } });
    expect(await auditFor("user.deletion_rejected", person.userId)).toHaveLength(1);

    // An App Admin can't approve their own deletion; another App Admin must (and so one always remains).
    await call(admin, "POST", "/api/me/deletion-request", undefined, REQUEST);
    const own = await requestIdFor(admin.userId);
    expect(await (await call(admin, "POST", `/api/admin/deletions/${own}/approve`, undefined, APPROVE)).json()).toEqual({ error: "not_on_yourself" });
    await call(admin, "POST", `/api/admin/deletions/${own}/reject`);
  });
});

describe("ADM-8 retention queue and purge", () => {
  it("lists archived projects and suspended users past six months, nothing younger", async () => {
    const old = await createProject({ archived: true });
    const young = await createProject({ archived: true });
    await env.DB.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").bind(Date.now() - RETENTION_MS - 1000, old.id).run();
    const gone = await signedInClient();
    await call(admin, "POST", `/api/admin/users/${gone.userId}/suspend`, undefined, { [CONFIRM_HEADER]: ADMIN_CONFIRM.suspend });
    await env.DB.prepare("UPDATE users SET suspended_at = ? WHERE id = ?").bind(Date.now() - RETENTION_MS - 1000, gone.userId).run();
    const fresh = await signedInClient();
    await call(admin, "POST", `/api/admin/users/${fresh.userId}/suspend`, undefined, { [CONFIRM_HEADER]: ADMIN_CONFIRM.suspend });

    const queue = (await (await call(admin, "GET", "/api/admin/retention")).json()) as RetentionResponse;
    expect(queue.projects.map((p) => p.id)).toContain(old.id);
    expect(queue.projects.map((p) => p.id)).not.toContain(young.id);
    expect(queue.users.map((u) => u.id)).toContain(gone.userId);
    expect(queue.users.map((u) => u.id)).not.toContain(fresh.userId);
  });

  it("purging a project needs confirmation, removes its tasks and everything under them, and is audited", async () => {
    const p = await createProject();
    await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, 'To Do', 'todo', 0)").bind(p.id).run();
    const member = await actorAs("contributor", p.id);
    const created = (await (await call(member, "POST", `/api/projects/${p.id}/tasks`, { title: "Old work" })).json()) as { task: { id: number } };
    await call(member, "POST", `/api/tasks/${created.task.id}/comments`, { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Done" }] }] } });
    await env.DB.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").bind(Date.now() - RETENTION_MS - 1000, p.id).run();

    expect((await call(admin, "POST", `/api/admin/retention/projects/${p.id}/purge`)).status).toBe(428);
    expect((await call(admin, "POST", `/api/admin/retention/projects/${p.id}/purge`, undefined, PURGE)).status).toBe(200);
    for (const [table, where] of [
      ["tasks", "project_id = ?"],
      ["comments", "task_id = ?"],
      ["project_members", "project_id = ?"],
      ["workflow_states", "project_id = ?"],
    ] as const) {
      const id = where.startsWith("task") ? created.task.id : p.id;
      expect(await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).bind(id).first<number>("n")).toBe(0);
    }
    expect(await env.DB.prepare("SELECT name, deleted_at IS NOT NULL AS gone FROM projects WHERE id = ?").bind(p.id).first()).toEqual({ name: "Deleted project", gone: 1 });
    expect((await auditFor("retention.purge_confirmed", p.id))[0]).toMatchObject({ actor_id: admin.userId, detail: { key: p.key } });
    // Not eligible any more.
    expect((await call(admin, "POST", `/api/admin/retention/projects/${p.id}/purge`, undefined, PURGE)).status).toBe(404);
  });

  it("refuses projects that aren't eligible yet, and purges eligible suspended users like ADM-6", async () => {
    const young = await createProject({ archived: true });
    expect((await call(admin, "POST", `/api/admin/retention/projects/${young.id}/purge`, undefined, PURGE)).status).toBe(404);
    const p = await createProject();
    const user = await actorAs("contributor", p.id);
    await call(admin, "POST", `/api/admin/users/${user.userId}/suspend`, undefined, { [CONFIRM_HEADER]: ADMIN_CONFIRM.suspend });
    expect((await call(admin, "POST", `/api/admin/retention/users/${user.userId}/purge`, undefined, PURGE)).status).toBe(404);
    await env.DB.prepare("UPDATE users SET suspended_at = ? WHERE id = ?").bind(Date.now() - RETENTION_MS - 1000, user.userId).run();
    expect((await call(admin, "POST", `/api/admin/retention/users/${user.userId}/purge`, undefined, PURGE)).status).toBe(200);
    expect(await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(user.userId).first<string>("name")).toBe(`Deleted User ${user.userId}`);
    expect(await auditFor("retention.purge_confirmed", user.userId)).toHaveLength(1);
  });
});

import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN_CONFIRM, ADMIN_ERRORS, type AdminUserDetail, type AdminUserRow } from "../shared/admin";
import { CONFIRM_HEADER } from "../shared/access";
import { deviceLabel } from "../worker/admin/users";
import { call, type Client, request, signedInClient } from "./helpers/auth";
import { actorAs, addMember, auditFor, createProject, setUser } from "./helpers/fixtures";

// ADM-2, section 2 safety rules, session revocation and PROJ-4, against the real API and D1.

const SUSPEND = { [CONFIRM_HEADER]: ADMIN_CONFIRM.suspend };
const REVOKE = { [CONFIRM_HEADER]: ADMIN_CONFIRM.revokeSessions };
const ARCHIVE = { [CONFIRM_HEADER]: ADMIN_CONFIRM.archiveProject };

let admin: Client;

async function activePerson(opts: { name?: string; email?: string } = {}): Promise<Client> {
  const c = await signedInClient(opts);
  await setUser(c.userId, { status: "active" });
  return c;
}

beforeAll(async () => {
  admin = await activePerson({ name: "Directory Admin" });
  await setUser(admin.userId, { appRole: "admin" });
});

describe("ADM-2 user directory", () => {
  it("App Admins search by name or email and page through; everyone else gets 403", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const p = await createProject();
    const found = await activePerson({ name: `Quinn ${tag}`, email: `quinn.${tag}@example.org` });
    await addMember(p.id, found.userId, "contributor");
    const res = await call(admin, "GET", `/api/admin/users?q=${tag}`);
    const body = (await res.json()) as { users: AdminUserRow[]; total: number };
    expect(body.total).toBe(1);
    expect(body.users[0]).toMatchObject({ id: found.userId, email: `quinn.${tag}@example.org`, status: "active", projectCount: 1 });
    // Wildcards in the search are literal.
    expect(((await (await call(admin, "GET", "/api/admin/users?q=%25%25")).json()) as { total: number }).total).toBe(0);

    const projectAdmin = await actorAs("projectAdmin", p.id);
    expect((await call(projectAdmin, "GET", "/api/admin/users")).status).toBe(403);
    expect((await call(found, "GET", `/api/admin/users/${found.userId}`)).status).toBe(403);
  });

  it("shows a person's projects, roles and signed-in devices, never session ids", async () => {
    const p = await createProject();
    const person = await activePerson();
    await addMember(p.id, person.userId, "viewer");
    const detail = (await (await call(admin, "GET", `/api/admin/users/${person.userId}`)).json()) as AdminUserDetail;
    expect(detail.memberships).toEqual([{ projectId: p.id, key: p.key, name: p.name, role: "viewer" }]);
    expect(detail.activeSessions).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toMatch(/"id":"/);
  });

  it("describes devices without the raw user agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(deviceLabel(null)).toBe("Unknown device");
  });
});

describe("Section 2 safety rules: suspend, restore and App Admin role", () => {
  it("suspending needs the confirmation header, ends every session at once, and is audited", async () => {
    const person = await activePerson();
    expect((await call(admin, "POST", `/api/admin/users/${person.userId}/suspend`)).status).toBe(428);
    expect((await call(admin, "POST", `/api/admin/users/${person.userId}/suspend`, undefined, SUSPEND)).status).toBe(200);
    // Their very next request is refused (session ended; signing in again shows the suspended screen).
    expect((await call(person, "GET", "/api/auth/me")).status).toBe(401);
    const open = await env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL").bind(person.userId).first<number>("n");
    expect(open).toBe(0);
    expect((await auditFor("user.suspended", person.userId))[0]).toMatchObject({ actor_id: admin.userId, detail: { previousStatus: "active" } });
  });

  it("restores to Active when they'd been approved, else to Pending; audited", async () => {
    const p = await createProject();
    const member = await activePerson();
    await addMember(p.id, member.userId, "contributor");
    const neverApproved = await signedInClient();
    for (const c of [member, neverApproved]) await call(admin, "POST", `/api/admin/users/${c.userId}/suspend`, undefined, SUSPEND);
    expect(await (await call(admin, "POST", `/api/admin/users/${member.userId}/restore`)).json()).toEqual({ ok: true, status: "active" });
    expect(await (await call(admin, "POST", `/api/admin/users/${neverApproved.userId}/restore`)).json()).toEqual({ ok: true, status: "pending" });
    expect(await auditFor("user.restored", member.userId)).toHaveLength(1);
  });

  it("the last active App Admin can't be demoted or suspended, and nobody can suspend themselves", async () => {
    // Make this the only active admin: demote every other one for the test, then put them back.
    const others = await env.DB.prepare("SELECT id FROM users WHERE app_role = 'admin' AND status = 'active' AND id != ?").bind(admin.userId).all<{ id: number }>();
    await env.DB.prepare("UPDATE users SET app_role = 'member' WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(others.results.map((r) => r.id))).run();
    try {
      const helper = await activePerson();
      await setUser(helper.userId, { appRole: "admin" });
      const res = await call(helper, "PATCH", `/api/admin/users/${admin.userId}/role`, { appRole: "member" });
      expect(res.status).toBe(200);
      // Now helper is the last one.
      expect(await (await call(helper, "PATCH", `/api/admin/users/${helper.userId}/role`, { appRole: "member" })).json()).toEqual({ error: ADMIN_ERRORS.lastAdmin });
      expect(await (await call(helper, "POST", `/api/admin/users/${helper.userId}/suspend`, undefined, SUSPEND)).json()).toEqual({ error: ADMIN_ERRORS.self });
      // Promote again: audited both ways.
      expect((await call(helper, "PATCH", `/api/admin/users/${admin.userId}/role`, { appRole: "admin" })).status).toBe(200);
      const changes = await auditFor("user.app_role_changed", admin.userId);
      expect(changes.map((a) => a.detail)).toEqual(expect.arrayContaining([{ from: "admin", to: "member" }, { from: "member", to: "admin" }]));
    } finally {
      await env.DB.prepare("UPDATE users SET app_role = 'admin' WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify([admin.userId, ...others.results.map((r) => r.id)])).run();
    }
  });

  it("Pending or suspended people can't be made App Admins", async () => {
    const pending = await signedInClient();
    expect((await call(admin, "PATCH", `/api/admin/users/${pending.userId}/role`, { appRole: "admin" })).status).toBe(400);
  });
});

describe("Revoke another user's session (section 2, section 8 email)", () => {
  it("signs them out everywhere, audits once, and queues the instant email", async () => {
    const person = await activePerson();
    expect((await call(admin, "POST", `/api/admin/users/${person.userId}/revoke-sessions`)).status).toBe(428);
    const res = await call(admin, "POST", `/api/admin/users/${person.userId}/revoke-sessions`, undefined, REVOKE);
    expect(await res.json()).toEqual({ ok: true, revoked: 1 });
    expect((await call(person, "GET", "/api/auth/me")).status).toBe(401);
    expect((await auditFor("session.revoked", person.userId))[0]).toMatchObject({ actor_id: admin.userId, detail: { reason: "admin", sessions: 1 } });
    const email = await env.DB.prepare("SELECT mode, status FROM email_outbox WHERE user_id = ? AND template = 'session.revoked'").bind(person.userId).first();
    expect(email).toEqual({ mode: "instant", status: "pending" });
    // Nothing left to revoke: no second audit row or email.
    await call(admin, "POST", `/api/admin/users/${person.userId}/revoke-sessions`, undefined, REVOKE);
    expect(await auditFor("session.revoked", person.userId)).toHaveLength(1);
  });

  it("is App Admin only", async () => {
    const person = await activePerson();
    const other = await activePerson();
    expect((await call(other, "POST", `/api/admin/users/${person.userId}/revoke-sessions`, undefined, REVOKE)).status).toBe(403);
    expect((await request(`/api/admin/users/${person.userId}/revoke-sessions`, { method: "POST" })).status).toBe(401);
  });
});

describe("PROJ-4 archive and restore", () => {
  it("archiving needs confirmation, makes the project read-only, and restoring brings writes back; both audited", async () => {
    const p = await createProject();
    const contributor = await actorAs("contributor", p.id);
    await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, 'To Do', 'todo', 0)").bind(p.id).run();
    expect((await call(admin, "POST", `/api/projects/${p.id}/archive`)).status).toBe(428);
    expect((await call(admin, "POST", `/api/projects/${p.id}/archive`, undefined, ARCHIVE)).status).toBe(200);
    expect((await call(contributor, "POST", `/api/projects/${p.id}/tasks`, { title: "Blocked" })).status).toBe(403);
    expect((await call(contributor, "GET", `/api/projects/by-key/${p.key}`)).status).toBe(200);
    expect((await call(admin, "POST", `/api/projects/${p.id}/restore`)).status).toBe(200);
    expect((await call(contributor, "POST", `/api/projects/${p.id}/tasks`, { title: "Allowed" })).status).toBe(201);
    expect(await auditFor("project.archived", p.id)).toHaveLength(1);
    expect(await auditFor("project.restored", p.id)).toHaveLength(1);
  });

  it("Hub Feedback can't be archived, and only App Admins archive", async () => {
    const hub = await env.DB.prepare("SELECT id FROM projects WHERE is_system = 1").first<number>("id");
    if (hub) expect((await call(admin, "POST", `/api/projects/${hub}/archive`, undefined, ARCHIVE)).status).toBe(403);
    const p = await createProject();
    const projectAdmin = await actorAs("projectAdmin", p.id);
    expect((await call(projectAdmin, "POST", `/api/projects/${p.id}/archive`, undefined, ARCHIVE)).status).toBe(403);
  });
});

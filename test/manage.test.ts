import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CONFIRM_HEADER } from "../shared/access";
import { type InviteRow, MANAGE_CONFIRM, type MemberRow } from "../shared/admin";
import { inviteExpiryStatement } from "../worker/access/manage";
import { call, type Client, request, signedInClient } from "./helpers/auth";
import { actorAs, auditFor, createProject, setUser } from "./helpers/fixtures";

// ADM-7 invite management and section 2 "Change member roles", against the real API and D1.

const CANCEL = { [CONFIRM_HEADER]: MANAGE_CONFIRM.cancelInvite };
const REMOVE = { [CONFIRM_HEADER]: MANAGE_CONFIRM.removeMember };
const LOWER = { [CONFIRM_HEADER]: MANAGE_CONFIRM.lowerRole };

async function invite(admin: Client, projectId: number, email: string) {
  const res = await call(admin, "POST", `/api/projects/${projectId}/invites`, { email, role: "contributor" });
  const { link } = (await res.json()) as { link: string };
  const id = (await env.DB.prepare("SELECT id FROM invites WHERE email = ? ORDER BY id DESC").bind(email).first<number>("id"))!;
  return { id, token: link.split("/invite/")[1]! };
}

async function list(c: Client) {
  return ((await (await call(c, "GET", "/api/invites")).json()) as { invites: InviteRow[] }).invites;
}

describe("ADM-7 invite management", () => {
  it("Project Admins see their projects' invites with status; App Admins see all; others nothing", async () => {
    const p = await createProject();
    const other = await createProject();
    const projectAdmin = await actorAs("projectAdmin", p.id);
    const otherAdmin = await actorAs("projectAdmin", other.id);
    const appAdmin = await actorAs("appAdmin", p.id);
    const email = `inv-${crypto.randomUUID().slice(0, 8)}@example.org`;
    const { id } = await invite(projectAdmin, p.id, email);
    await invite(otherAdmin, other.id, `other-${email}`);

    const mine = await list(projectAdmin);
    expect(mine.find((i) => i.id === id)).toMatchObject({ email, role: "contributor", project: { key: p.key }, sentBy: "Test projectAdmin", status: "pending" });
    expect(mine.some((i) => i.email === `other-${email}`)).toBe(false);
    expect((await list(appAdmin)).some((i) => i.email === `other-${email}`)).toBe(true);
    const contributor = await actorAs("contributor", p.id);
    expect(await list(contributor)).toEqual([]);
  });

  it("cancelling needs confirmation, stops the link working, and is audited; only pending invites cancel", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const { id, token } = await invite(admin, p.id, "cancel.me@example.org");
    expect((await call(admin, "POST", `/api/invites/${id}/cancel`)).status).toBe(428);
    expect((await call(admin, "POST", `/api/invites/${id}/cancel`, undefined, CANCEL)).status).toBe(200);
    expect(await (await request(`/api/invites/${token}`)).json()).toEqual({ status: "expired" });
    expect((await list(admin)).find((i) => i.id === id)!.status).toBe("cancelled");
    expect(await auditFor("invite.cancelled", id)).toHaveLength(1);
    expect((await call(admin, "POST", `/api/invites/${id}/cancel`, undefined, CANCEL)).status).toBe(409);
    // Someone else's project: 403.
    const outsider = await actorAs("projectAdmin", (await createProject()).id);
    expect((await call(outsider, "POST", `/api/invites/${id}/cancel`, undefined, CANCEL)).status).toBe(403);
  });

  it("an expired invite is resent with a fresh 7-day link and a new email; the old link stays dead", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const email = `resend-${crypto.randomUUID().slice(0, 8)}@example.org`;
    const { id, token } = await invite(admin, p.id, email);
    expect((await call(admin, "POST", `/api/invites/${id}/resend`)).status).toBe(409);
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE id = ?").bind(Date.now() - 1000, id).run();
    expect((await list(admin)).find((i) => i.id === id)!.status).toBe("expired");

    const res = await call(admin, "POST", `/api/invites/${id}/resend`);
    const { link } = (await res.json()) as { link: string };
    expect(link).not.toContain(token);
    expect(await (await request(`/api/invites/${token}`)).json()).toEqual({ status: "expired" });
    expect(await (await request(`/api/invites/${link.split("/invite/")[1]}`)).json()).toMatchObject({ status: "valid" });
    const emails = await env.DB.prepare("SELECT count(*) AS n FROM email_outbox WHERE to_email = ? AND template = 'invite'").bind(email).first<number>("n");
    expect(emails).toBe(2);
    expect(await auditFor("invite.resent", id)).toHaveLength(1);
  });

  it("the daily job writes 'invite expired' once per invite", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const { id } = await invite(admin, p.id, `exp-${crypto.randomUUID().slice(0, 8)}@example.org`);
    const now = Date.now();
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE id = ?").bind(now - 60_000, id).run();
    await inviteExpiryStatement(env, now).run();
    await inviteExpiryStatement(env, now + 60_000).run();
    expect(await auditFor("invite.expired", id)).toHaveLength(1);
  });
});

describe("Section 2 change member roles and remove members", () => {
  it("everyone who can see the project sees its members; only admins get canManage", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const viewer = await actorAs("viewer", p.id);
    const res = (await (await call(viewer, "GET", `/api/projects/${p.id}/members`)).json()) as { members: MemberRow[]; canManage: boolean };
    expect(res.canManage).toBe(false);
    expect(res.members.map((m) => [m.userId, m.role])).toEqual([
      [admin.userId, "admin"],
      [viewer.userId, "viewer"],
    ]);
    expect(((await (await call(admin, "GET", `/api/projects/${p.id}/members`)).json()) as { canManage: boolean }).canManage).toBe(true);
    const outsider = await actorAs("contributor", (await createProject()).id);
    expect((await call(outsider, "GET", `/api/projects/${p.id}/members`)).status).toBe(403);
  });

  it("raising a role needs no confirmation; lowering does; both audited", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const member = await actorAs("viewer", p.id);
    expect((await call(admin, "PATCH", `/api/projects/${p.id}/members/${member.userId}`, { role: "contributor" })).status).toBe(200);
    expect((await call(admin, "PATCH", `/api/projects/${p.id}/members/${member.userId}`, { role: "viewer" })).status).toBe(428);
    expect((await call(admin, "PATCH", `/api/projects/${p.id}/members/${member.userId}`, { role: "viewer" }, LOWER)).status).toBe(200);
    const audit = await auditFor("project.member_role_changed", p.id);
    expect(audit.map((a) => [a.detail.from, a.detail.to])).toEqual([
      ["viewer", "contributor"],
      ["contributor", "viewer"],
    ]);
  });

  it("v4.7 Project Admins appoint and change admins, but never leave the project without one", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const otherAdmin = await actorAs("projectAdmin", p.id);
    const member = await actorAs("contributor", p.id);
    expect((await call(admin, "PATCH", `/api/projects/${p.id}/members/${member.userId}`, { role: "admin" })).status).toBe(200);
    expect((await call(admin, "PATCH", `/api/projects/${p.id}/members/${member.userId}`, { role: "contributor" }, LOWER)).status).toBe(200);
    expect((await call(admin, "DELETE", `/api/projects/${p.id}/members/${otherAdmin.userId}`, undefined, REMOVE)).status).toBe(200);
    // Now the only admin: they can't demote or remove themselves.
    const last = await call(admin, "PATCH", `/api/projects/${p.id}/members/${admin.userId}`, { role: "contributor" }, LOWER);
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: "last_project_admin" });
    expect((await call(admin, "DELETE", `/api/projects/${p.id}/members/${admin.userId}`, undefined, REMOVE)).status).toBe(409);
    // App Admins manage any project and may.
    const appAdmin = await signedInClient();
    await setUser(appAdmin.userId, { status: "active", appRole: "admin" });
    expect((await call(appAdmin, "PATCH", `/api/projects/${p.id}/members/${admin.userId}`, { role: "contributor" }, LOWER)).status).toBe(200);
  });

  it("v4.7 Project Admins edit their project's details and archive it; not Hidden, and not other projects", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const contributor = await actorAs("contributor", p.id);
    const edited = await call(admin, "PATCH", `/api/projects/${p.id}`, { name: "Sound and Stream", colour: "teal" });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ project: { name: "Sound and Stream", colour: "teal" } });
    expect((await call(admin, "PATCH", `/api/projects/${p.id}`, { hidden: true })).status).toBe(403);
    expect((await call(contributor, "PATCH", `/api/projects/${p.id}`, { name: "Mine" })).status).toBe(403);
    const other = await createProject();
    expect((await call(admin, "PATCH", `/api/projects/${other.id}`, { name: "Not mine" })).status).toBe(403);
    expect((await call(admin, "POST", `/api/projects/${p.id}/archive`, undefined, { "X-Confirm-Action": "project.archive" })).status).toBe(200);
    expect((await call(admin, "POST", `/api/projects/${p.id}/restore`)).status).toBe(200);
  });

  it("removing needs confirmation, takes away access at once, and is audited", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const member = await actorAs("contributor", p.id);
    expect((await call(admin, "DELETE", `/api/projects/${p.id}/members/${member.userId}`)).status).toBe(428);
    expect((await call(admin, "DELETE", `/api/projects/${p.id}/members/${member.userId}`, undefined, REMOVE)).status).toBe(200);
    expect((await call(member, "GET", `/api/projects/by-key/${p.key}`)).status).toBe(403);
    expect((await auditFor("project.member_removed", p.id))[0]).toMatchObject({ actor_id: admin.userId, detail: { userId: member.userId, role: "contributor" } });
    expect((await call(admin, "DELETE", `/api/projects/${p.id}/members/${member.userId}`, undefined, REMOVE)).status).toBe(404);
  });
});

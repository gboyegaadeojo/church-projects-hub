import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ACCESS_COPY } from "../shared/access";
import { call, type Client, freshSub, request, signedInClient, signIn } from "./helpers/auth";
import { actorAs, auditFor, createProject } from "./helpers/fixtures";

async function createInvite(inviter: Client, projectId: number, email: string, role = "contributor") {
  const res = await call(inviter, "POST", `/api/projects/${projectId}/invites`, { email, role });
  const body = (await res.json()) as { link?: string; expiresAt?: number };
  return { res, body, token: body.link ? body.link.split("/invite/")[1]! : "" };
}

async function inviteRow(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return env.DB.prepare("SELECT * FROM invites WHERE token = ?").bind(hash).first<Record<string, unknown>>();
}

async function userBySub(sub: string) {
  return env.DB.prepare("SELECT id, status FROM users WHERE google_sub = ?").bind(sub).first<{ id: number; status: string }>();
}

async function membership(projectId: number, userId: number) {
  return env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<string>("role");
}

describe("AUTH-9 Creating an invite", () => {
  it("a Project Admin invites to their project: 7-day single-use link, only a hash stored, audited", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const before = Date.now();
    const { res, body, token } = await createInvite(admin, p.id, "  New.Person@Example.org ", "viewer");
    expect(res.status).toBe(201);
    expect(body.link).toMatch(new RegExp(`^${env.APP_BASE_URL}/invite/[\\w-]{43}$`));
    expect(body.expiresAt!).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);

    const row = await inviteRow(token);
    expect(row).toMatchObject({ project_id: p.id, role: "viewer", email: "new.person@example.org", used_at: null });
    expect(row!.token).not.toBe(token);
    const audit = await auditFor("invite.sent", row!.id as number);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: admin.userId, detail: { projectId: p.id, role: "viewer" } });
    expect(JSON.stringify(audit[0])).not.toContain(token);
  });

  it("App Admins can invite to any team project, including hidden ones (PROJ-6)", async () => {
    const hidden = await createProject({ hidden: true });
    const admin = await actorAs("appAdmin", hidden.id);
    expect((await createInvite(admin, hidden.id, "x@example.org")).res.status).toBe(201);
  });

  it("Contributors, Viewers, Pending users and other projects' admins get 403; the system project takes no invites", async () => {
    const p = await createProject();
    const other = await createProject();
    for (const actor of [
      await actorAs("contributor", p.id),
      await actorAs("viewer", p.id),
      await actorAs("pending", p.id),
      await actorAs("projectAdmin", other.id),
    ]) {
      expect((await createInvite(actor, p.id, "x@example.org")).res.status).toBe(403);
    }
    const system = await createProject({ isSystem: true });
    expect((await createInvite(await actorAs("appAdmin", system.id), system.id, "x@example.org")).res.status).toBe(403);
  });

  it("validates the email and role", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    expect((await createInvite(admin, p.id, "not-an-email")).res.status).toBe(400);
    expect((await createInvite(admin, p.id, "x@example.org", "owner")).res.status).toBe(400);
  });
});

describe("AUTH-9 Following an invite link", () => {
  it("the link shows the project and role without signing in", async () => {
    const p = await createProject({ name: "Worship Team" });
    const { token } = await createInvite(await actorAs("projectAdmin", p.id), p.id, "a@example.org", "admin");
    const res = await request(`/api/invites/${token}`);
    expect(await res.json()).toEqual({ status: "valid", projectName: "Worship Team", role: "admin" });
  });

  it("unknown, malformed, used and expired links all read as expired", async () => {
    expect(await (await request(`/api/invites/${"A".repeat(43)}`)).json()).toEqual({ status: "expired" });
    expect(await (await request("/api/invites/short")).json()).toEqual({ status: "expired" });
  });

  it("the invited person skips the request queue on first sign-in: member with the invited role, Active, audited", async () => {
    const p = await createProject();
    const { token } = await createInvite(await actorAs("projectAdmin", p.id), p.id, "invited@example.org", "viewer");
    const sub = freshSub();
    // Email match ignores letter case.
    const { res, sessionCookie } = await signIn({ sub, email: "Invited@Example.org", invite: token });
    expect(res.headers.get("Location")).toBe("/work");
    expect(sessionCookie).toBeDefined();

    const user = (await userBySub(sub))!;
    expect(user.status).toBe("active");
    expect(await membership(p.id, user.id)).toBe("viewer");
    const row = await inviteRow(token);
    expect(row!.used_at).not.toBeNull();
    const audit = await auditFor("invite.used", row!.id as number);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: user.id, detail: { projectId: p.id, role: "viewer" } });
    const requests = await env.DB.prepare("SELECT count(*) AS n FROM access_requests WHERE user_id = ?")
      .bind(user.id)
      .first<number>("n");
    expect(requests).toBe(0);
  });

  it("is single-use", async () => {
    const p = await createProject();
    const { token } = await createInvite(await actorAs("projectAdmin", p.id), p.id, "once@example.org");
    expect((await signIn({ email: "once@example.org", invite: token })).res.headers.get("Location")).toBe("/work");
    const second = await signIn({ email: "once@example.org", invite: token });
    expect(second.res.headers.get("Location")).toBe("/invite-expired");
    expect(await (await request(`/api/invites/${token}`)).json()).toEqual({ status: "expired" });
  });

  it("an expired invite lands on the expired-invitation screen and grants nothing", async () => {
    const p = await createProject();
    const { token } = await createInvite(await actorAs("projectAdmin", p.id), p.id, "late@example.org");
    const row = await inviteRow(token);
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, row!.id).run();
    const sub = freshSub();
    const { res } = await signIn({ sub, email: "late@example.org", invite: token });
    expect(res.headers.get("Location")).toBe("/invite-expired");
    const user = (await userBySub(sub))!;
    expect(user.status).toBe("pending");
    expect(await membership(p.id, user.id)).toBeNull();
    expect(ACCESS_COPY.inviteExpired).toBe("This invitation has expired. Contact the project admin to request a new one.");
  });

  it("a different email lands on the mismatch screen and leaves the invite unused", async () => {
    const p = await createProject();
    const { token } = await createInvite(await actorAs("projectAdmin", p.id), p.id, "intended@example.org");
    const sub = freshSub();
    const { res } = await signIn({ sub, email: "someone.else@example.org", invite: token });
    expect(res.headers.get("Location")).toBe("/invite-mismatch");
    expect((await inviteRow(token))!.used_at).toBeNull();
    expect(await membership(p.id, (await userBySub(sub))!.id)).toBeNull();
    expect(ACCESS_COPY.inviteMismatch).toBe(
      "This invitation was sent to a different email address. Sign in with that Google account, or ask the project admin for a new invite.",
    );
    // The right person can still use it.
    expect((await signIn({ email: "intended@example.org", invite: token })).res.headers.get("Location")).toBe("/work");
  });

  it("someone already signed in accepts directly (session and CSRF required)", async () => {
    const p = await createProject();
    const { token } = await createInvite(await actorAs("projectAdmin", p.id), p.id, "member@example.org", "contributor");
    const member = await signedInClient({ email: "member@example.org" });

    const noCsrf = await request(`/api/invites/${token}/accept`, { method: "POST", cookie: member.cookie });
    expect(noCsrf.status).toBe(403);
    const res = await call(member, "POST", `/api/invites/${token}/accept`);
    expect(await res.json()).toEqual({ outcome: "accepted" });
    expect(await membership(p.id, member.userId)).toBe("contributor");
    expect(await (await call(member, "POST", `/api/invites/${token}/accept`)).json()).toEqual({ outcome: "expired" });
  });

  it("an invite never changes an existing member's role", async () => {
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id, { email: "boss@example.org" });
    const { token } = await createInvite(admin, p.id, "boss@example.org", "viewer");
    expect(await (await call(admin, "POST", `/api/invites/${token}/accept`)).json()).toEqual({ outcome: "accepted" });
    expect(await membership(p.id, admin.userId)).toBe("admin");
  });
});

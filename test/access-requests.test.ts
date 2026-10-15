import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ACCESS_COPY, type AccessQueueResponse, type MyAccessRequest, NUDGE_AFTER_MS, NUDGE_INTERVAL_MS } from "../shared/access";
import { call, type Client, request, signedInClient } from "./helpers/auth";
import { actorAs, auditFor, createProject, setUser } from "./helpers/fixtures";

const HOUR = 60 * 60 * 1000;
const DENY = { "X-Confirm-Action": "access_request.deny" };

async function requestable(client: Client) {
  const res = await call(client, "GET", "/api/projects/requestable");
  return ((await res.json()) as { projects: { id: number }[] }).projects.map((p) => p.id);
}

async function mine(client: Client) {
  const res = await call(client, "GET", "/api/access-requests/mine");
  return ((await res.json()) as { requests: MyAccessRequest[] }).requests;
}

async function submit(client: Client, projectIds: number[], note = "") {
  return call(client, "POST", "/api/access-requests", { projectIds, note });
}

async function requestIdFor(userId: number, projectId: number) {
  return (await env.DB.prepare(
    "SELECT id FROM access_requests WHERE user_id = ? AND project_id = ? ORDER BY id DESC LIMIT 1",
  )
    .bind(userId, projectId)
    .first<number>("id"))!;
}

async function userRow(userId: number) {
  return env.DB.prepare("SELECT status, app_role FROM users WHERE id = ?").bind(userId).first<{ status: string }>();
}

async function membership(projectId: number, userId: number) {
  return env.DB.prepare("SELECT role FROM project_members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<string>("role");
}

describe("AUTH-3 Pending user picks projects and adds a note", () => {
  it("lists only visible team projects: hidden, system and archived projects never appear", async () => {
    const open = await createProject();
    const hidden = await createProject({ hidden: true });
    const system = await createProject({ isSystem: true });
    const archived = await createProject({ archived: true });
    const ids = await requestable(await signedInClient());
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(system.id);
    expect(ids).not.toContain(archived.id);
  });

  it("creates one pending request per project with the note, audits each, and shows them on the status screen", async () => {
    const a = await createProject({ name: "Alpha" });
    const b = await createProject({ name: "Bravo" });
    const pending = await signedInClient();
    const res = await submit(pending, [a.id, b.id], "  I run the sound desk on Sundays.  ");
    expect(res.status).toBe(201);

    const { results } = await env.DB.prepare(
      "SELECT project_id, note, status FROM access_requests WHERE user_id = ? ORDER BY project_id",
    )
      .bind(pending.userId)
      .all();
    expect(results).toEqual([
      { project_id: a.id, note: "I run the sound desk on Sundays.", status: "pending" },
      { project_id: b.id, note: "I run the sound desk on Sundays.", status: "pending" },
    ]);
    const audit = await auditFor("access.request_submitted", await requestIdFor(pending.userId, a.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: pending.userId, target_type: "access_request", detail: { projectId: a.id, projectKey: a.key } });

    const status = await mine(pending);
    expect(status.map((r) => [r.project.id, r.status])).toEqual(
      expect.arrayContaining([
        [a.id, "pending"],
        [b.id, "pending"],
      ]),
    );
    // Requested projects leave the picker.
    expect(await requestable(pending)).not.toContain(a.id);
  });

  it("rejects a second open request for the same project", async () => {
    const p = await createProject();
    const pending = await signedInClient();
    expect((await submit(pending, [p.id])).status).toBe(201);
    expect((await submit(pending, [p.id])).status).toBe(409);
  });

  it("rejects requests for hidden or system projects (access is by invite only)", async () => {
    const pending = await signedInClient();
    expect((await submit(pending, [(await createProject({ hidden: true })).id])).status).toBe(409);
    expect((await submit(pending, [(await createProject({ isSystem: true })).id])).status).toBe(409);
  });

  it("validates the body: at least one project, no duplicates, note under 500 characters", async () => {
    const p = await createProject();
    const pending = await signedInClient();
    expect((await submit(pending, [])).status).toBe(400);
    expect((await submit(pending, [p.id, p.id])).status).toBe(400);
    expect((await submit(pending, [p.id], "x".repeat(501))).status).toBe(400);
  });

  it("requires a session", async () => {
    expect((await request("/api/projects/requestable")).status).toBe(401);
  });
});

describe("AUTH-5 Approved members can request more projects later", () => {
  it("an Active member sees projects they aren't in and can request them", async () => {
    const mineProject = await createProject();
    const another = await createProject();
    const member = await actorAs("contributor", mineProject.id);
    const ids = await requestable(member);
    expect(ids).not.toContain(mineProject.id);
    expect(ids).toContain(another.id);
    expect((await submit(member, [another.id])).status).toBe(201);
  });
});

describe("RATE-2 Access request limit (5 per day, one per project, in the user's timezone)", () => {
  it("rejects a submission that would go over 5 as a whole, with the exact copy", async () => {
    const projects = await Promise.all(Array.from({ length: 7 }, () => createProject()));
    const pending = await signedInClient();
    expect((await submit(pending, projects.slice(0, 3).map((p) => p.id))).status).toBe(201);

    const over = await submit(pending, projects.slice(3, 6).map((p) => p.id));
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "rate_limited", message: ACCESS_COPY.rateLimited });
    expect(ACCESS_COPY.rateLimited).toBe(
      "You've submitted the maximum requests for today. Check back tomorrow, or contact an admin directly.",
    );
    const count = await env.DB.prepare("SELECT count(*) AS n FROM access_requests WHERE user_id = ?")
      .bind(pending.userId)
      .first<number>("n");
    expect(count).toBe(3); // nothing from the rejected submission was written

    expect((await submit(pending, projects.slice(3, 5).map((p) => p.id))).status).toBe(201);
    expect((await submit(pending, [projects[5]!.id])).status).toBe(429);
  });

  it("counts only requests made since local midnight in the user's timezone", async () => {
    const projects = await Promise.all(Array.from({ length: 6 }, () => createProject()));
    const pending = await signedInClient();
    await setUser(pending.userId, { timezone: "America/Winnipeg" });
    // Five requests from yesterday (Winnipeg time) don't count today.
    for (const p of projects.slice(0, 5)) {
      await env.DB.prepare(
        "INSERT INTO access_requests (user_id, project_id, status, created_at, updated_at) VALUES (?1, ?2, 'denied', ?3, ?3)",
      )
        .bind(pending.userId, p.id, Date.now() - 36 * HOUR)
        .run();
    }
    expect((await submit(pending, [projects[5]!.id])).status).toBe(201);
  });
});

describe("AUTH-8 'Still waiting?' nudge after 48 hours, once per 24 hours per request", () => {
  async function setup() {
    const p = await createProject();
    const pending = await signedInClient();
    await submit(pending, [p.id]);
    return { pending, id: await requestIdFor(pending.userId, p.id) };
  }
  const nudge = (client: Client, id: number) => call(client, "POST", `/api/access-requests/${id}/nudge`);

  it("is not offered or accepted before 48 hours", async () => {
    const { pending, id } = await setup();
    expect((await mine(pending))[0]).toMatchObject({ stillWaiting: false, canNudge: false });
    expect((await nudge(pending, id)).status).toBe(409);
  });

  it("is offered after 48 hours, accepted once, then again only after 24 hours", async () => {
    const { pending, id } = await setup();
    await env.DB.prepare("UPDATE access_requests SET created_at = ? WHERE id = ?")
      .bind(Date.now() - NUDGE_AFTER_MS - HOUR, id)
      .run();
    expect((await mine(pending))[0]).toMatchObject({ stillWaiting: true, canNudge: true });

    expect((await nudge(pending, id)).status).toBe(200);
    expect((await mine(pending))[0]).toMatchObject({ stillWaiting: true, canNudge: false });
    expect((await nudge(pending, id)).status).toBe(409);

    await env.DB.prepare("UPDATE access_requests SET last_nudged_at = ? WHERE id = ?")
      .bind(Date.now() - NUDGE_INTERVAL_MS - 1000, id)
      .run();
    expect((await nudge(pending, id)).status).toBe(200);
  });

  it("can't be sent for someone else's request", async () => {
    const { id } = await setup();
    expect((await nudge(await signedInClient(), id)).status).toBe(404);
  });
});

describe("Section 7 approvals (matrix row: Approve access requests)", () => {
  async function pendingRequest(projectId: number) {
    const requester = await signedInClient();
    await submit(requester, [projectId]);
    return { requester, id: await requestIdFor(requester.userId, projectId) };
  }
  const approve = (c: Client, id: number, body: unknown = {}) => call(c, "POST", `/api/access-requests/${id}/approve`, body);
  const deny = (c: Client, id: number, body: unknown, headers = DENY) =>
    call(c, "POST", `/api/access-requests/${id}/deny`, body, headers);

  it("an App Admin approves with the default role (Contributor): membership added, user Active, audited", async () => {
    const p = await createProject();
    const admin = await actorAs("appAdmin", p.id);
    const { requester, id } = await pendingRequest(p.id);

    expect((await approve(admin, id)).status).toBe(200);
    expect(await membership(p.id, requester.userId)).toBe("contributor");
    expect((await userRow(requester.userId))!.status).toBe("active");
    expect((await mine(requester))[0]).toMatchObject({ status: "approved" });
    const audit = await auditFor("access.request_approved", id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: admin.userId, detail: { role: "contributor", projectId: p.id, userId: requester.userId } });
    // The approved person can now see the project's tasks: checked by the same matrix.
    const me = await call(requester, "GET", "/api/auth/me");
    expect(((await me.json()) as { user: { status: string } }).user.status).toBe("active");
  });

  it("a Project Admin approves for their own project with a chosen role", async () => {
    const p = await createProject();
    const projectAdmin = await actorAs("projectAdmin", p.id);
    const { requester, id } = await pendingRequest(p.id);
    expect((await approve(projectAdmin, id, { role: "viewer" })).status).toBe(200);
    expect(await membership(p.id, requester.userId)).toBe("viewer");
  });

  it("a Project Admin cannot decide another project's requests; Contributors, Viewers and Pending users cannot decide any", async () => {
    const p = await createProject();
    const other = await createProject();
    const { id } = await pendingRequest(p.id);
    for (const actor of [
      await actorAs("projectAdmin", other.id),
      await actorAs("contributor", p.id),
      await actorAs("viewer", p.id),
      await actorAs("pending", p.id),
    ]) {
      expect((await approve(actor, id)).status).toBe(403);
      expect((await deny(actor, id, { reason: "No" })).status).toBe(403);
    }
    expect((await env.DB.prepare("SELECT status FROM access_requests WHERE id = ?").bind(id).first<string>("status"))).toBe(
      "pending",
    );
  });

  it("App Admins decide for a project with no Project Admin", async () => {
    const p = await createProject();
    const admin = await actorAs("appAdmin", p.id);
    const { id } = await pendingRequest(p.id);
    const queue = (await (await call(admin, "GET", "/api/admin/access-queue")).json()) as AccessQueueResponse;
    expect(queue.requests.find((r) => r.id === id)).toMatchObject({ noProjectAdmin: true });
    expect((await approve(admin, id)).status).toBe(200);
  });

  it("a request can be decided only once", async () => {
    const p = await createProject();
    const admin = await actorAs("appAdmin", p.id);
    const { id } = await pendingRequest(p.id);
    expect((await approve(admin, id)).status).toBe(200);
    expect((await approve(admin, id)).status).toBe(409);
    expect((await deny(admin, id, { reason: "Late" })).status).toBe(409);
    expect(await auditFor("access.request_approved", id)).toHaveLength(1);
  });

  it("rejects an unknown role", async () => {
    const p = await createProject();
    const admin = await actorAs("appAdmin", p.id);
    const { id } = await pendingRequest(p.id);
    expect((await approve(admin, id, { role: "owner" })).status).toBe(400);
  });

  it("denial requires the confirmation header (428) and a reason (400); the reason reaches the requester and the audit log", async () => {
    const p = await createProject();
    const projectAdmin = await actorAs("projectAdmin", p.id);
    const { requester, id } = await pendingRequest(p.id);

    expect((await deny(projectAdmin, id, { reason: "Team is full" }, {} as typeof DENY)).status).toBe(428);
    expect((await deny(projectAdmin, id, { reason: "Team is full" }, { "X-Confirm-Action": "something.else" })).status).toBe(428);
    expect((await deny(projectAdmin, id, { reason: "   " })).status).toBe(400);

    expect((await deny(projectAdmin, id, { reason: "We're full until January." })).status).toBe(200);
    expect((await mine(requester))[0]).toMatchObject({ status: "denied", decisionReason: "We're full until January." });
    expect((await userRow(requester.userId))!.status).toBe("pending");
    expect(await membership(p.id, requester.userId)).toBeNull();
    const audit = await auditFor("access.request_denied", id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: projectAdmin.userId, detail: { reason: "We're full until January." } });
    // Section 11.6: after a denial the person can request a different project, or the same one again.
    expect(await requestable(requester)).toContain(p.id);
  });
});

describe("Access queue (section 11.12, ADM-1 subset)", () => {
  it("App Admins see every pending request; Project Admins only their projects'; others get 403", async () => {
    const a = await createProject();
    const b = await createProject();
    const appAdmin = await actorAs("appAdmin", a.id);
    const adminOfA = await actorAs("projectAdmin", a.id);
    const requester = await signedInClient({ name: "Queue Person" });
    await submit(requester, [a.id, b.id], "Hello");
    const [ra, rb] = [await requestIdFor(requester.userId, a.id), await requestIdFor(requester.userId, b.id)];

    const all = (await (await call(appAdmin, "GET", "/api/admin/access-queue")).json()) as AccessQueueResponse;
    expect(all.requests.map((r) => r.id)).toEqual(expect.arrayContaining([ra, rb]));

    const own = (await (await call(adminOfA, "GET", "/api/admin/access-queue")).json()) as AccessQueueResponse;
    expect(own.requests.map((r) => r.id)).toContain(ra);
    expect(own.requests.map((r) => r.id)).not.toContain(rb);
    expect(own.requests.find((r) => r.id === ra)).toMatchObject({
      note: "Hello",
      requester: { name: "Queue Person" },
      project: { id: a.id, key: a.key },
      noProjectAdmin: false,
    });
    expect(own.invitableProjects.map((p) => p.id)).toEqual([a.id]);

    expect((await call(await actorAs("contributor", a.id), "GET", "/api/admin/access-queue")).status).toBe(403);
    expect((await call(await actorAs("pending", a.id), "GET", "/api/admin/access-queue")).status).toBe(403);
  });

  it("/api/auth/me tells the app whether to show the queue link", async () => {
    const p = await createProject();
    const canReview = async (c: Client) =>
      ((await (await call(c, "GET", "/api/auth/me")).json()) as { canReviewAccess: boolean }).canReviewAccess;
    expect(await canReview(await actorAs("appAdmin", p.id))).toBe(true);
    expect(await canReview(await actorAs("projectAdmin", p.id))).toBe(true);
    expect(await canReview(await actorAs("contributor", p.id))).toBe(false);
    expect(await canReview(await actorAs("pending", p.id))).toBe(false);
  });

  it("a suspended requester's request leaves the queue and can't be approved", async () => {
    const p = await createProject();
    const admin = await actorAs("appAdmin", p.id);
    const requester = await signedInClient();
    await submit(requester, [p.id]);
    const id = await requestIdFor(requester.userId, p.id);
    await setUser(requester.userId, { status: "suspended" });
    const queue = (await (await call(admin, "GET", "/api/admin/access-queue")).json()) as AccessQueueResponse;
    expect(queue.requests.map((r) => r.id)).not.toContain(id);
    expect((await call(admin, "POST", `/api/access-requests/${id}/approve`, {})).status).toBe(409);
  });
});

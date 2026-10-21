import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CONFIRM_HEADER, NUDGE_AFTER_MS } from "../shared/access";
import type { TaskDetail } from "../shared/tasks";
import { type EmailSender, type OutgoingEmail, ResendSender } from "../worker/email/sender";
import { renderEmail } from "../worker/email/templates";
import { accessReminderStatement, DAILY_SWITCH_TO_DIGEST, PER_PERSON_DAILY, RETRY_AFTER_MIN, sendDueEmails } from "../worker/jobs/outbox";
import { call, type Client, signedInClient } from "./helpers/auth";
import { actorAs, createProject, setUser } from "./helpers/fixtures";

// Section 8 email: outbox rows written with the action, the cron sender, retries, dedupe and cap protection.
// Outbox rows are real D1 rows written by the real routes; only the provider (Resend) is replaced, by a recorder.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

type OutboxRow = {
  id: number;
  user_id: number | null;
  to_email: string | null;
  template: string;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  mode: string;
  status: string;
  attempts: number;
  send_after: number;
  last_error: string | null;
};

async function outboxFor(where: string, ...binds: unknown[]): Promise<OutboxRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM email_outbox WHERE ${where} ORDER BY id`)
    .bind(...binds)
    .all<OutboxRow & { payload_json: string }>();
  return results.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
}

class Recorder implements EmailSender {
  sent: OutgoingEmail[] = [];
  failWith: Error | null = null;
  async send(email: OutgoingEmail) {
    if (this.failWith) throw this.failWith;
    this.sent.push(email);
  }
}

async function projectWithColumns() {
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

async function queue(userId: number | null, template: string, opts: { toEmail?: string; payload?: object; sendAfter?: number } = {}) {
  const row = await env.DB.prepare(
    `INSERT INTO email_outbox (user_id, to_email, template, payload_json, mode, send_after) VALUES (?1, ?2, ?3, ?4, 'instant', ?5) RETURNING id`,
  )
    .bind(userId, opts.toEmail ?? null, template, JSON.stringify(opts.payload ?? {}), opts.sendAfter ?? Date.now())
    .first<{ id: number }>();
  return row!.id;
}

/** Each sender test starts with an empty queue and nothing sent today, so earlier rows don't interfere. */
async function clearQueue() {
  await env.DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = 0 WHERE status = 'pending' OR sent_at > 0").run();
}

describe("Section 8 rule 1: the action and its email row commit together", () => {
  it("assigning a task queues an instant email for the assignee with the actor's name and the real key; never for the actor", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const alex = await actorAs("contributor", p.id);
    const { task } = (await (await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Replace stage left DI box", assigneeId: alex.userId })).json()) as {
      task: TaskDetail;
    };
    const rows = await outboxFor("template = 'task.assigned' AND json_extract(payload_json, '$.taskKey') = ?", task.key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: alex.userId, mode: "instant", status: "pending", payload: { taskKey: task.key, taskTitle: "Replace stage left DI box", actorName: "Test projectAdmin" } });
  });

  it("digest-default events are queued in digest mode (status change to the reporter)", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const alex = await actorAs("contributor", p.id);
    const { task } = (await (await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Order cables" })).json()) as { task: TaskDetail };
    await call(alex, "POST", `/api/tasks/${task.id}/move`, { stateId: p.states[1] });
    const rows = await outboxFor("template = 'task.status_changed' AND json_extract(payload_json, '$.taskKey') = ?", task.key);
    expect(rows).toEqual([expect.objectContaining({ user_id: admin.userId, mode: "digest", payload: expect.objectContaining({ stateName: "Doing" }) })]);
  });

  it("NOTIF-5: a person's own setting wins: digest moves an instant event to the digest; a stored 'off' still sends (v4.7)", async () => {
    const p = await projectWithColumns();
    const admin = await actorAs("projectAdmin", p.id);
    const quiet = await actorAs("contributor", p.id);
    const later = await actorAs("contributor", p.id);
    await env.DB.prepare("INSERT INTO notification_prefs (user_id, event_type, mode) VALUES (?, 'task.assigned', 'off'), (?, 'task.assigned', 'digest')")
      .bind(quiet.userId, later.userId)
      .run();
    await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Quiet one", assigneeId: quiet.userId });
    await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Later one", assigneeId: later.userId });
    // v4.7: email is required; an "off" from before falls back to the event's default.
    expect(await outboxFor("user_id = ? AND template = 'task.assigned'", quiet.userId)).toEqual([expect.objectContaining({ mode: "instant" })]);
    expect(await outboxFor("user_id = ? AND template = 'task.assigned'", later.userId)).toEqual([expect.objectContaining({ mode: "digest" })]);
    // The bell still gets it: preferences only shape email.
    const bell = await env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE user_id = ? AND type = 'task.assigned'").bind(quiet.userId).first<number>("n");
    expect(bell).toBe(1);
  });

  it("NOTIF-3: a denial emails the requester the reason; only the batch that wins the decision emails", async () => {
    const p = await projectWithColumns();
    const teamAdmin = await actorAs("projectAdmin", p.id);
    const newcomer = await actorAs("pending", p.id);
    await call(newcomer, "POST", "/api/access-requests", { projectIds: [p.id] });
    const requested = await outboxFor("template = 'access.requested' AND user_id = ?", teamAdmin.userId);
    expect(requested.at(-1)).toMatchObject({ mode: "instant", payload: expect.objectContaining({ projectName: p.name }) });

    const id = (await env.DB.prepare("SELECT id FROM access_requests WHERE user_id = ?").bind(newcomer.userId).first<number>("id"))!;
    const deny = () => call(teamAdmin, "POST", `/api/access-requests/${id}/deny`, { reason: "Full this season." }, { [CONFIRM_HEADER]: "access_request.deny" });
    const statuses = (await Promise.all([deny(), deny()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const decided = await outboxFor("template = 'access.decided' AND user_id = ?", newcomer.userId);
    expect(decided).toEqual([expect.objectContaining({ mode: "instant", payload: expect.objectContaining({ decision: "denied", reason: "Full this season." }) })]);
  });

  it("AUTH-8: a nudge emails the project's deciders once a day (dedupe key)", async () => {
    const p = await createProject();
    const teamAdmin = await actorAs("projectAdmin", p.id);
    const pending = await signedInClient();
    await call(pending, "POST", "/api/access-requests", { projectIds: [p.id] });
    const id = (await env.DB.prepare("SELECT id FROM access_requests WHERE user_id = ?").bind(pending.userId).first<number>("id"))!;
    await env.DB.prepare("UPDATE access_requests SET created_at = ? WHERE id = ?").bind(Date.now() - NUDGE_AFTER_MS - MIN, id).run();
    expect((await call(pending, "POST", `/api/access-requests/${id}/nudge`)).status).toBe(200);
    const rows = await outboxFor("template = 'access.nudge' AND user_id = ?", teamAdmin.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe(`nudge:${id}:${new Date().toISOString().slice(0, 10)}:${teamAdmin.userId}`);

    // Even if the 24-hour rule were bypassed the same day, the dedupe key stops a second email.
    await env.DB.prepare("UPDATE access_requests SET last_nudged_at = 0 WHERE id = ?").bind(id).run();
    expect((await call(pending, "POST", `/api/access-requests/${id}/nudge`)).status).toBe(200);
    expect(await outboxFor("template = 'access.nudge' AND user_id = ?", teamAdmin.userId)).toHaveLength(1);
  });

  it("AUTH-9: an invite is emailed to the address; once sent, the one-time link isn't kept", async () => {
    await clearQueue();
    const p = await createProject();
    const admin = await actorAs("projectAdmin", p.id);
    const res = await call(admin, "POST", `/api/projects/${p.id}/invites`, { email: "invitee@example.org", role: "viewer" });
    const { link } = (await res.json()) as { link: string };
    const [row] = await outboxFor("template = 'invite' AND to_email = 'invitee@example.org'");
    expect(row).toMatchObject({ user_id: null, mode: "instant", payload: expect.objectContaining({ link, projectName: p.name, role: "viewer" }) });

    const recorder = new Recorder();
    await sendDueEmails(env, recorder);
    const email = recorder.sent.find((e) => e.to === "invitee@example.org");
    expect(email?.text).toContain(link);
    const [after] = await outboxFor("id = ?", row!.id);
    expect(after).toMatchObject({ status: "sent" });
    expect(after!.payload.link).toBeUndefined();
  });
});

describe("Section 8 sending mechanics", () => {
  let person: Client;
  beforeEach(async () => {
    await clearQueue();
    person = await signedInClient({ email: `person-${crypto.randomUUID()}@example.org` });
    await setUser(person.userId, { status: "active" });
  });

  it("sends due rows and marks them sent; future rows wait", async () => {
    const due = await queue(person.userId, "task.assigned", { payload: { actorName: "Sam", taskKey: "MEDIA-42", taskTitle: "Replace stage left DI box", projectKey: "MEDIA" } });
    const future = await queue(person.userId, "task.assigned", { sendAfter: Date.now() + 10 * MIN });
    const recorder = new Recorder();
    expect(await sendDueEmails(env, recorder)).toMatchObject({ sent: 1 });
    expect(recorder.sent[0]).toMatchObject({ subject: "Sam assigned you MEDIA-42: Replace stage left DI box" });
    expect((await outboxFor("id = ?", due))[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect((await outboxFor("id = ?", future))[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("without a provider key, rows stay pending and no attempts are spent", async () => {
    const id = await queue(person.userId, "task.assigned");
    expect(await sendDueEmails(env, null)).toEqual({ sent: 0, failed: 0, digested: 0 });
    expect((await outboxFor("id = ?", id))[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("failures retry after 5, 30 and 120 minutes, then park as failed; the error never holds the address", async () => {
    const id = await queue(person.userId, "task.assigned");
    const recorder = new Recorder();
    recorder.failWith = new Error("Resend 503");
    let now = Date.now();
    for (const wait of RETRY_AFTER_MIN) {
      await sendDueEmails(env, recorder, now);
      const [row] = await outboxFor("id = ?", id);
      expect(row).toMatchObject({ status: "pending", send_after: now + wait * MIN, last_error: "Resend 503" });
      // Not due again before the wait is over.
      await sendDueEmails(env, recorder, now + wait * MIN - 1);
      expect((await outboxFor("id = ?", id))[0]!.attempts).toBe(row!.attempts);
      now += wait * MIN;
    }
    expect(await sendDueEmails(env, recorder, now)).toMatchObject({ failed: 1 });
    expect((await outboxFor("id = ?", id))[0]).toMatchObject({ status: "failed", attempts: 4 });
  });

  it("suspended people get nothing; the row parks as failed", async () => {
    const id = await queue(person.userId, "task.assigned");
    await setUser(person.userId, { status: "suspended" });
    const recorder = new Recorder();
    await sendDueEmails(env, recorder);
    expect(recorder.sent).toHaveLength(0);
    expect((await outboxFor("id = ?", id))[0]).toMatchObject({ status: "failed" });
  });
});

describe("Section 8 cap protection", () => {
  let person: Client;
  beforeEach(async () => {
    await clearQueue();
    person = await signedInClient({ email: `capped-${crypto.randomUUID()}@example.org` });
    await setUser(person.userId, { status: "active" });
  });

  it(`past ${PER_PERSON_DAILY} instant emails a day, the rest go to that person's digest — access-request emails stay instant`, async () => {
    for (let i = 0; i < PER_PERSON_DAILY + 2; i++) await queue(person.userId, "task.assigned");
    const access = await queue(person.userId, "access.requested");
    const recorder = new Recorder();
    expect(await sendDueEmails(env, recorder)).toEqual({ sent: PER_PERSON_DAILY + 1, failed: 0, digested: 2 });
    expect(await outboxFor("user_id = ? AND mode = 'digest' AND status = 'pending'", person.userId)).toHaveLength(2);
    expect((await outboxFor("id = ?", access))[0]).toMatchObject({ status: "sent" });
  });

  it(`at ${DAILY_SWITCH_TO_DIGEST} emails sent today (80% of 100), instant emails switch to digest except access-request emails`, async () => {
    const other = await signedInClient();
    const now = Date.now();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?2)
       INSERT INTO email_outbox (user_id, template, mode, status, send_after, sent_at) SELECT ?1, 'task.assigned', 'instant', 'sent', ?3, ?3 FROM n`,
    )
      .bind(other.userId, DAILY_SWITCH_TO_DIGEST, now)
      .run();
    const normal = await queue(person.userId, "task.mentioned");
    const access = await queue(person.userId, "access.decided");
    await sendDueEmails(env, new Recorder());
    expect((await outboxFor("id = ?", normal))[0]).toMatchObject({ status: "pending", mode: "digest" });
    expect((await outboxFor("id = ?", access))[0]).toMatchObject({ status: "sent" });
  });
});

describe("Section 7 / rule 6: access requests waiting more than 3 days remind every current App Admin", () => {
  it("one email per App Admin per day, counting requests that crossed 3 days since the last run; reruns add nothing", async () => {
    const now = Date.now();
    // Earlier tests leave other admins and requests; count only this test's rows.
    const before = await outboxFor("template = 'access.reminder'");
    const p = await createProject();
    const waiting = await signedInClient();
    const fresh = await signedInClient();
    const admin = await signedInClient();
    await setUser(admin.userId, { status: "active", appRole: "admin" });
    const retired = await signedInClient();
    await setUser(retired.userId, { status: "suspended", appRole: "admin" });
    await call(waiting, "POST", "/api/access-requests", { projectIds: [p.id] });
    await call(fresh, "POST", "/api/access-requests", { projectIds: [p.id] });
    await env.DB.prepare("UPDATE access_requests SET created_at = ? WHERE user_id = ?").bind(now - 3 * DAY - 2 * 60 * MIN, waiting.userId).run();

    await accessReminderStatement(env, now).run();
    await accessReminderStatement(env, now + MIN).run();
    const added = (await outboxFor("template = 'access.reminder'")).filter((r) => !before.some((b) => b.id === r.id));
    const mine = added.filter((r) => r.user_id === admin.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload.count).toBeGreaterThanOrEqual(1);
    expect(added.some((r) => r.user_id === retired.userId)).toBe(false);
    expect(added.some((r) => r.user_id === waiting.userId || r.user_id === fresh.userId)).toBe(false);
  });
});

describe("Section 8 email design", () => {
  it("escapes everything from people and keeps the subject to one line", () => {
    const r = renderEmail(
      "task.commented",
      { actorName: "<b>Sam</b>", taskKey: "MEDIA-1", taskTitle: 'Fix "mic" <script>', projectKey: "MEDIA", projectName: "Media & AV", dueDate: "2026-11-01" },
      { base: "https://hub.test", settings: "https://hub.test/settings/notifications" },
    );
    expect(r.subject).toBe('<b>Sam</b> commented on MEDIA-1: Fix "mic" <script>');
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(r.html).toContain("Media &amp; AV");
    expect(r.html).toContain("Sun, Nov 1, 2026");
    expect(r.html).toContain("Choose when they arrive");
    expect(r.html).not.toMatch(/unsubscribe/i);
    expect(r.text).toContain("Open task: https://hub.test/projects/MEDIA?task=MEDIA-1");
  });
});

describe("Section 5: the Resend sender", () => {
  it("posts to Resend with the bearer key and the church sender; errors never carry the address or key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    let status = 200;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status });
    }) as typeof fetch;
    try {
      const sender = new ResendSender("re_test_key", "media@ifcwpg.com");
      await sender.send({ to: "someone@example.org", subject: "Hi", html: "<p>Hi</p>", text: "Hi" });
      expect(calls[0]!.url).toBe("https://api.resend.com/emails");
      expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
      const body = JSON.parse(calls[0]!.init.body as string);
      expect(body).toMatchObject({
        from: "Church Projects Hub <media@ifcwpg.com>",
        to: ["someone@example.org"],
        reply_to: "media@ifcwpg.com",
      });
      expect(body.headers).toBeUndefined();

      status = 429;
      const error = await sender.send({ to: "someone@example.org", subject: "Hi", html: "", text: "" }).catch((e: Error) => e);
      expect((error as Error).message).toBe("Resend 429");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

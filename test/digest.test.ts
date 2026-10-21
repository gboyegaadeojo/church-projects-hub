import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { NotificationSettings } from "../shared/notifications";
import type { TaskDetail } from "../shared/tasks";
import type { EmailSender, OutgoingEmail } from "../worker/email/sender";
import { dueReminderStatements, queueDigests } from "../worker/jobs/digest";
import { sendDueEmails } from "../worker/jobs/outbox";
import { call, type Client, request, signedInClient } from "./helpers/auth";
import { actorAs, createProject, setUser } from "./helpers/fixtures";

// NOTIF-2 (due-date reminders), NOTIF-5 (settings and the 7 am digest), v4.7 required email (no "off"),
// section 8 rules 3 and 4, against the real routes and D1. Only the email provider is a recorder.

const HOUR = 60 * 60 * 1000;
const DUE = "template IN ('task.due_soon', 'task.due_tomorrow', 'task.overdue')";
// 20 Oct 2026 is CDT (UTC-5): 7 am in Winnipeg is 12:00 UTC, 3 am is 08:00 UTC.
const WINNIPEG_7AM = Date.UTC(2026, 9, 20, 12, 0);
const WINNIPEG_3AM = Date.UTC(2026, 9, 20, 8, 0);

class Recorder implements EmailSender {
  sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail) {
    this.sent.push(email);
  }
}

async function rows(where: string, ...binds: unknown[]) {
  const { results } = await env.DB.prepare(`SELECT * FROM email_outbox WHERE ${where} ORDER BY id`)
    .bind(...binds)
    .all<{ id: number; user_id: number; template: string; mode: string; status: string; dedupe_key: string | null; payload_json: string }>();
  return results.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) as Record<string, unknown> }));
}

async function activePerson(timezone?: string): Promise<Client> {
  const c = await signedInClient({ email: `p-${crypto.randomUUID()}@example.org` });
  await setUser(c.userId, { status: "active", ...(timezone ? { timezone } : {}) });
  return c;
}

async function queueDigestRow(userId: number, template: string, payload: object, createdAt = WINNIPEG_7AM - HOUR) {
  await env.DB.prepare(
    "INSERT INTO email_outbox (user_id, template, payload_json, mode, send_after, created_at) VALUES (?1, ?2, ?3, 'digest', ?4, ?4)",
  )
    .bind(userId, template, JSON.stringify(payload), createdAt)
    .run();
}

describe("NOTIF-5 email settings", () => {
  it("shows each event's mode with its default, saves changes and the timezone, and rejects unknown zones", async () => {
    const me = await activePerson();
    const get = async () => (await (await call(me, "GET", "/api/me/notification-settings")).json()) as NotificationSettings;
    const initial = await get();
    expect(initial.timezone).toBe("America/Winnipeg");
    expect(initial.events.find((e) => e.type === "task.assigned")).toEqual({ type: "task.assigned", mode: "instant", defaultMode: "instant" });
    expect(initial.events.some((e) => e.type === "project.weekly_summary")).toBe(false);

    expect((await call(me, "PUT", "/api/me/notification-settings", { timezone: "America/Toronto", events: { "task.assigned": "digest", "task.commented": "instant" } })).status).toBe(200);
    const after = await get();
    expect(after.timezone).toBe("America/Toronto");
    expect(after.events.find((e) => e.type === "task.assigned")!.mode).toBe("digest");
    expect(after.events.find((e) => e.type === "task.commented")!.mode).toBe("instant");
    // v4.7: email can't be turned off.
    expect((await call(me, "PUT", "/api/me/notification-settings", { events: { "task.commented": "off" } })).status).toBe(400);

    expect((await call(me, "PUT", "/api/me/notification-settings", { timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await call(me, "PUT", "/api/me/notification-settings", { events: { "task.assigned": "sometimes" } })).status).toBe(400);
    expect((await call(me, "PUT", "/api/me/notification-settings", {})).status).toBe(400);
  });

  it("requires a session and the CSRF token", async () => {
    expect((await request("/api/me/notification-settings")).status).toBe(401);
    const me = await activePerson();
    expect((await call({ ...me, csrfToken: "wrong" }, "PUT", "/api/me/notification-settings", { timezone: "America/Toronto" })).status).toBe(403);
  });
});

describe("v4.7 email is required for everyone", () => {
  it("old one-click unsubscribe links turn nothing off (410), and a stored 'off' counts as the default", async () => {
    const me = await activePerson();
    const res = await request(`/api/unsubscribe?u=${me.userId}&e=task.assigned&t=anything`, { method: "POST" });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "email_required" });
    // A setting saved as "off" before v4.7 reads back as the default and doesn't stop the email.
    await env.DB.prepare("INSERT INTO notification_prefs (user_id, event_type, mode) VALUES (?, 'task.commented', 'off')").bind(me.userId).run();
    const settings = (await (await call(me, "GET", "/api/me/notification-settings")).json()) as NotificationSettings;
    expect(settings.events.find((e) => e.type === "task.commented")!.mode).toBe("digest");
  });

  it("emails carry no unsubscribe link or header; the footer says they're on for everyone and links to Email settings", async () => {
    const me = await activePerson();
    await env.DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = 0 WHERE status = 'pending'").run();
    await env.DB.prepare("INSERT INTO email_outbox (user_id, template, payload_json, mode, send_after) VALUES (?, 'task.mentioned', '{}', 'instant', 0)").bind(me.userId).run();
    const recorder = new Recorder();
    await sendDueEmails(env, recorder);
    const email = recorder.sent[0]!;
    expect(email.html).not.toMatch(/unsubscribe/i);
    expect(email.text).not.toMatch(/unsubscribe/i);
    expect(email.html).toContain("Hub emails are on for everyone");
    expect(email.html).toContain("/settings/notifications");
  });
});

describe("Section 8 rule 3: the 7 am digest in each person's timezone", () => {
  it("gathers pending digest rows into one email at 7 am local time, once a day; later rows wait for tomorrow", async () => {
    const winnipeg = await activePerson("America/Winnipeg");
    const toronto = await activePerson("America/Toronto");
    await queueDigestRow(winnipeg.userId, "task.commented", { actorName: "Sam", taskKey: "MEDIA-1", taskTitle: "Sound check" });
    await queueDigestRow(winnipeg.userId, "task.status_changed", { actorName: "Sam", taskKey: "MEDIA-2", taskTitle: "Cables", stateName: "Done" });
    await queueDigestRow(toronto.userId, "task.commented", { taskKey: "MEDIA-3" });

    // 6 am in Winnipeg (7 am in Toronto): only Toronto's digest is built.
    await queueDigests(env, WINNIPEG_7AM - HOUR);
    expect(await rows("user_id = ? AND template = 'digest'", winnipeg.userId)).toHaveLength(0);
    expect(await rows("user_id = ? AND template = 'digest'", toronto.userId)).toHaveLength(1);

    await queueDigests(env, WINNIPEG_7AM);
    const [digest] = await rows("user_id = ? AND template = 'digest'", winnipeg.userId);
    expect(digest).toMatchObject({ mode: "instant", status: "pending", dedupe_key: `digest:${winnipeg.userId}:2026-10-20` });
    expect((digest!.payload.items as unknown[]).length).toBe(2);
    expect(await rows("user_id = ? AND template != 'digest' AND status = 'digested'", winnipeg.userId)).toHaveLength(2);

    // A row queued after the digest was built, and a rerun of the same hour: nothing is lost or repeated.
    await queueDigestRow(winnipeg.userId, "task.commented", { taskKey: "MEDIA-4" }, WINNIPEG_7AM + 1000);
    await queueDigests(env, WINNIPEG_7AM + 2000);
    expect(await rows("user_id = ? AND template = 'digest'", winnipeg.userId)).toHaveLength(1);
    expect(await rows("user_id = ? AND status = 'pending' AND mode = 'digest'", winnipeg.userId)).toHaveLength(1);

    // The regular sender delivers it.
    await env.DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = 0 WHERE status = 'pending' AND template != 'digest'").run();
    const recorder = new Recorder();
    await sendDueEmails(env, recorder, WINNIPEG_7AM + 5 * 60 * 1000);
    const email = recorder.sent.find((e) => e.subject === "Your daily summary: 2 updates");
    expect(email?.text).toContain("Sam commented on MEDIA-1: Sound check");
    expect(email?.text).toContain("MEDIA-2: Cables moved to Done");
    expect(email?.html).not.toMatch(/unsubscribe/i);
  });
});

describe("NOTIF-2 due-date reminders (daily job)", () => {
  async function setup() {
    const p = await createProject();
    const states: Record<string, number> = {};
    for (const [position, [name, category]] of [
      ["To Do", "todo"],
      ["Done", "done"],
    ].entries()) {
      const row = await env.DB.prepare("INSERT INTO workflow_states (project_id, name, category, position) VALUES (?, ?, ?, ?) RETURNING id")
        .bind(p.id, name, category, position)
        .first<{ id: number }>();
      states[category!] = row!.id;
    }
    const admin = await actorAs("projectAdmin", p.id);
    const alex = await actorAs("contributor", p.id);
    const make = async (title: string, dueDate: string, stateId = states.todo) =>
      ((await (await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title, dueDate, assigneeId: alex.userId, stateId })).json()) as { task: TaskDetail }).task;
    return { p, admin, alex, make, states };
  }

  it("due in 7 days and due tomorrow reach the assignee; overdue (the day after) also reaches project admins and the bell; done tasks never", async () => {
    const { admin, alex, make, states } = await setup();
    const soon = await make("Book the hall", "2026-10-27");
    const tomorrow = await make("Print bulletins", "2026-10-21");
    const late = await make("Return the projector", "2026-10-19");
    const finished = await make("Already done", "2026-10-19", states.done);
    const notYet = await make("Next month", "2026-11-20");

    await env.DB.batch(dueReminderStatements(env, WINNIPEG_3AM));
    const forAlex = await rows(`user_id = ? AND ${DUE}`, alex.userId);
    const byKey = (key: string) => forAlex.filter((r) => r.payload.taskKey === key).map((r) => r.template);
    expect(byKey(soon.key)).toEqual(["task.due_soon"]);
    expect(byKey(tomorrow.key)).toEqual(["task.due_tomorrow"]);
    expect(byKey(late.key)).toEqual(["task.overdue"]);
    expect(byKey(finished.key)).toEqual([]);
    expect(byKey(notYet.key)).toEqual([]);
    expect(forAlex.find((r) => r.template === "task.due_soon")).toMatchObject({ mode: "digest", dedupe_key: `due7:${soon.key}:2026-10-27:${alex.userId}` });

    const forAdmin = await rows(`user_id = ? AND ${DUE}`, admin.userId);
    expect(forAdmin.map((r) => [r.template, r.payload.taskKey])).toEqual([["task.overdue", late.key]]);

    const bell = await env.DB.prepare("SELECT user_id FROM notifications WHERE type = 'task.overdue' AND task_id = ? ORDER BY user_id").bind(late.id).all<{ user_id: number }>();
    expect(bell.results.map((r) => r.user_id).sort()).toEqual([admin.userId, alex.userId].sort());

    // Rule 4: a rerun queues nothing new and rings no bell twice.
    await env.DB.batch(dueReminderStatements(env, WINNIPEG_3AM + 60_000));
    expect(await rows(`user_id = ? AND ${DUE}`, alex.userId)).toHaveLength(forAlex.length);
    const again = await env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE type = 'task.overdue' AND task_id = ?").bind(late.id).first<number>("n");
    expect(again).toBe(2);
  });

  it("v4.6 reaches the secondary assignee too", async () => {
    const { p, admin, alex } = await setup();
    const sam = await actorAs("contributor", p.id);
    const task = ((await (
      await call(admin, "POST", `/api/projects/${p.id}/tasks`, { title: "Set up chairs", dueDate: "2026-10-21", assigneeId: alex.userId, secondaryAssigneeId: sam.userId })
    ).json()) as { task: TaskDetail }).task;
    await env.DB.batch(dueReminderStatements(env, WINNIPEG_3AM));
    const forSam = await rows(`user_id = ? AND ${DUE} AND json_extract(payload_json, '$.taskKey') = ?`, sam.userId, task.key);
    expect(forSam.map((r) => r.template)).toEqual(["task.due_tomorrow"]);
  });

  it("follows each person's setting: a stored 'off' still sends (v4.7), instant skips the digest", async () => {
    const { alex, make } = await setup();
    await env.DB.prepare("INSERT INTO notification_prefs (user_id, event_type, mode) VALUES (?1, 'task.due_tomorrow', 'off'), (?1, 'task.due_soon', 'instant')")
      .bind(alex.userId)
      .run();
    const tomorrow = await make("Tomorrow", "2026-10-21");
    const soon = await make("Soon", "2026-10-27");
    await env.DB.batch(dueReminderStatements(env, WINNIPEG_3AM));
    expect(await rows(`user_id = ? AND ${DUE} AND json_extract(payload_json, '$.taskKey') = ?`, alex.userId, tomorrow.key)).toEqual([expect.objectContaining({ mode: "digest" })]);
    expect(await rows(`user_id = ? AND ${DUE} AND json_extract(payload_json, '$.taskKey') = ?`, alex.userId, soon.key)).toEqual([expect.objectContaining({ mode: "instant" })]);
  });
});

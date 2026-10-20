import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { FEEDBACK_DAILY_LIMIT, FEEDBACK_ERRORS, type MyFeedbackItem, type NewsItem } from "../shared/feedback";
import { parseMarkdown } from "../shared/markdown";
import type { NotificationsResponse } from "../shared/notifications";
import { ensureHubFeedback } from "../worker/projects/routes";
import { call, type Client, request, signedInClient } from "./helpers/auth";
import { auditFor, setUser } from "./helpers/fixtures";

// FDBK-1 to FDBK-5 and RATE-3 against the real API and D1.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0 obj");

let hub: { id: number; key: string };
let admin: Client;

async function activePerson(): Promise<Client> {
  const c = await signedInClient();
  await setUser(c.userId, { status: "active" });
  return c;
}

const bug = (c: Client, body: object = { whatHappened: "The board didn't load\nafter a refresh", expected: "To see my tasks", page: "/projects/MEDIA", browser: "Test browser" }) =>
  call(c, "POST", "/api/feedback/bug", body);

async function taskRow(id: number) {
  return env.DB.prepare("SELECT project_id, type, title, reporter_id, description_text FROM tasks WHERE id = ?").bind(id).first<{
    project_id: number;
    type: string;
    title: string;
    reporter_id: number;
    description_text: string;
  }>();
}

beforeAll(async () => {
  await ensureHubFeedback(env);
  hub = (await env.DB.prepare("SELECT id, key FROM projects WHERE is_system = 1").first<{ id: number; key: string }>())!;
  admin = await signedInClient();
  await setUser(admin.userId, { status: "active", appRole: "admin" });
});

describe("FDBK-2 / FDBK-4 Report a Bug lands in Hub Feedback", () => {
  it("creates a bug in Hub Feedback with the submitter as reporter, the page and browser in the description", async () => {
    const me = await activePerson();
    const res = await bug(me);
    expect(res.status).toBe(201);
    const { id, key } = (await res.json()) as { id: number; key: string };
    expect(key).toMatch(new RegExp(`^${hub.key}-\\d+$`));
    const row = await taskRow(id);
    expect(row).toMatchObject({ project_id: hub.id, type: "bug", title: "The board didn't load", reporter_id: me.userId });
    expect(row!.description_text).toContain("What I expected");
    expect(row!.description_text).toContain("/projects/MEDIA");
    expect(row!.description_text).toContain("Test browser");
  });

  it("Pending people can report too; the submitter still can't open Hub Feedback (PROJ-7)", async () => {
    const pending = await signedInClient();
    const res = await bug(pending);
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: string };
    expect((await call(pending, "GET", `/api/tasks/by-key/${key}`)).status).toBe(403);
    expect((await call(admin, "GET", `/api/tasks/by-key/${key}`)).status).toBe(200);
  });

  it("validates the form and requires a session", async () => {
    const me = await activePerson();
    expect((await bug(me, { whatHappened: "", expected: "x" })).status).toBe(400);
    expect((await request("/api/feedback/bug", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(401);
  });

  it("accepts one screenshot image from the submitter, shortly after; not PDFs, not other people, not twice", async () => {
    const me = await activePerson();
    const { id } = (await (await bug(me)).json()) as { id: number };
    const upload = (c: Client, body: Uint8Array) =>
      request(`/api/feedback/${id}/screenshot`, { method: "POST", ip: c.ip, cookie: c.cookie, headers: { "X-CSRF-Token": c.csrfToken, "X-Filename": "shot.png" }, body });
    expect((await upload(await activePerson(), PNG)).status).toBe(404);
    expect((await upload(me, PDF)).status).toBe(415);
    expect((await upload(me, PNG)).status).toBe(201);
    expect((await upload(me, PNG)).status).toBe(403);
    const files = await env.DB.prepare("SELECT filename, mime FROM attachments WHERE task_id = ?").bind(id).all();
    expect(files.results).toEqual([{ filename: "shot.png", mime: "image/png" }]);

    const { id: late } = (await (await bug(me)).json()) as { id: number };
    await env.DB.prepare("UPDATE tasks SET created_at = created_at - 11 * 60 * 1000 WHERE id = ?").bind(late).run();
    const res = await request(`/api/feedback/${late}/screenshot`, { method: "POST", ip: me.ip, cookie: me.cookie, headers: { "X-CSRF-Token": me.csrfToken }, body: PNG });
    expect(res.status).toBe(403);
  });
});

describe("FDBK-3 Request a Feature", () => {
  it("creates an idea with title, description and why it matters", async () => {
    const me = await activePerson();
    const res = await call(me, "POST", "/api/feedback/feature", { title: "Dark mode for the projector view", description: "Less glare", why: "Late services" });
    expect(res.status).toBe(201);
    const row = await taskRow(((await res.json()) as { id: number }).id);
    expect(row).toMatchObject({ type: "idea", title: "Dark mode for the projector view", project_id: hub.id });
    expect(row!.description_text).toContain("Why it matters");
  });
});

describe(`RATE-3 feedback limit (${FEEDBACK_DAILY_LIMIT} a day)`, () => {
  it("refuses the 21st submission of the day with the rate-limit code", async () => {
    const me = await activePerson();
    const now = Date.now();
    await env.DB.prepare(
      `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?3)
       INSERT INTO tasks (project_id, number, title, type, state_id, reporter_id, rank, created_at, updated_at)
       SELECT ?1, 100000 + ?2 * 100 + i, 'Earlier', 'bug', (SELECT id FROM workflow_states WHERE project_id = ?1 LIMIT 1), ?2, 'a' || i, ?4, ?4 FROM n`,
    )
      .bind(hub.id, me.userId, FEEDBACK_DAILY_LIMIT, now)
      .run();
    const res = await bug(me);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: FEEDBACK_ERRORS.rateLimited });
    // Yesterday's reports don't count.
    await env.DB.prepare("UPDATE tasks SET created_at = ? WHERE reporter_id = ?").bind(now - 2 * 86_400_000, me.userId).run();
    expect((await bug(me)).status).toBe(201);
  });
});

describe("FDBK-5 the submitter hears when their item changes status", () => {
  it("an admin moving the item notifies the submitter with the feedback event, and it shows on their list", async () => {
    const me = await activePerson();
    const { id, key } = (await (await bug(me)).json()) as { id: number; key: string };
    const states = await env.DB.prepare("SELECT id, name FROM workflow_states WHERE project_id = ? ORDER BY position").bind(hub.id).all<{ id: number; name: string }>();
    const next = states.results[1]!;
    expect((await call(admin, "POST", `/api/tasks/${id}/move`, { stateId: next.id })).status).toBe(200);

    const bell = (await (await call(me, "GET", "/api/notifications")).json()) as NotificationsResponse;
    expect(bell.items.find((n) => n.payload.taskKey === key)).toMatchObject({ type: "feedback.status_changed", payload: { stateName: next.name } });
    const email = await env.DB.prepare("SELECT mode FROM email_outbox WHERE user_id = ? AND template = 'feedback.status_changed'").bind(me.userId).first<string>("mode");
    expect(email).toBe("digest");

    const mine = (await (await call(me, "GET", "/api/feedback/mine")).json()) as { items: MyFeedbackItem[] };
    expect(mine.items.find((i) => i.key === key)).toMatchObject({ kind: "bug", status: next.name });
  });
});

describe("FDBK-1 What's New", () => {
  it("App Admins publish and edit (audited); everyone reads newest first; others can't publish", async () => {
    const member = await activePerson();
    expect((await call(member, "POST", "/api/news", { title: "Nope", bodyMd: "x" })).status).toBe(403);

    const first = (await (await call(admin, "POST", "/api/news", { title: "Board filters", bodyMd: "**New:** filters" })).json()) as { item: NewsItem };
    const second = (await (await call(admin, "POST", "/api/news", { title: "Email digests", bodyMd: "- at 7 am" })).json()) as { item: NewsItem };
    expect((await auditFor("news.published", second.item.id))[0]).toMatchObject({ actor_id: admin.userId, detail: { title: "Email digests" } });

    const edit = await call(admin, "PATCH", `/api/news/${first.item.id}`, { title: "Board filters", bodyMd: "**New:** saved filters" });
    expect(edit.status).toBe(200);
    expect(await auditFor("news.edited", first.item.id)).toHaveLength(1);
    expect((await call(member, "PATCH", `/api/news/${first.item.id}`, { title: "x", bodyMd: "y" })).status).toBe(403);
    expect((await call(admin, "PATCH", "/api/news/999999", { title: "x", bodyMd: "y" })).status).toBe(404);

    const list = (await (await call(member, "GET", "/api/news")).json()) as { items: NewsItem[]; canPublish: boolean };
    expect(list.canPublish).toBe(false);
    const ids = list.items.map((i) => i.id);
    expect(ids.indexOf(second.item.id)).toBeLessThan(ids.indexOf(first.item.id));
    expect(list.items.find((i) => i.id === first.item.id)!.bodyMd).toBe("**New:** saved filters");
  });

  it("the dot shows while something is unread and clears when the page is opened (user_news_seen)", async () => {
    const me = await activePerson();
    const unread = async () => ((await (await call(me, "GET", "/api/news/unread")).json()) as { unread: boolean }).unread;
    await call(admin, "POST", "/api/news", { title: "Something new", bodyMd: "Hello" });
    expect(await unread()).toBe(true);
    expect((await call(me, "POST", "/api/news/seen")).status).toBe(200);
    expect(await unread()).toBe(false);
    await call(admin, "POST", "/api/news", { title: "Another", bodyMd: "Hi" });
    expect(await unread()).toBe(true);
  });
});

describe("Section 11.9 Markdown with raw HTML disabled", () => {
  it("parses bold, links and lists; HTML stays text and unsafe links lose their href", () => {
    expect(parseMarkdown("Hello **world** and [docs](https://example.org)\n\n- one\n- two\n\n1. first")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Hello " },
          { type: "bold", children: [{ type: "text", text: "world" }] },
          { type: "text", text: " and " },
          { type: "link", href: "https://example.org", children: [{ type: "text", text: "docs" }] },
        ],
      },
      { type: "list", ordered: false, items: [[{ type: "text", text: "one" }], [{ type: "text", text: "two" }]] },
      { type: "list", ordered: true, items: [[{ type: "text", text: "first" }]] },
    ]);
    expect(parseMarkdown("<script>alert(1)</script> [x](javascript:void0)")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "<script>alert(1)</script> x" }] },
    ]);
  });
});

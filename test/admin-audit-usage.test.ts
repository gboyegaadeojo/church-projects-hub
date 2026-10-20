import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { AUDIT_PAGE_SIZE, type AuditEntry, type UsageResponse } from "../shared/admin";
import { csvField } from "../worker/admin/audit";
import { fetchAnalytics, readUsage, usageChecks } from "../worker/admin/usage";
import { call, type Client, signedInClient } from "./helpers/auth";
import { setUser } from "./helpers/fixtures";

// ADM-3 audit log viewer and export, ADM-4/5 usage panel and warning, NFR-15 error alert — real API and D1.

let admin: Client;
let member: Client;

async function auditRows(n: number, action: string, actorId: number | null, at: number) {
  await env.DB.prepare(
    `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ?1)
     INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
     SELECT ?2, ?3, 'project', CAST(i AS TEXT), json_object('n', i), NULL, ?4 + i FROM s`,
  )
    .bind(n, actorId, action, at)
    .run();
}

beforeAll(async () => {
  admin = await signedInClient({ name: "Audit Admin" });
  await setUser(admin.userId, { status: "active", appRole: "admin" });
  member = await signedInClient({ name: "Plain Member" });
  await setUser(member.userId, { status: "active" });
});

describe("ADM-3 audit log viewer", () => {
  it("App Admins page through newest first and filter by action, actor and date; others get 403", async () => {
    const action = `test.paging_${crypto.randomUUID().slice(0, 6)}`;
    await auditRows(AUDIT_PAGE_SIZE + 5, action, admin.userId, 1_700_000_000_000);
    const first = (await (await call(admin, "GET", `/api/admin/audit?action=${action}`)).json()) as { entries: AuditEntry[]; nextBefore: number | null };
    expect(first.entries).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.entries[0]).toMatchObject({ action, actor: { id: admin.userId, name: "Audit Admin" }, targetType: "project", detail: { n: AUDIT_PAGE_SIZE + 5 } });
    const second = (await (await call(admin, "GET", `/api/admin/audit?action=${action}&before=${first.nextBefore}`)).json()) as { entries: AuditEntry[]; nextBefore: number | null };
    expect(second.entries).toHaveLength(5);
    expect(second.nextBefore).toBeNull();

    const byActor = (await (await call(admin, "GET", `/api/admin/audit?action=${action}&actor=audit%20adm`)).json()) as { entries: AuditEntry[] };
    expect(byActor.entries).toHaveLength(AUDIT_PAGE_SIZE);
    const nobody = (await (await call(admin, "GET", `/api/admin/audit?action=${action}&actor=plain`)).json()) as { entries: AuditEntry[] };
    expect(nobody.entries).toHaveLength(0);
    const dated = (await (await call(admin, "GET", `/api/admin/audit?action=${action}&from=${1_700_000_000_000 + 10}&to=${1_700_000_000_000 + 13}`)).json()) as { entries: AuditEntry[] };
    expect(dated.entries.map((e) => e.detail.n)).toEqual([12, 11, 10]);

    expect((await call(member, "GET", "/api/admin/audit")).status).toBe(403);
    expect((await call(member, "GET", "/api/admin/audit.csv")).status).toBe(403);
  });

  it("exports CSV with the filters, safe against spreadsheet formulas, capped at 5,000 rows", async () => {
    const action = `test.export_${crypto.randomUUID().slice(0, 6)}`;
    await auditRows(5003, action, null, 1_600_000_000_000);
    const res = await call(admin, "GET", `/api/admin/audit.csv?action=${action}`);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A UTF-8 byte-order mark so Excel opens accented names correctly (text() would strip it).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes).trim().split("\r\n");
    expect(lines[0]).toBe("time_utc,action,actor_id,actor_name,target_type,target_id,detail");
    expect(lines).toHaveLength(5001);
    expect(lines[1]).toContain(action);
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField("plain")).toBe("plain");
  });
});

describe("ADM-4 usage panel", () => {
  it("shows emails from the outbox and says when Cloudflare analytics isn't connected", async () => {
    const before = (await (await call(admin, "GET", "/api/admin/usage")).json()) as UsageResponse;
    await env.DB.prepare("INSERT INTO email_outbox (user_id, template, payload_json, mode, status, send_after, sent_at) VALUES (?, 'task.assigned', '{}', 'instant', 'sent', ?2, ?2)")
      .bind(admin.userId, Date.now())
      .run();
    const after = (await (await call(admin, "GET", "/api/admin/usage")).json()) as UsageResponse;
    expect(after.analyticsConnected).toBe(false);
    const emails = (u: UsageResponse) => u.metrics.find((m) => m.metric === "emails")!;
    expect(emails(after).today).toBe(emails(before).today! + 1);
    expect(after.metrics.find((m) => m.metric === "workerRequests")!.today).toBeNull();
    expect((await call(member, "GET", "/api/admin/usage")).status).toBe(403);
  });

  it("reads Worker and D1 totals from Cloudflare's GraphQL API for the whole account", async () => {
    const realFetch = globalThis.fetch;
    let sent: { url: string; body: { variables: Record<string, string> }; auth: string | null } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(init.body as string), auth: new Headers(init.headers).get("Authorization") };
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                workerToday: [{ sum: { requests: 1200 } }, { sum: { requests: 300 } }],
                workerMonth: [{ sum: { requests: 40000 } }],
                d1Today: [{ sum: { rowsRead: 9000, rowsWritten: 400 } }],
                d1Month: [{ sum: { rowsRead: 300000, rowsWritten: 12000 } }],
                storage: [{ max: { databaseSizeBytes: 1_000_000 } }, { max: { databaseSizeBytes: 500_000 } }],
              },
            ],
          },
        },
      });
    }) as typeof fetch;
    try {
      const now = Date.UTC(2026, 9, 20, 15);
      const a = await fetchAnalytics({ DB: env.DB, CF_ACCOUNT_ID: "acct", CF_ANALYTICS_TOKEN: "tok" }, now);
      expect(a).toEqual({ workerToday: 1500, workerMonth: 40000, readToday: 9000, readMonth: 300000, writtenToday: 400, writtenMonth: 12000, databaseBytes: 1_500_000 });
      expect(sent!.url).toBe("https://api.cloudflare.com/client/v4/graphql");
      expect(sent!.auth).toBe("Bearer tok");
      expect(sent!.body.variables).toEqual({ account: "acct", day: "2026-10-20", monthStart: "2026-10-01" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("ADM-5 / NFR-15 hourly checks", () => {
  it("at 80% of a daily limit every active App Admin gets one warning a day; 100% is recorded for the panel", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        data: {
          viewer: {
            accounts: [
              {
                workerToday: [{ sum: { requests: 85_000 } }],
                workerMonth: [{ sum: { requests: 85_000 } }],
                d1Today: [{ sum: { rowsRead: 10, rowsWritten: 100_000 } }],
                d1Month: [{ sum: { rowsRead: 10, rowsWritten: 100_000 } }],
                storage: [],
              },
            ],
          },
        },
      })) as typeof fetch;
    try {
      const now = Date.UTC(2031, 0, 5, 14);
      const cfEnv = { DB: env.DB, CF_ACCOUNT_ID: "acct", CF_ANALYTICS_TOKEN: "tok" };
      await usageChecks(cfEnv, now);
      await usageChecks(cfEnv, now + 3_600_000);
      const warnings = await env.DB.prepare("SELECT user_id, payload_json FROM email_outbox WHERE template = 'usage.warning' AND dedupe_key LIKE 'usage80:workerRequests:2031-01-05:%'").all<{
        user_id: number;
        payload_json: string;
      }>();
      expect(warnings.results.some((w) => w.user_id === admin.userId)).toBe(true);
      expect(warnings.results.some((w) => w.user_id === member.userId)).toBe(false);
      expect(new Set(warnings.results.map((w) => w.user_id)).size).toBe(warnings.results.length);
      expect(JSON.parse(warnings.results[0]!.payload_json)).toMatchObject({ metric: "Worker requests", percent: 85 });

      const audit = await env.DB.prepare("SELECT action, target_id FROM audit_log WHERE action LIKE 'system.%' AND at >= ? ORDER BY action, target_id").bind(now).all();
      expect(audit.results).toEqual([
        { action: "system.free_tier_warning", target_id: "d1RowsWritten" },
        { action: "system.free_tier_warning", target_id: "workerRequests" },
        { action: "system.usage_limit_reached", target_id: "d1RowsWritten" },
      ]);
      const panel = await readUsage(cfEnv, now + 7_200_000);
      expect(panel.metrics.find((m) => m.metric === "d1RowsWritten")!.limitReachedAt).toBe(now);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("more than 20 errors in an hour emails the App Admins once that hour", async () => {
    const now = Date.UTC(2031, 1, 1, 10, 30);
    await env.DB.prepare(
      `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < 21)
       INSERT INTO app_errors (source, section, request_id, at) SELECT 'server', 'api', 'req-' || i, ?1 - i * 1000 FROM s`,
    )
      .bind(now)
      .run();
    await usageChecks({ DB: env.DB }, now);
    await usageChecks({ DB: env.DB }, now + 60_000);
    const alerts = await env.DB.prepare("SELECT count(*) AS n FROM email_outbox WHERE template = 'errors.alert' AND user_id = ? AND dedupe_key LIKE 'errors:2031-02-01T10:%'")
      .bind(admin.userId)
      .first<number>("n");
    expect(alerts).toBe(1);
  });
});

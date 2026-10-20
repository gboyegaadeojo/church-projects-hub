import { Hono } from "hono";
import { FREE_LIMITS, USAGE_METRICS, USAGE_WARN_AT, type UsageMetric, type UsageResponse } from "../../shared/admin";
import { AUDIT } from "../audit";
import { requirePermission } from "../auth/authorize";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";

// The usage panel (ADM-4) and its alerts (ADM-5, NFR-15). Worker requests and D1 rows come from Cloudflare's
// GraphQL analytics API for the whole account (the limits are shared with the checklist app, section 5);
// emails come from email_outbox. Limits reset at midnight UTC, so "today" and "this month" are UTC.

type Env2 = Pick<Env, "DB"> & { CF_ACCOUNT_ID?: string; CF_ANALYTICS_TOKEN?: string };

const DAY_MS = 86_400_000;
/** NFR-15: more than this many errors in an hour emails the App Admins. */
export const ERROR_ALERT_THRESHOLD = 20;

type Analytics = { workerToday: number; workerMonth: number; readToday: number; readMonth: number; writtenToday: number; writtenMonth: number; databaseBytes: number };

const QUERY = `query Usage($account: String!, $day: Date!, $monthStart: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workerToday: workersInvocationsAdaptive(limit: 10000, filter: { date: $day }) { sum { requests } }
    workerMonth: workersInvocationsAdaptive(limit: 10000, filter: { date_geq: $monthStart, date_leq: $day }) { sum { requests } }
    d1Today: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date: $day }) { sum { rowsRead rowsWritten } }
    d1Month: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $monthStart, date_leq: $day }) { sum { rowsRead rowsWritten } }
    storage: d1StorageAdaptiveGroups(limit: 10000, filter: { date: $day }) { max { databaseSizeBytes } dimensions { databaseId } }
  } }
}`;

type Sums = { sum?: Record<string, number | null> };
const total = (groups: Sums[] | undefined, field: string) => (groups ?? []).reduce((n, g) => n + (g.sum?.[field] ?? 0), 0);

/** Account usage from Cloudflare, or null when not configured; throws when Cloudflare can't be read. */
export async function fetchAnalytics(env: Env2, now: number): Promise<Analytics | null> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { account: env.CF_ACCOUNT_ID, day, monthStart: `${day.slice(0, 8)}01` } }),
  });
  if (!res.ok) throw new Error(`analytics ${res.status}`);
  const body = (await res.json()) as {
    errors?: unknown[] | null;
    data?: { viewer?: { accounts?: Array<Record<string, (Sums & { max?: { databaseSizeBytes?: number } })[]>> } };
  };
  const account = body.data?.viewer?.accounts?.[0];
  if ((body.errors && body.errors.length) || !account) throw new Error("analytics query failed");
  return {
    workerToday: total(account.workerToday, "requests"),
    workerMonth: total(account.workerMonth, "requests"),
    readToday: total(account.d1Today, "rowsRead"),
    readMonth: total(account.d1Month, "rowsRead"),
    writtenToday: total(account.d1Today, "rowsWritten"),
    writtenMonth: total(account.d1Month, "rowsWritten"),
    databaseBytes: (account.storage ?? []).reduce((n, g) => n + (g.max?.databaseSizeBytes ?? 0), 0),
  };
}

export async function readUsage(env: Env2, now: number): Promise<UsageResponse> {
  const dayStart = now - (now % DAY_MS);
  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const [emails, reached] = await env.DB.batch([
    env.DB.prepare(
      `SELECT sum(CASE WHEN status = 'sent' AND sent_at >= ?1 THEN 1 ELSE 0 END) AS today,
              sum(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS month,
              sum(CASE WHEN status = 'failed' AND created_at >= ?2 THEN 1 ELSE 0 END) AS failed
       FROM email_outbox WHERE (sent_at >= ?2 OR (status = 'failed' AND created_at >= ?2))`,
    ).bind(dayStart, monthStart),
    env.DB.prepare(`SELECT json_extract(detail_json, '$.metric') AS metric, min(at) AS at FROM audit_log WHERE action = ?1 AND at >= ?2 GROUP BY 1`).bind(
      AUDIT.usageLimitReached,
      dayStart,
    ),
  ]);
  const e = (emails!.results as { today: number | null; month: number | null; failed: number | null }[])[0] ?? { today: 0, month: 0, failed: 0 };
  const reachedAt = new Map((reached!.results as { metric: UsageMetric; at: number }[]).map((r) => [r.metric, r.at]));

  let analytics: Analytics | null = null;
  let analyticsError = false;
  try {
    analytics = await fetchAnalytics(env, now);
  } catch {
    analyticsError = true;
  }
  const values: Record<UsageMetric, [number | null, number | null]> = {
    workerRequests: analytics ? [analytics.workerToday, analytics.workerMonth] : [null, null],
    d1RowsRead: analytics ? [analytics.readToday, analytics.readMonth] : [null, null],
    d1RowsWritten: analytics ? [analytics.writtenToday, analytics.writtenMonth] : [null, null],
    emails: [e.today ?? 0, e.month ?? 0],
  };
  return {
    analyticsConnected: !!(env.CF_ACCOUNT_ID && env.CF_ANALYTICS_TOKEN),
    analyticsError,
    metrics: USAGE_METRICS.map((metric) => ({ metric, today: values[metric][0], month: values[metric][1], limitReachedAt: reachedAt.get(metric) ?? null })),
    databaseBytes: analytics?.databaseBytes ?? null,
    failedEmails: e.failed ?? 0,
  };
}

/** One email row per current App Admin, resolved now (section 8 rule 6), once per dedupe key. */
function adminEmails(env: Env2, template: string, payload: object, dedupe: string, now: number) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO email_outbox (user_id, template, payload_json, dedupe_key, mode, send_after, created_at)
     SELECT id, ?1, ?2, ?3 || ':' || id, 'instant', ?4, ?4 FROM users WHERE app_role = 'admin' AND status = 'active' AND deleted_at IS NULL`,
  ).bind(template, JSON.stringify(payload), dedupe, now);
}

/** A system audit row, written once per action and metric per UTC day. */
function auditOnce(env: Env2, action: string, metric: string, detail: object, dayStart: number, now: number) {
  return env.DB.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
     SELECT NULL, ?1, 'system', ?2, ?3, NULL, ?4
     WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = ?1 AND target_id = ?2 AND at >= ?5)`,
  ).bind(action, metric, JSON.stringify({ metric, ...detail }), now, dayStart);
}

/**
 * Hourly (ADM-5): at 80% of a daily limit, App Admins get one warning email per metric per day ("free-tier
 * warning sent" audited); at 100%, "usage limit reached" is recorded for the panel. NFR-15: more than 20
 * errors in the last hour emails them too, once per hour.
 */
export async function usageChecks(env: Env2, now: number): Promise<void> {
  const dayStart = now - (now % DAY_MS);
  const day = new Date(now).toISOString().slice(0, 10);
  const statements: D1PreparedStatement[] = [];
  const usage = await readUsage(env, now);
  for (const m of usage.metrics) {
    if (m.today === null) continue;
    const limit = FREE_LIMITS[m.metric].daily;
    const share = m.today / limit;
    if (share >= USAGE_WARN_AT) {
      const payload = { metric: FREE_LIMITS[m.metric].label, used: m.today, limit, percent: Math.floor(share * 100) };
      statements.push(adminEmails(env, "usage.warning", payload, `usage80:${m.metric}:${day}`, now));
      statements.push(auditOnce(env, AUDIT.freeTierWarning, m.metric, { used: m.today, limit }, dayStart, now));
    }
    if (share >= 1) statements.push(auditOnce(env, AUDIT.usageLimitReached, m.metric, { used: m.today, limit }, dayStart, now));
  }
  const errors =
    (await env.DB.prepare("SELECT count(*) AS n FROM app_errors WHERE at >= ?1 AND at < ?2").bind(now - 3_600_000, now).first<number>("n")) ?? 0;
  if (errors > ERROR_ALERT_THRESHOLD) {
    statements.push(adminEmails(env, "errors.alert", { count: errors }, `errors:${new Date(now).toISOString().slice(0, 13)}`, now));
  }
  if (statements.length) await env.DB.batch(statements);
}

export function adminUsageRoutes() {
  const routes = new Hono<AppEnv>();
  routes.get("/admin/usage", requireSession, requirePermission("user.manage"), async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await readUsage(c.env as Env2, Date.now()));
  });
  return routes;
}

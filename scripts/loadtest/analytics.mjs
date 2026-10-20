// Cloudflare's own numbers for a load-test window (Stage 8, NFR-22 and the section 5 budget).
//
//   CF_ACCOUNT_ID=... CF_ANALYTICS_TOKEN=... node scripts/loadtest/analytics.mjs <startISO> <endISO> [script] [databaseId]
//
// Reads, for one Worker and one D1 database between the two times: requests, errors, CPU time percentiles
// (Workers analytics reports them in microseconds), and D1 rows read and written. The token needs
// "Account Analytics: Read" only. Analytics arrive a few minutes late; run it 5+ minutes after the window.

const [start, end, script = "church-projects-hub-staging", databaseId = "fd4ff66b-6cfd-4b9d-b7ba-8bc20fc4c6a3"] = process.argv.slice(2);
const { CF_ACCOUNT_ID: account, CF_ANALYTICS_TOKEN: token } = process.env;
if (!start || !end || !account || !token) throw new Error("Usage: CF_ACCOUNT_ID=… CF_ANALYTICS_TOKEN=… node analytics.mjs <startISO> <endISO>");

const query = `query Window($account: String!, $start: Time!, $end: Time!, $script: String!, $db: String!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workers: workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $start, datetime_leq: $end, scriptName: $script }) {
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP90 cpuTimeP99 cpuTimeP999 wallTimeP50 wallTimeP99 }
      max { cpuTime wallTime }
      dimensions { status }
    }
    d1: d1AnalyticsAdaptiveGroups(limit: 10000, filter: { datetimeMinute_geq: $start, datetimeMinute_leq: $end, databaseId: $db }) {
      sum { readQueries writeQueries rowsRead rowsWritten }
    }
  } }
}`;

const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { account, start, end, script, db: databaseId } }),
});
const body = await res.json();
if (body.errors?.length) {
  console.error(JSON.stringify(body.errors, null, 2));
  process.exit(1);
}
const a = body.data.viewer.accounts[0];
const groups = a.workers;
const sum = (k) => groups.reduce((t, g) => t + (g.sum[k] ?? 0), 0);
const maxOf = (k) => Math.max(0, ...groups.map((g) => g.max?.[k] ?? 0));
const qMax = (k) => Math.max(0, ...groups.map((g) => g.quantiles?.[k] ?? 0));
const d1 = a.d1.reduce((t, g) => ({ rowsRead: t.rowsRead + g.sum.rowsRead, rowsWritten: t.rowsWritten + g.sum.rowsWritten, readQueries: t.readQueries + g.sum.readQueries, writeQueries: t.writeQueries + g.sum.writeQueries }), { rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 });
const ms = (us) => +(us / 1000).toFixed(2);

console.log(
  JSON.stringify(
    {
      script,
      window: { start, end },
      workers: {
        requests: sum("requests"),
        errors: sum("errors"),
        byStatus: Object.fromEntries(groups.map((g) => [g.dimensions.status, g.sum.requests])),
        // Per status group; the highest group value is reported as an upper bound for the whole window.
        cpuMs: { p50: ms(qMax("cpuTimeP50")), p90: ms(qMax("cpuTimeP90")), p99: ms(qMax("cpuTimeP99")), p999: ms(qMax("cpuTimeP999")), max: ms(maxOf("cpuTime")) },
        wallMs: { p50: ms(qMax("wallTimeP50")), p99: ms(qMax("wallTimeP99")), max: ms(maxOf("wallTime")) },
      },
      d1,
    },
    null,
    2,
  ),
);

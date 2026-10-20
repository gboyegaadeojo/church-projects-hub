// One simulated Sunday against STAGING (Stage 8, docs/REQUIREMENTS.md sections 5 and 17).
//
//   STAGING_SECRET=<staging SESSION_SECRET> node scripts/loadtest/replay.mjs [users=50] [out.json]
//
// Each volunteer follows section 5's Sunday assumptions: 150 requests from page views and actions (5 board
// loads, 20 actions that write) plus 30 bell refreshes, with a pause of 1-4 s between requests, all 50 at
// once. That compresses a day's traffic into about 8 minutes, which is harsher than a real Sunday.
// Prints the request count, status codes and p50 / p95 / max latency per endpoint (measured from this
// machine, so it includes the network), and the start and end time for the Cloudflare analytics query
// (scripts/loadtest/analytics.mjs) that reads CPU time and D1 rows for the same window.

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";

const BASE = process.env.STAGING_URL ?? "https://church-projects-hub-staging.media-5f7.workers.dev";
const SECRET = process.env.STAGING_SECRET;
if (!SECRET) throw new Error("Set STAGING_SECRET to the staging SESSION_SECRET.");
const USERS = Number(process.argv[2] ?? 50);
const OUT = process.argv[3];

const cookieFor = (n) => {
  const v = encodeURIComponent(`loadtest-session-${n}`);
  return `__Host-cph_session=${encodeURIComponent(`${v}.${createHmac("sha256", SECRET).update(v).digest("base64")}`)}`;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);

const samples = new Map(); // endpoint -> [ms]
const statuses = new Map(); // status -> count
const errors = new Map(); // "endpoint status error" -> count, for anything 400 or above
let total = 0;

async function call(user, label, path, init = {}) {
  // Writes carry what a browser sends: the same-origin Origin header (NFR-2) and the CSRF token.
  const headers = {
    cookie: user.cookie,
    ...(init.body ? { "content-type": "application/json" } : {}),
    ...(init.method ? { origin: BASE, ...(user.csrf ? { "X-CSRF-Token": user.csrf } : {}) } : {}),
  };
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(BASE + path, { ...init, headers, body: init.body ? JSON.stringify(init.body) : undefined });
  } catch {
    statuses.set("network", (statuses.get("network") ?? 0) + 1);
    return null;
  }
  const body = await res.text();
  const ms = performance.now() - t0;
  total++;
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push(ms);
  statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
  if (res.status >= 400) {
    const key = `${label} ${res.status} ${body.slice(0, 60)}`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
  }
  try {
    return { status: res.status, json: JSON.parse(body) };
  } catch {
    return { status: res.status, json: null };
  }
}

const doc = (text, mention) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }, ...(mention ? [{ type: "text", text: " " }, { type: "mention", attrs: { id: String(mention.id), label: mention.name } }] : [])] }],
});

async function volunteer(n) {
  const user = { cookie: cookieFor(n) };
  const me = await call(user, "GET /api/auth/me", "/api/auth/me");
  user.csrf = me?.json?.csrfToken;
  const projects = (await call(user, "GET /api/projects", "/api/projects"))?.json?.projects ?? [];
  const boards = new Map();
  const loadBoard = async (p) => {
    await call(user, "GET /api/projects/by-key/:key", `/api/projects/by-key/${p.key}`);
    const b = await call(user, "GET /api/projects/:id/board", `/api/projects/${p.id}/board`);
    if (b?.json?.tasks?.length) boards.set(p.id, b.json);
  };
  const someTask = () => {
    const b = pick([...boards.values()]);
    return b && { board: b, task: pick(b.tasks) };
  };

  // 150 page views and actions, in a shuffled Sunday order, plus 30 bell refreshes spread through them.
  const steps = shuffle([
    ...Array(5).fill("board"),
    ...Array(4).fill("open"),
    ...Array(10).fill("work"),
    ...Array(80).fill("task"),
    ...Array(5).fill("search"),
    ...Array(5).fill("notifications"),
    ...Array(2).fill("reports"),
    ...Array(1).fill("members"),
    ...Array(8).fill("move"),
    ...Array(6).fill("edit"),
    ...Array(4).fill("comment"),
    ...Array(2).fill("create"),
    ...Array(30).fill("bell"),
  ]);
  // The first board load comes first: everything else needs a board's tasks.
  steps.unshift("board");
  steps.splice(steps.indexOf("board", 1), 1);

  for (const step of steps) {
    await sleep(1000 + Math.random() * 3000);
    const p = pick(projects);
    switch (step) {
      case "board":
        await loadBoard(p);
        break;
      case "open":
        await call(user, "GET /api/auth/me", "/api/auth/me");
        await call(user, "GET /api/projects", "/api/projects");
        await call(user, "GET /api/news/unread", "/api/news/unread");
        break;
      case "work":
        await call(user, "GET /api/me/work", "/api/me/work");
        break;
      case "task": {
        const t = someTask();
        if (t) await call(user, "GET /api/tasks/:id", `/api/tasks/${t.task.id}`);
        break;
      }
      case "search":
        await call(user, "GET /api/search", `/api/search?q=${pick(["mic", "stream", "lights", "chairs", "slides"])}`);
        break;
      case "notifications":
      case "bell":
        await call(user, "GET /api/notifications", `/api/notifications?limit=20&since=${Date.now() - 30 * 86400000}`);
        break;
      case "reports":
        await call(user, "GET /api/projects/:id/reports", `/api/projects/${p.id}/reports?weeks=12`);
        break;
      case "members":
        await call(user, "GET /api/projects/:id/members", `/api/projects/${p.id}/members`);
        break;
      case "move": {
        const t = someTask();
        if (!t) break;
        const state = pick(t.board.states);
        await call(user, "POST /api/tasks/:id/move", `/api/tasks/${t.task.id}/move`, { method: "POST", body: { stateId: state.id, afterId: null, beforeId: null } });
        break;
      }
      case "edit": {
        const t = someTask();
        if (!t) break;
        const detail = await call(user, "GET /api/tasks/:id", `/api/tasks/${t.task.id}`);
        const version = detail?.json?.task?.version ?? t.task.version;
        await call(user, "PATCH /api/tasks/:id", `/api/tasks/${t.task.id}`, { method: "PATCH", body: { version, priority: pick(["high", "medium", "low"]) } });
        break;
      }
      case "comment": {
        const t = someTask();
        if (!t) break;
        const other = 1 + Math.floor(Math.random() * USERS);
        await call(user, "POST /api/tasks/:id/comments", `/api/tasks/${t.task.id}/comments`, {
          method: "POST",
          body: { body: doc("Done before the service, thanks", Math.random() < 0.5 ? { id: other, name: `Volunteer ${other}` } : null) },
        });
        break;
      }
      case "create":
        await call(user, "POST /api/projects/:id/tasks", `/api/projects/${p.id}/tasks`, {
          method: "POST",
          body: { title: `Follow up after the service (${n})`, assigneeId: Math.random() < 0.5 ? n : null },
        });
        break;
    }
  }
}

const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

const started = new Date();
console.log(`Replaying a Sunday for ${USERS} volunteers against ${BASE} from ${started.toISOString()}`);
await Promise.all(Array.from({ length: USERS }, (_, i) => volunteer(i + 1)));
const ended = new Date();

const all = [...samples.values()].flat();
const rows = [...samples.entries()]
  .map(([endpoint, xs]) => ({ endpoint, n: xs.length, p50: Math.round(percentile(xs, 50)), p95: Math.round(percentile(xs, 95)), max: Math.round(Math.max(...xs)) }))
  .sort((a, b) => b.n - a.n);
const summary = {
  base: BASE,
  users: USERS,
  started: started.toISOString(),
  ended: ended.toISOString(),
  minutes: +((ended - started) / 60000).toFixed(1),
  requests: total,
  statuses: Object.fromEntries(statuses),
  errors: Object.fromEntries(errors),
  overall: { p50: Math.round(percentile(all, 50)), p95: Math.round(percentile(all, 95)), max: Math.round(Math.max(...all)) },
  endpoints: rows,
};
console.table(rows);
console.log(JSON.stringify({ ...summary, endpoints: undefined }, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify(summary, null, 2));

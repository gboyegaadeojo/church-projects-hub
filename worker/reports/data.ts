import type { TaskFilter } from "../../shared/filters";
import { addDaysTo, churchDate, percentiles, type ProjectReports, weekStart } from "../../shared/reports";
import { PRIORITIES, type Priority, todayIn } from "../../shared/tasks";

// Section 16. Everything about history comes from task_events (so renamed columns never break a chart); the
// current-state reports read tasks directly. Created vs completed and cycle time are folded hourly into
// report_snapshots, only from events newer than the last run (Stage 7: "incrementally"); with filters they
// are computed from the events of the matching tasks instead, since a weekly total can't be filtered.

type EventRow = {
  id: number;
  at: number;
  field: "created" | "state";
  project_id: number;
  new_category: string | null;
  old_category: string | null;
  started_at: number | null;
};

/** Task creations and column moves, with the categories involved and, for a move into Done, when work began. */
const EVENT_SQL = `
  SELECT e.id, e.at, e.field, t.project_id, s.category AS new_category, so.category AS old_category,
         CASE WHEN e.field = 'state' AND s.category = 'done' THEN
           (SELECT min(e2.at) FROM task_events e2 JOIN workflow_states s2 ON s2.id = CAST(e2.new_value AS INTEGER)
            WHERE e2.task_id = e.task_id AND e2.field IN ('created', 'state') AND s2.category = 'in_progress' AND e2.id < e.id)
         END AS started_at
  FROM task_events e
  JOIN tasks t ON t.id = e.task_id
  LEFT JOIN workflow_states s ON s.id = CAST(e.new_value AS INTEGER)
  LEFT JOIN workflow_states so ON e.field = 'state' AND so.id = CAST(e.old_value AS INTEGER)
  WHERE e.field IN ('created', 'state')`;

type WeekMetrics = { created: number; completed: number };
type MonthMetrics = { cycleHours: number[] };
type Bucket = { lastEventId: number; week?: WeekMetrics; month?: MonthMetrics };

/** Folds events into per-project, per-period buckets ("w:<Monday>" and "m:<YYYY-MM>"). */
export function foldEvents(rows: EventRow[]): Map<string, Bucket> {
  const out = new Map<string, Bucket>();
  const bucket = (projectId: number, period: string) => {
    const key = `${projectId}|${period}`;
    let b = out.get(key);
    if (!b) {
      b = { lastEventId: 0 };
      out.set(key, b);
    }
    return b;
  };
  for (const r of rows) {
    const date = churchDate(r.at);
    const created = r.field === "created";
    // Completed = moved into a Done column from one that isn't (a reopened task that's finished again counts again).
    const completed = r.field === "state" && r.new_category === "done" && r.old_category !== "done";
    if (created || completed) {
      const w = bucket(r.project_id, `w:${weekStart(date)}`);
      w.week ??= { created: 0, completed: 0 };
      if (created) w.week.created += 1;
      else w.week.completed += 1;
      w.lastEventId = Math.max(w.lastEventId, r.id);
    }
    // RPT-3: cycle time from first In Progress to Done, in the month it finished.
    if (completed && r.started_at !== null) {
      const m = bucket(r.project_id, `m:${date.slice(0, 7)}`);
      m.month ??= { cycleHours: [] };
      m.month.cycleHours.push(Math.round(((r.at - r.started_at) / 3_600_000) * 10) / 10);
      m.lastEventId = Math.max(m.lastEventId, r.id);
    }
  }
  return out;
}

const CURSOR = { projectId: 0, period: "cursor" };
const CHUNK = 1000;

/**
 * Hourly: folds task events newer than the cursor into report_snapshots. Bounded to `maxChunks` × 1,000 events
 * per run so a backlog is worked off over several hours rather than in one long run (NFR-22). Rows remember the
 * newest event they include, so a run that stops halfway can be repeated without counting anything twice.
 */
export async function updateReportSnapshots(env: Pick<Env, "DB">, now: number, maxChunks = 3): Promise<{ events: number }> {
  let cursor =
    (await env.DB.prepare("SELECT last_event_id FROM report_snapshots WHERE project_id = ?1 AND period = ?2").bind(CURSOR.projectId, CURSOR.period).first<number>("last_event_id")) ?? 0;
  let total = 0;
  for (let i = 0; i < maxChunks; i++) {
    const { results } = await env.DB.prepare(`${EVENT_SQL} AND e.id > ?1 ORDER BY e.id LIMIT ${CHUNK}`).bind(cursor).all<EventRow>();
    if (results.length === 0) break;
    const folded = foldEvents(results);
    const keys = [...folded.keys()];
    const { results: existing } = await env.DB.prepare(
      "SELECT project_id, period, metrics_json, last_event_id FROM report_snapshots WHERE project_id || '|' || period IN (SELECT value FROM json_each(?1))",
    )
      .bind(JSON.stringify(keys))
      .all<{ project_id: number; period: string; metrics_json: string; last_event_id: number }>();
    const current = new Map(existing.map((r) => [`${r.project_id}|${r.period}`, r]));
    // Only events newer than what a row already holds are added; with one chunk at a time that is all of
    // this chunk or none of it, so a row whose last_event_id is past the chunk's start is left alone.
    const firstId = results[0]!.id;
    const statements: D1PreparedStatement[] = [];
    for (const [key, b] of folded) {
      const row = current.get(key);
      if (row && row.last_event_id >= firstId) continue;
      const [projectId, period] = key.split("|") as [string, string];
      const metrics = row ? (JSON.parse(row.metrics_json) as Partial<WeekMetrics & MonthMetrics>) : {};
      if (b.week) {
        metrics.created = (metrics.created ?? 0) + b.week.created;
        metrics.completed = (metrics.completed ?? 0) + b.week.completed;
      }
      if (b.month) metrics.cycleHours = [...(metrics.cycleHours ?? []), ...b.month.cycleHours];
      statements.push(
        env.DB.prepare(
          `INSERT INTO report_snapshots (project_id, period, metrics_json, last_event_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
           ON CONFLICT (project_id, period) DO UPDATE SET metrics_json = excluded.metrics_json, last_event_id = excluded.last_event_id, updated_at = excluded.updated_at`,
        ).bind(Number(projectId), period, JSON.stringify(metrics), b.lastEventId, now),
      );
    }
    cursor = results.at(-1)!.id;
    statements.push(
      env.DB.prepare(
        `INSERT INTO report_snapshots (project_id, period, metrics_json, last_event_id, created_at, updated_at) VALUES (0, 'cursor', '{}', ?1, ?2, ?2)
         ON CONFLICT (project_id, period) DO UPDATE SET last_event_id = excluded.last_event_id, updated_at = excluded.updated_at`,
      ).bind(cursor, now),
    );
    await env.DB.batch(statements);
    total += results.length;
    if (results.length < CHUNK) break;
  }
  return { events: total };
}

// ---- The project reports

/** Builds "?n" placeholders as values are bound, so filter SQL never contains user input. */
class Params {
  values: unknown[] = [];
  p(value: unknown) {
    this.values.push(value);
    return `?${this.values.length}`;
  }
}

/** The board's filters (assignee, label, priority) as SQL on tasks aliased `t`. */
function taskFilterSql(f: TaskFilter, q: Params): string {
  const parts: string[] = [];
  if (f.assignees.length) {
    const ids = f.assignees.filter((a): a is number => a !== "none");
    const none = f.assignees.includes("none");
    const people = ids.length ? q.p(JSON.stringify(ids)) : null;
    // As on the board: a person matches as assignee or secondary assignee (v4.6).
    parts.push(`(${[people ? `t.assignee_id IN (SELECT value FROM json_each(${people})) OR t.secondary_assignee_id IN (SELECT value FROM json_each(${people}))` : "", none ? "t.assignee_id IS NULL" : ""].filter(Boolean).join(" OR ")})`);
  }
  if (f.labels.length) parts.push(`EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id IN (SELECT value FROM json_each(${q.p(JSON.stringify(f.labels))})))`);
  if (f.priorities.length) parts.push(`t.priority IN (SELECT value FROM json_each(${q.p(JSON.stringify(f.priorities))}))`);
  return parts.map((s) => ` AND ${s}`).join("");
}

const isFiltered = (f: TaskFilter) => f.assignees.length + f.labels.length + f.priorities.length > 0;

export async function loadProjectReports(
  env: Pick<Env, "DB">,
  opts: { projectId: number; weeks: number; filter: TaskFilter; timezone: string; canSeeWorkload: boolean; now?: number },
): Promise<ProjectReports> {
  const now = opts.now ?? Date.now();
  const thisWeek = weekStart(churchDate(now));
  const from = addDaysTo(thisWeek, -7 * (opts.weeks - 1));
  const weeks = Array.from({ length: opts.weeks }, (_, i) => addDaysTo(from, 7 * i));
  const months: string[] = [];
  for (let m = from.slice(0, 7); m <= thisWeek.slice(0, 7) || m <= churchDate(now).slice(0, 7); ) {
    months.push(m);
    const [y, mo] = m.split("-").map(Number);
    m = new Date(Date.UTC(y!, mo!, 1)).toISOString().slice(0, 7);
  }
  // A day early so the first Monday in Winnipeg is fully covered whatever the UTC offset.
  const fromMs = Date.parse(`${from}T00:00:00Z`) - 86_400_000;
  const today = todayIn(opts.timezone, now);
  const filtered = isFiltered(opts.filter);

  const q = new Params();
  const project = q.p(opts.projectId);
  const where = `t.project_id = ${project} AND t.deleted_at IS NULL${taskFilterSql(opts.filter, q)}`;
  const todayP = q.p(today);
  const soonP = q.p(addDaysTo(today, 7));
  const fromP = q.p(fromMs);
  const doneSince = `EXISTS (SELECT 1 FROM task_events e JOIN workflow_states s2 ON s2.id = CAST(e.new_value AS INTEGER)
                      WHERE e.task_id = t.id AND e.field = 'state' AND s2.category = 'done' AND e.at >= ${fromP})`;
  const db = env.DB;
  const stmt = (sql: string) => db.prepare(sql).bind(...q.values.slice(0, Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])))));

  const [status, risk, workload, labels, components, milestones] = await db.batch([
    stmt(
      `SELECT s.id, s.name, s.category, count(t.id) AS n FROM workflow_states s
       LEFT JOIN tasks t ON t.state_id = s.id AND ${where}
       WHERE s.project_id = ${project} GROUP BY s.id ORDER BY s.position`,
    ),
    stmt(
      `SELECT t.id, p.key || '-' || t.number AS key, t.title, t.due_date, t.priority, t.assignee_id, u.name AS assignee_name
       FROM tasks t JOIN projects p ON p.id = t.project_id JOIN workflow_states s ON s.id = t.state_id LEFT JOIN users u ON u.id = t.assignee_id
       WHERE ${where} AND s.category != 'done' AND t.due_date IS NOT NULL AND t.due_date <= ${soonP}
       ORDER BY u.name IS NULL, u.name COLLATE NOCASE, t.due_date LIMIT 500`,
    ),
    stmt(
      `SELECT t.assignee_id, u.name, count(*) AS open, sum(CASE WHEN t.due_date < ${todayP} THEN 1 ELSE 0 END) AS overdue
       FROM tasks t JOIN workflow_states s ON s.id = t.state_id LEFT JOIN users u ON u.id = t.assignee_id
       WHERE ${where} AND s.category != 'done' GROUP BY t.assignee_id ORDER BY open DESC`,
    ),
    stmt(
      `SELECT l.id, l.name,
              (SELECT count(*) FROM tasks t JOIN task_labels tl ON tl.task_id = t.id JOIN workflow_states s ON s.id = t.state_id
               WHERE tl.label_id = l.id AND ${where} AND s.category != 'done') AS open,
              (SELECT count(*) FROM tasks t JOIN task_labels tl ON tl.task_id = t.id JOIN workflow_states s ON s.id = t.state_id
               WHERE tl.label_id = l.id AND ${where} AND s.category = 'done' AND ${doneSince}) AS completed
       FROM labels l WHERE l.project_id = ${project} ORDER BY l.name COLLATE NOCASE`,
    ),
    stmt(
      `SELECT c.id, c.name,
              (SELECT count(*) FROM tasks t JOIN workflow_states s ON s.id = t.state_id WHERE t.component_id = c.id AND ${where} AND s.category != 'done') AS open,
              (SELECT count(*) FROM tasks t JOIN workflow_states s ON s.id = t.state_id WHERE t.component_id = c.id AND ${where} AND s.category = 'done' AND ${doneSince}) AS completed
       FROM components c WHERE c.project_id = ${project} ORDER BY c.name COLLATE NOCASE`,
    ),
    stmt(
      `SELECT m.id, m.name, m.target_date, count(t.id) AS total,
              sum(CASE WHEN s.category = 'done' THEN 1 ELSE 0 END) AS done,
              ${PRIORITIES.map((pr) => `sum(CASE WHEN s.category != 'done' AND t.priority = '${pr}' THEN 1 ELSE 0 END) AS open_${pr}`).join(", ")}
       FROM milestones m LEFT JOIN tasks t ON t.milestone_id = m.id AND ${where} LEFT JOIN workflow_states s ON s.id = t.state_id
       WHERE m.project_id = ${project} AND m.released_at IS NULL GROUP BY m.id ORDER BY m.target_date IS NULL, m.target_date`,
    ),
  ]);

  // Created vs completed and cycle time: snapshots, or the matching tasks' events when filtered.
  const weekly = new Map<string, WeekMetrics>();
  const monthly = new Map<string, number[]>();
  if (filtered) {
    const eq = new Params();
    const ep = eq.p(opts.projectId);
    const efrom = eq.p(fromMs);
    const { results } = await db
      .prepare(`${EVENT_SQL} AND t.project_id = ${ep} AND e.at >= ${efrom} AND t.deleted_at IS NULL${taskFilterSql(opts.filter, eq)} ORDER BY e.id LIMIT 20000`)
      .bind(...eq.values)
      .all<EventRow>();
    for (const [key, b] of foldEvents(results)) {
      const period = key.split("|")[1]!;
      if (b.week) weekly.set(period.slice(2), b.week);
      if (b.month) monthly.set(period.slice(2), b.month.cycleHours);
    }
  } else {
    const { results } = await db
      .prepare("SELECT period, metrics_json FROM report_snapshots WHERE project_id = ?1 AND ((period >= ?2 AND period <= ?3) OR (period >= ?4 AND period <= ?5))")
      .bind(opts.projectId, `w:${from}`, `w:${thisWeek}`, `m:${months[0]}`, `m:${months.at(-1)}`)
      .all<{ period: string; metrics_json: string }>();
    for (const r of results) {
      const m = JSON.parse(r.metrics_json) as Partial<WeekMetrics & MonthMetrics>;
      if (r.period.startsWith("w:")) weekly.set(r.period.slice(2), { created: m.created ?? 0, completed: m.completed ?? 0 });
      else monthly.set(r.period.slice(2), m.cycleHours ?? []);
    }
  }

  type RiskRow = { id: number; key: string; title: string; due_date: string; priority: Priority; assignee_id: number | null; assignee_name: string | null };
  const groups = new Map<string, ProjectReports["atRisk"][number]>();
  for (const r of risk!.results as RiskRow[]) {
    const k = String(r.assignee_id);
    if (!groups.has(k)) groups.set(k, { assignee: r.assignee_id === null ? null : { id: r.assignee_id, name: r.assignee_name ?? "Deleted user" }, tasks: [] });
    groups.get(k)!.tasks.push({
      id: r.id,
      key: r.key,
      title: r.title,
      dueDate: r.due_date,
      daysOverdue: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / 86_400_000),
      priority: r.priority,
    });
  }
  const days = (h: number | null) => (h === null ? null : Math.round((h / 24) * 10) / 10);

  return {
    range: { weeks: opts.weeks, from, to: addDaysTo(thisWeek, 6) },
    filtered,
    status: (status!.results as { id: number; name: string; category: "todo" | "in_progress" | "done"; n: number }[]).map((s) => ({
      stateId: s.id,
      name: s.name,
      category: s.category,
      count: s.n,
    })),
    atRisk: [...groups.values()],
    throughput: weeks.map((w) => ({ weekStart: w, created: weekly.get(w)?.created ?? 0, completed: weekly.get(w)?.completed ?? 0 })),
    workload: opts.canSeeWorkload
      ? (workload!.results as { assignee_id: number | null; name: string | null; open: number; overdue: number }[]).map((w) => ({
          assignee: w.assignee_id === null ? null : { id: w.assignee_id, name: w.name ?? "Deleted user" },
          open: w.open,
          overdue: w.overdue,
        }))
      : null,
    cycleTime: months.map((m) => {
      const samples = monthly.get(m) ?? [];
      const { median, p85 } = percentiles(samples);
      return { month: m, count: samples.length, medianDays: days(median), p85Days: days(p85) };
    }),
    labels: (labels!.results as { id: number; name: string; open: number; completed: number }[]).map((l) => ({ ...l })),
    components: (components!.results as { id: number; name: string; open: number; completed: number }[]).map((c) => ({ ...c })),
    milestones: (milestones!.results as Record<string, unknown>[]).map((m) => ({
      id: m.id as number,
      name: m.name as string,
      targetDate: (m.target_date as string | null) ?? null,
      total: m.total as number,
      done: (m.done as number | null) ?? 0,
      openByPriority: Object.fromEntries(PRIORITIES.map((pr) => [pr, (m[`open_${pr}`] as number | null) ?? 0])) as Record<Priority, number>,
    })),
  };
}

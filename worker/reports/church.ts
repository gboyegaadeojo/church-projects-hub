import { addDaysTo, type ChurchReports, churchDate, percentiles, weekStart } from "../../shared/reports";
import { todayIn } from "../../shared/tasks";

// Church-wide reports (section 16, App Admin only): headline numbers, created vs completed each week, one row per
// team project with its health, overdue aging, open work by priority, open work per person across every project
// (RPT-2), and access and adoption. Every query is an indexed aggregate; the only per-row data returned is the
// tasks completed in the range (capped), for the cycle-time median and on-time rate. Buckets by the hour in SQL and
// by church week here, so the rows returned stay small (NFR-22).

const DAY = 86_400_000;
/** A project with no task changes or comments for this long is "quiet". */
const QUIET_DAYS = 21;
/** A project with more than this share of its open work overdue is "at risk". */
const AT_RISK_SHARE = 0.2;

export async function loadChurchReports(env: Pick<Env, "DB">, opts: { weeks: number; timezone: string; now?: number }): Promise<ChurchReports> {
  const now = opts.now ?? Date.now();
  const thisWeek = weekStart(churchDate(now));
  const from = addDaysTo(thisWeek, -7 * (opts.weeks - 1));
  const fromMs = Date.parse(`${from}T00:00:00Z`) - DAY;
  const today = todayIn(opts.timezone, now);
  const monthStart = `${churchDate(now).slice(0, 7)}-01`;
  const monthStartMs = Date.parse(`${monthStart}T00:00:00Z`) - DAY;
  const week = addDaysTo(today, -7);
  const month = addDaysTo(today, -30);

  // "Done" means a move into a done-category column; deleted tasks and the Hub Feedback project don't count.
  const DONE_MOVES = `FROM task_events e JOIN tasks t ON t.id = e.task_id JOIN projects p ON p.id = t.project_id
    JOIN workflow_states s ON s.id = CAST(e.new_value AS INTEGER)
    WHERE e.field = 'state' AND s.category = 'done' AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.is_system = 0`;
  const OPEN = `FROM tasks t JOIN workflow_states s ON s.id = t.state_id JOIN projects p ON p.id = t.project_id
    WHERE t.deleted_at IS NULL AND s.category != 'done' AND p.deleted_at IS NULL AND p.archived_at IS NULL AND p.is_system = 0`;

  const [overview, workload, active, pending, decided, created, completedHours, completions, openMix] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.key, p.name, p.colour, p.icon, p.archived_at IS NOT NULL AS archived,
              sum(CASE WHEN t.id IS NOT NULL AND s.category = 'todo' THEN 1 ELSE 0 END) AS todo,
              sum(CASE WHEN t.id IS NOT NULL AND s.category = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
              sum(CASE WHEN t.id IS NOT NULL AND s.category != 'done' AND t.due_date < ?1 THEN 1 ELSE 0 END) AS overdue,
              sum(CASE WHEN t.id IS NOT NULL AND t.created_at >= ?3 THEN 1 ELSE 0 END) AS created,
              (SELECT count(DISTINCT e.task_id) FROM task_events e JOIN tasks t2 ON t2.id = e.task_id JOIN workflow_states s2 ON s2.id = CAST(e.new_value AS INTEGER)
               WHERE t2.project_id = p.id AND t2.deleted_at IS NULL AND e.field = 'state' AND s2.category = 'done' AND e.at >= ?2) AS completed_month,
              (SELECT count(DISTINCT e.task_id) FROM task_events e JOIN tasks t2 ON t2.id = e.task_id JOIN workflow_states s2 ON s2.id = CAST(e.new_value AS INTEGER)
               WHERE t2.project_id = p.id AND t2.deleted_at IS NULL AND e.field = 'state' AND s2.category = 'done' AND e.at >= ?3) AS completed,
              (SELECT count(*) FROM project_members m WHERE m.project_id = p.id) AS members,
              (SELECT max(e.at) FROM task_events e JOIN tasks t3 ON t3.id = e.task_id WHERE t3.project_id = p.id) AS last_activity
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
       LEFT JOIN workflow_states s ON s.id = t.state_id
       WHERE p.deleted_at IS NULL AND p.is_system = 0
       GROUP BY p.id ORDER BY p.archived_at IS NOT NULL, p.name COLLATE NOCASE`,
    ).bind(today, monthStartMs, fromMs),
    env.DB.prepare(
      `SELECT u.id, u.name, count(*) AS open, sum(CASE WHEN t.due_date < ?1 THEN 1 ELSE 0 END) AS overdue, count(DISTINCT t.project_id) AS projects
       FROM tasks t JOIN workflow_states s ON s.id = t.state_id JOIN users u ON u.id = t.assignee_id JOIN projects p ON p.id = t.project_id
       WHERE t.deleted_at IS NULL AND s.category != 'done' AND p.deleted_at IS NULL AND p.archived_at IS NULL AND u.deleted_at IS NULL
       GROUP BY u.id ORDER BY open DESC, u.name COLLATE NOCASE LIMIT 200`,
    ).bind(today),
    env.DB.prepare(
      `SELECT DISTINCT user_id, hour FROM (
         SELECT user_id, created_at / 3600000 AS hour FROM sessions WHERE created_at >= ?1
         UNION SELECT actor_id, at / 3600000 FROM task_events WHERE at >= ?1 AND actor_id IS NOT NULL
         UNION SELECT author_id, created_at / 3600000 FROM comments WHERE created_at >= ?1
       ) LIMIT 50000`,
    ).bind(fromMs),
    env.DB.prepare(
      `SELECT count(*) AS n FROM access_requests r JOIN users u ON u.id = r.user_id JOIN projects p ON p.id = r.project_id
       WHERE r.status = 'pending' AND u.status != 'suspended' AND u.deleted_at IS NULL AND p.deleted_at IS NULL`,
    ),
    env.DB.prepare(
      "SELECT count(*) AS n, avg(decided_at - created_at) AS avg_ms FROM access_requests WHERE status IN ('approved', 'denied') AND decided_at >= ?1",
    ).bind(fromMs),
    // Created per hour (bucketed into church weeks below).
    env.DB.prepare(
      `SELECT t.created_at / 3600000 AS hour, count(*) AS n FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.created_at >= ?1 AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.is_system = 0 GROUP BY hour`,
    ).bind(fromMs),
    // Completed per hour: each task counted once per hour it reached done.
    env.DB.prepare(`SELECT e.at / 3600000 AS hour, count(DISTINCT e.task_id) AS n ${DONE_MOVES} AND e.at >= ?1 GROUP BY hour`).bind(fromMs),
    // Tasks completed in the range: when each was created, due, and last moved to done.
    env.DB.prepare(`SELECT t.id, t.created_at, t.due_date, max(e.at) AS done_at ${DONE_MOVES} AND e.at >= ?1 GROUP BY t.id LIMIT 5000`).bind(fromMs),
    // Open work: aging of overdue tasks, priority mix, unassigned.
    env.DB.prepare(
      `SELECT count(*) AS open,
              sum(CASE WHEN t.due_date < ?1 THEN 1 ELSE 0 END) AS overdue,
              sum(CASE WHEN t.due_date < ?1 AND t.due_date >= ?2 THEN 1 ELSE 0 END) AS aged_week,
              sum(CASE WHEN t.due_date < ?2 AND t.due_date >= ?3 THEN 1 ELSE 0 END) AS aged_month,
              sum(CASE WHEN t.due_date < ?3 THEN 1 ELSE 0 END) AS aged_older,
              sum(CASE WHEN t.assignee_id IS NULL THEN 1 ELSE 0 END) AS unassigned,
              sum(CASE WHEN t.priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
              sum(CASE WHEN t.priority = 'high' THEN 1 ELSE 0 END) AS high,
              sum(CASE WHEN t.priority = 'medium' THEN 1 ELSE 0 END) AS medium,
              sum(CASE WHEN t.priority = 'low' THEN 1 ELSE 0 END) AS low
       ${OPEN}`,
    ).bind(today, week, month),
  ]);

  // Distinct people per church week.
  const weeks = Array.from({ length: opts.weeks }, (_, i) => addDaysTo(from, 7 * i));
  const people = new Map<string, Set<number>>(weeks.map((w) => [w, new Set()]));
  for (const r of active!.results as { user_id: number; hour: number }[]) {
    people.get(weekStart(churchDate(r.hour * 3_600_000)))?.add(r.user_id);
  }
  const perWeek = (rows: { hour: number; n: number }[]) => {
    const counts = new Map<string, number>(weeks.map((w) => [w, 0]));
    for (const r of rows) {
      const w = weekStart(churchDate(r.hour * 3_600_000));
      if (counts.has(w)) counts.set(w, counts.get(w)! + r.n);
    }
    return counts;
  };
  const createdByWeek = perWeek(created!.results as { hour: number; n: number }[]);
  const completedByWeek = perWeek(completedHours!.results as { hour: number; n: number }[]);

  const done = completions!.results as { id: number; created_at: number; due_date: string | null; done_at: number }[];
  const cycle = percentiles(done.map((d) => Math.max(0, (d.done_at - d.created_at) / DAY)));
  const withDue = done.filter((d) => d.due_date);
  const onTime = withDue.filter((d) => churchDate(d.done_at) <= d.due_date!).length;

  const mix = (openMix!.results as Record<string, number | null>[])[0]!;
  const n = (k: string) => mix[k] ?? 0;
  const d = (decided!.results as { n: number; avg_ms: number | null }[])[0]!;
  const lastWeek = weeks.at(-1)!;

  type OverviewRow = {
    id: number;
    key: string;
    name: string;
    colour: string;
    icon: string;
    archived: number;
    todo: number | null;
    in_progress: number | null;
    overdue: number | null;
    created: number | null;
    completed_month: number;
    completed: number;
    members: number;
    last_activity: number | null;
  };
  const projects = (overview!.results as OverviewRow[]).map((p) => {
    const open = (p.todo ?? 0) + (p.in_progress ?? 0);
    const overdue = p.overdue ?? 0;
    const quiet = p.last_activity === null || now - p.last_activity > QUIET_DAYS * DAY;
    const health = p.archived ? "archived" : open > 0 && overdue / open > AT_RISK_SHARE ? "at_risk" : quiet ? "quiet" : "on_track";
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      colour: p.colour,
      icon: p.icon,
      archived: p.archived === 1,
      open,
      todo: p.todo ?? 0,
      inProgress: p.in_progress ?? 0,
      overdue,
      createdInRange: p.created ?? 0,
      completedInRange: p.completed,
      completedThisMonth: p.completed_month,
      members: p.members,
      lastActivityAt: p.last_activity,
      health,
    } as ChurchReports["overview"][number];
  });
  const live = projects.filter((p) => !p.archived);

  return {
    range: { weeks: opts.weeks, from, to: addDaysTo(thisWeek, 6) },
    kpis: {
      activeProjects: live.length,
      open: n("open"),
      overdue: n("overdue"),
      unassigned: n("unassigned"),
      createdInRange: [...createdByWeek.values()].reduce((a, b) => a + b, 0),
      completedInRange: done.length,
      activePeopleThisWeek: people.get(lastWeek)?.size ?? 0,
      onTimeRate: withDue.length ? Math.round((onTime / withDue.length) * 100) : null,
      medianCycleDays: cycle.median === null ? null : Math.round(cycle.median * 10) / 10,
    },
    trend: weeks.map((w) => ({ weekStart: w, created: createdByWeek.get(w) ?? 0, completed: completedByWeek.get(w) ?? 0 })),
    aging: { week: n("aged_week"), month: n("aged_month"), older: n("aged_older") },
    priorities: { urgent: n("urgent"), high: n("high"), medium: n("medium"), low: n("low") },
    overview: projects,
    workload: (workload!.results as { id: number; name: string; open: number; overdue: number; projects: number }[]).map((w) => ({
      person: { id: w.id, name: w.name },
      open: w.open,
      overdue: w.overdue,
      projects: w.projects,
    })),
    adoption: {
      activeByWeek: weeks.map((w) => ({ weekStart: w, people: people.get(w)!.size })),
      pendingRequests: (pending!.results as { n: number }[])[0]!.n,
      avgDecisionHours: d.avg_ms === null ? null : Math.round((d.avg_ms / 3_600_000) * 10) / 10,
      decided: d.n,
    },
  };
}

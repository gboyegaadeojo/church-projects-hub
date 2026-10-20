import { addDaysTo, type ChurchReports, churchDate, weekStart } from "../../shared/reports";
import { todayIn } from "../../shared/tasks";

// Church-wide reports (section 16, App Admin only): one row per team project, open work per person across
// every project (RPT-2), and access and adoption. All live queries on indexed columns; the weekly-active count
// buckets by the hour in SQL and by church week here, so the rows returned stay small.

export async function loadChurchReports(env: Pick<Env, "DB">, opts: { weeks: number; timezone: string; now?: number }): Promise<ChurchReports> {
  const now = opts.now ?? Date.now();
  const thisWeek = weekStart(churchDate(now));
  const from = addDaysTo(thisWeek, -7 * (opts.weeks - 1));
  const fromMs = Date.parse(`${from}T00:00:00Z`) - 86_400_000;
  const today = todayIn(opts.timezone, now);
  const monthStart = `${churchDate(now).slice(0, 7)}-01`;
  const monthStartMs = Date.parse(`${monthStart}T00:00:00Z`) - 86_400_000;

  const [overview, workload, active, pending, decided] = await env.DB.batch([
    env.DB.prepare(
      `SELECT p.id, p.key, p.name, p.archived_at IS NOT NULL AS archived,
              sum(CASE WHEN t.id IS NOT NULL AND s.category != 'done' THEN 1 ELSE 0 END) AS open,
              sum(CASE WHEN t.id IS NOT NULL AND s.category != 'done' AND t.due_date < ?1 THEN 1 ELSE 0 END) AS overdue,
              (SELECT count(DISTINCT e.task_id) FROM task_events e JOIN tasks t2 ON t2.id = e.task_id JOIN workflow_states s2 ON s2.id = CAST(e.new_value AS INTEGER)
               WHERE t2.project_id = p.id AND t2.deleted_at IS NULL AND e.field = 'state' AND s2.category = 'done' AND e.at >= ?2) AS completed
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id AND t.deleted_at IS NULL
       LEFT JOIN workflow_states s ON s.id = t.state_id
       WHERE p.deleted_at IS NULL AND p.is_system = 0
       GROUP BY p.id ORDER BY p.archived_at IS NOT NULL, p.name COLLATE NOCASE`,
    ).bind(today, monthStartMs),
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
  ]);

  // Distinct people per church week.
  const weeks = Array.from({ length: opts.weeks }, (_, i) => addDaysTo(from, 7 * i));
  const people = new Map<string, Set<number>>(weeks.map((w) => [w, new Set()]));
  for (const r of active!.results as { user_id: number; hour: number }[]) {
    people.get(weekStart(churchDate(r.hour * 3_600_000)))?.add(r.user_id);
  }
  const d = (decided!.results as { n: number; avg_ms: number | null }[])[0]!;

  return {
    range: { weeks: opts.weeks, from, to: addDaysTo(thisWeek, 6) },
    overview: (overview!.results as { id: number; key: string; name: string; archived: number; open: number | null; overdue: number | null; completed: number }[]).map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      archived: p.archived === 1,
      open: p.open ?? 0,
      overdue: p.overdue ?? 0,
      completedThisMonth: p.completed,
    })),
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

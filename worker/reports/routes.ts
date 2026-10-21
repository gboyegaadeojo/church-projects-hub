import { type Context, Hono } from "hono";
import { filterFromSearch } from "../../shared/filters";
import { CHURCH_REPORT_NAMES, type ChurchReportName, type ChurchReports, type ProjectReports, REPORT_NAMES, REPORT_RANGES, type ReportName } from "../../shared/reports";
import { PRIORITIES } from "../../shared/tasks";
import { csvField } from "../admin/audit";
import { forbidden, idParam, requirePermission } from "../auth/authorize";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";
import { loadChurchReports } from "./church";
import { loadProjectReports } from "./data";

/** UTF-8 byte-order mark: Excel then shows accented names correctly. */
const BOM = String.fromCharCode(0xfeff);

// Project reports (section 16, RPT-1 to RPT-4): every member can see them ("View reports"), except Workload,
// which is for Project Admins and App Admins. Range 4, 12 or 26 weeks; filters assignee, label and priority,
// the same URL form as the board. Each report exports to CSV.

const projectId = (c: Context<AppEnv>) => idParam(c, "id");

async function load(c: Context<AppEnv>) {
  const project = c.get("project");
  const { user } = c.get("auth");
  const weeks = Number(c.req.query("weeks"));
  const params = new URLSearchParams(c.req.url.split("?")[1] ?? "");
  return loadProjectReports(c.env, {
    projectId: project.id,
    weeks: (REPORT_RANGES as readonly number[]).includes(weeks) ? weeks : 12,
    filter: filterFromSearch(params),
    timezone: user.timezone,
    canSeeWorkload: user.appRole === "admin" || project.role === "admin",
  });
}

/** One report as rows of a CSV (RPT-4). */
export function reportCsv(r: ProjectReports, name: ReportName): string[][] | null {
  switch (name) {
    case "status":
      return [["column", "category", "tasks"], ...r.status.map((s) => [s.name, s.category, String(s.count)])];
    case "at-risk":
      return [
        ["assignee", "task", "title", "due_date", "days_overdue", "priority"],
        ...r.atRisk.flatMap((g) => g.tasks.map((t) => [g.assignee?.name ?? "Unassigned", t.key, t.title, t.dueDate, String(t.daysOverdue), t.priority])),
      ];
    case "throughput":
      return [["week_starting", "created", "completed"], ...r.throughput.map((w) => [w.weekStart, String(w.created), String(w.completed)])];
    case "workload":
      return r.workload ? [["assignee", "open", "overdue"], ...r.workload.map((w) => [w.assignee?.name ?? "Unassigned", String(w.open), String(w.overdue)])] : null;
    case "cycle-time":
      return [["month", "tasks_finished", "median_days", "p85_days"], ...r.cycleTime.map((m) => [m.month, String(m.count), String(m.medianDays ?? ""), String(m.p85Days ?? "")])];
    case "labels":
      return [["label", "open", "completed_in_range"], ...r.labels.map((l) => [l.name, String(l.open), String(l.completed)])];
    case "components":
      return [["component", "open", "completed_in_range"], ...r.components.map((l) => [l.name, String(l.open), String(l.completed)])];
    case "milestones":
      return [
        ["milestone", "target_date", "total", "done", ...PRIORITIES.map((p) => `open_${p}`)],
        ...r.milestones.map((m) => [m.name, m.targetDate ?? "", String(m.total), String(m.done), ...PRIORITIES.map((p) => String(m.openByPriority[p] ?? 0))]),
      ];
  }
}

export function churchCsv(r: ChurchReports, name: ChurchReportName): string[][] {
  switch (name) {
    case "overview":
      return [
        ["project", "key", "archived", "open", "overdue", "completed_this_month", "health", "to_do", "in_progress", "created_in_range", "completed_in_range", "members", "last_activity"],
        ...r.overview.map((p) => [
          p.name,
          p.key,
          p.archived ? "yes" : "no",
          String(p.open),
          String(p.overdue),
          String(p.completedThisMonth),
          p.health,
          String(p.todo),
          String(p.inProgress),
          String(p.createdInRange),
          String(p.completedInRange),
          String(p.members),
          p.lastActivityAt === null ? "" : new Date(p.lastActivityAt).toISOString(),
        ]),
      ];
    case "trend":
      return [["week_starting", "created", "completed"], ...r.trend.map((w) => [w.weekStart, String(w.created), String(w.completed)])];
    case "workload":
      return [["person", "open", "overdue", "projects"], ...r.workload.map((w) => [w.person.name, String(w.open), String(w.overdue), String(w.projects)])];
    case "adoption":
      return [
        ["week_starting", "active_people"],
        ...r.adoption.activeByWeek.map((w) => [w.weekStart, String(w.people)]),
        [],
        ["pending_requests", String(r.adoption.pendingRequests)],
        ["requests_decided_in_range", String(r.adoption.decided)],
        ["average_hours_to_decision", r.adoption.avgDecisionHours === null ? "" : String(r.adoption.avgDecisionHours)],
      ];
  }
}

function csvResponse(rows: string[][], filename: string) {
  // A UTF-8 byte-order mark first, so Excel shows accented names correctly.
  return new Response(`${BOM}${rows.map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}

export function reportRoutes() {
  const routes = new Hono<AppEnv>();
  const guard = [requireSession, requirePermission("report.view", { projectId })] as const;

  routes.get("/projects/:id/reports", ...guard, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await load(c));
  });

  routes.get("/projects/:id/reports/:file", ...guard, async (c) => {
    const name = c.req.param("file").replace(/\.csv$/, "") as ReportName;
    if (!c.req.param("file").endsWith(".csv") || !(REPORT_NAMES as readonly string[]).includes(name)) return forbidden(c, 404);
    const rows = reportCsv(await load(c), name);
    if (!rows) return forbidden(c, 403);
    const key = (await c.env.DB.prepare("SELECT key FROM projects WHERE id = ?1").bind(c.get("project").id).first<string>("key")) ?? "project";
    return csvResponse(rows, `${key}-${name}-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  // ---- Church-wide (section 16 "Who sees it": App Admin).
  async function church(c: Context<AppEnv>) {
    const { user } = c.get("auth");
    if (user.appRole !== "admin" || user.status !== "active") return null;
    const weeks = Number(c.req.query("weeks"));
    return loadChurchReports(c.env, { weeks: (REPORT_RANGES as readonly number[]).includes(weeks) ? weeks : 12, timezone: user.timezone });
  }

  routes.get("/reports/church", requireSession, async (c) => {
    const r = await church(c);
    if (!r) return forbidden(c, 403);
    c.header("Cache-Control", "no-store");
    return c.json(r);
  });

  routes.get("/reports/church/:file", requireSession, async (c) => {
    const file = c.req.param("file");
    const name = file.replace(/\.csv$/, "") as ChurchReportName;
    if (!file.endsWith(".csv") || !(CHURCH_REPORT_NAMES as readonly string[]).includes(name)) return forbidden(c, 404);
    const r = await church(c);
    if (!r) return forbidden(c, 403);
    return csvResponse(churchCsv(r, name), `church-${name}-${new Date().toISOString().slice(0, 10)}.csv`);
  });

  return routes;
}

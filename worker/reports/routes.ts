import { type Context, Hono } from "hono";
import { filterFromSearch } from "../../shared/filters";
import { type ProjectReports, REPORT_NAMES, REPORT_RANGES, type ReportName } from "../../shared/reports";
import { PRIORITIES } from "../../shared/tasks";
import { csvField } from "../admin/audit";
import { forbidden, idParam, requirePermission } from "../auth/authorize";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";
import { loadProjectReports } from "./data";

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
    return new Response(`﻿${rows.map((r) => r.map(csvField).join(",")).join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${key}-${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });

  return routes;
}

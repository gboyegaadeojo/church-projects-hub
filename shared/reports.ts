import { z } from "zod";
import { PROJECT_COLOURS, PROJECT_ICONS } from "./projects";
import { PRIORITIES } from "./tasks";

// Reports (section 16, RPT-1 to RPT-4). Weeks and months follow the church's calendar (Winnipeg), Monday-start.

export const REPORT_RANGES = [4, 12, 26] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
export const REPORT_TIMEZONE = "America/Winnipeg";

export const REPORT_NAMES = ["status", "at-risk", "throughput", "workload", "cycle-time", "labels", "components", "milestones"] as const;
export type ReportName = (typeof REPORT_NAMES)[number];

const person = z.object({ id: z.number().int(), name: z.string() }).nullable();

export const projectReports = z.object({
  range: z.object({ weeks: z.number().int(), from: z.string(), to: z.string() }),
  filtered: z.boolean(),
  status: z.array(z.object({ stateId: z.number().int(), name: z.string(), category: z.enum(["todo", "in_progress", "done"]), count: z.number().int() })),
  atRisk: z.array(
    z.object({
      assignee: person,
      tasks: z.array(z.object({ id: z.number().int(), key: z.string(), title: z.string(), dueDate: z.string(), daysOverdue: z.number().int(), priority: z.enum(PRIORITIES) })),
    }),
  ),
  throughput: z.array(z.object({ weekStart: z.string(), created: z.number().int(), completed: z.number().int() })),
  /** Project Admins and App Admins only (section 16). */
  workload: z.array(z.object({ assignee: person, open: z.number().int(), overdue: z.number().int() })).nullable(),
  cycleTime: z.array(z.object({ month: z.string(), count: z.number().int(), medianDays: z.number().nullable(), p85Days: z.number().nullable() })),
  labels: z.array(z.object({ id: z.number().int(), name: z.string(), open: z.number().int(), completed: z.number().int() })),
  components: z.array(z.object({ id: z.number().int(), name: z.string(), open: z.number().int(), completed: z.number().int() })),
  milestones: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      targetDate: z.string().nullable(),
      total: z.number().int(),
      done: z.number().int(),
      openByPriority: z.record(z.enum(PRIORITIES), z.number().int()),
    }),
  ),
});
export type ProjectReports = z.infer<typeof projectReports>;

export const REPORT_COPY = {
  offline: "Reports aren't available offline. Reconnect to view the latest data.",
} as const;

// ---- Calendar helpers (pure, shared by the hourly job, the API and tests)

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** The church-calendar date (YYYY-MM-DD) of an instant. */
export function churchDate(at: number): string {
  return dayFormat.format(at);
}

/** Monday of the week containing a YYYY-MM-DD date. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = Date.UTC(y!, m! - 1, d!);
  const dow = (new Date(utc).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(utc - dow * 86_400_000).toISOString().slice(0, 10);
}

export function addDaysTo(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Median and 85th percentile (nearest rank) of a list, or nulls when empty. */
export function percentiles(values: number[]): { median: number | null; p85: number | null } {
  if (values.length === 0) return { median: null, p85: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
  const mid = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { median, p85: rank(0.85) };
}

// ---- Church-wide reports (section 16, App Admin): headline numbers, weekly trend, project health, overdue aging,
// open work by priority, workload across projects, access and adoption

export const CHURCH_REPORT_NAMES = ["overview", "trend", "workload", "adoption"] as const;

/** v4.6: on track; at risk (over a fifth of its open work overdue); quiet (no task changes for 21 days); archived. */
export const PROJECT_HEALTH = ["on_track", "at_risk", "quiet", "archived"] as const;
export type ProjectHealth = (typeof PROJECT_HEALTH)[number];
export const PROJECT_HEALTH_LABELS: Record<ProjectHealth, string> = { on_track: "On track", at_risk: "At risk", quiet: "Quiet", archived: "Archived" };
export type ChurchReportName = (typeof CHURCH_REPORT_NAMES)[number];

export const churchReports = z.object({
  range: z.object({ weeks: z.number().int(), from: z.string(), to: z.string() }),
  kpis: z.object({
    activeProjects: z.number().int(),
    open: z.number().int(),
    overdue: z.number().int(),
    unassigned: z.number().int(),
    createdInRange: z.number().int(),
    completedInRange: z.number().int(),
    activePeopleThisWeek: z.number().int(),
    /** Of tasks completed in the range that had a due date: the share finished on or before it, 0–100. */
    onTimeRate: z.number().int().nullable(),
    /** Days from created to done, for tasks completed in the range. */
    medianCycleDays: z.number().nullable(),
  }),
  trend: z.array(z.object({ weekStart: z.string(), created: z.number().int(), completed: z.number().int() })),
  /** Open overdue tasks by how late they are: up to a week, up to a month, longer. */
  aging: z.object({ week: z.number().int(), month: z.number().int(), older: z.number().int() }),
  /** Open tasks by priority. */
  priorities: z.record(z.enum(PRIORITIES), z.number().int()),
  overview: z.array(
    z.object({
      id: z.number().int(),
      key: z.string(),
      name: z.string(),
      colour: z.enum(PROJECT_COLOURS),
      icon: z.enum(PROJECT_ICONS),
      archived: z.boolean(),
      open: z.number().int(),
      todo: z.number().int(),
      inProgress: z.number().int(),
      overdue: z.number().int(),
      createdInRange: z.number().int(),
      completedInRange: z.number().int(),
      completedThisMonth: z.number().int(),
      members: z.number().int(),
      lastActivityAt: z.number().nullable(),
      health: z.enum(PROJECT_HEALTH),
    }),
  ),
  workload: z.array(z.object({ person: z.object({ id: z.number().int(), name: z.string() }), open: z.number().int(), overdue: z.number().int(), projects: z.number().int() })),
  adoption: z.object({
    /** People who signed in or changed a task or comment, per week. */
    activeByWeek: z.array(z.object({ weekStart: z.string(), people: z.number().int() })),
    pendingRequests: z.number().int(),
    /** Mean hours from request to decision, for requests decided in the range. */
    avgDecisionHours: z.number().nullable(),
    decided: z.number().int(),
  }),
});
export type ChurchReports = z.infer<typeof churchReports>;

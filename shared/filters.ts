import { z } from "zod";
import { dueStatus, PRIORITIES, type Priority, SCOPES, type Scope, TASK_TYPES, type TaskCard } from "./tasks";

// Board and list filters (section 11.2: Assignee, Label, Priority, Scope; v4.6 adds Type, Epic, Due and a text
// search) and saved filters (ORG-5). The same shape is kept in the URL, stored in saved_filters.query_json and
// applied on the client. Every new field defaults to empty, so filters saved before v4.6 still load.

export const DUE_FILTERS = ["overdue", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];
export const DUE_FILTER_LABELS: Record<DueFilter, string> = { overdue: "Overdue", week: "Due within 7 days", none: "No due date" };

const id = z.number().int().positive();

export const taskFilter = z.object({
  /** "none" matches unassigned tasks. */
  assignees: z.array(z.union([id, z.literal("none")])).max(50).default([]),
  labels: z.array(id).max(50).default([]),
  priorities: z.array(z.enum(PRIORITIES)).max(PRIORITIES.length).default([]),
  scopes: z.array(z.enum(SCOPES)).max(SCOPES.length).default([]),
  types: z.array(z.enum(TASK_TYPES)).max(TASK_TYPES.length).default([]),
  /** Epic task ids; "none" matches tasks outside any epic. */
  epics: z.array(z.union([id, z.literal("none")])).max(50).default([]),
  due: z.array(z.enum(DUE_FILTERS)).max(DUE_FILTERS.length).default([]),
  /** Words in the title or key. */
  q: z.string().trim().max(100).default(""),
});
export type TaskFilter = z.infer<typeof taskFilter>;

export const EMPTY_FILTER: TaskFilter = { assignees: [], labels: [], priorities: [], scopes: [], types: [], epics: [], due: [], q: "" };

/** How many filter values are on (the search counts as one). */
export function activeFilterCount(f: TaskFilter): number {
  return f.assignees.length + f.labels.length + f.priorities.length + f.scopes.length + f.types.length + f.epics.length + f.due.length + (f.q ? 1 : 0);
}

export function isFilterActive(f: TaskFilter): boolean {
  return activeFilterCount(f) > 0;
}

/**
 * Within a group any value matches (OR); across groups all must match (AND). A person matches tasks where they are
 * the assignee or the secondary assignee (v4.6); "none" matches tasks with no assignee.
 */
export function matchesFilter(
  task: Pick<TaskCard, "assigneeId" | "labelIds" | "priority" | "scope"> &
    Partial<Pick<TaskCard, "secondaryAssigneeId" | "type" | "epicId" | "dueDate" | "title" | "key">>,
  f: TaskFilter,
  /** The viewer's date (YYYY-MM-DD), for the Due filter; without it that filter is ignored. */
  today?: string,
): boolean {
  if (
    f.assignees.length &&
    !f.assignees.includes(task.assigneeId ?? "none") &&
    !(task.secondaryAssigneeId != null && f.assignees.includes(task.secondaryAssigneeId))
  ) {
    return false;
  }
  if (f.labels.length && !task.labelIds.some((l) => f.labels.includes(l))) return false;
  if (f.priorities.length && !f.priorities.includes(task.priority)) return false;
  if (f.scopes.length && !f.scopes.includes(task.scope)) return false;
  if (f.types.length && task.type && !f.types.includes(task.type)) return false;
  if (f.epics.length && task.epicId !== undefined && !f.epics.includes(task.epicId ?? "none")) return false;
  if (f.due.length && today && task.dueDate !== undefined) {
    const status = dueStatus(task.dueDate, today);
    const hit =
      (f.due.includes("none") && !task.dueDate) ||
      (f.due.includes("overdue") && status === "overdue") ||
      (f.due.includes("week") && (status === "soon" || status === "overdue"));
    if (!hit) return false;
  }
  if (f.q) {
    const haystack = `${task.key ?? ""} ${task.title ?? ""}`.toLowerCase();
    if (!f.q.toLowerCase().split(/\s+/).every((word) => haystack.includes(word))) return false;
  }
  return true;
}

// ---- URL form: ?assignee=3,none&label=5&priority=high&scope=parked

export function filterFromSearch(params: URLSearchParams): TaskFilter {
  const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
  const parsed = taskFilter.safeParse({
    assignees: list("assignee").map((v) => (v === "none" ? v : Number(v))),
    labels: list("label").map(Number),
    priorities: list("priority"),
    scopes: list("scope"),
    types: list("type"),
    epics: list("epic").map((v) => (v === "none" ? v : Number(v))),
    due: list("due_by"),
    q: params.get("q") ?? "",
  });
  return parsed.success ? parsed.data : EMPTY_FILTER;
}

export function filterToSearch(f: TaskFilter, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  const put = (key: string, values: (string | number)[]) => (values.length ? next.set(key, values.join(",")) : next.delete(key));
  put("assignee", f.assignees);
  put("label", f.labels);
  put("priority", f.priorities);
  put("scope", f.scopes);
  put("type", f.types);
  put("epic", f.epics);
  // "due" is taken by the reports' drill-down, so the board's Due filter is due_by.
  put("due_by", f.due);
  if (f.q) next.set("q", f.q);
  else next.delete("q");
  return next;
}

export type FilterGroup = "assignees" | "labels" | "priorities" | "scopes" | "types" | "epics" | "due";

export function toggleIn<T extends number | string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

// ---- Saved filters (ORG-5)

export const savedFilterBody = z.object({
  name: z.string().trim().min(1, "Name this filter.").max(40, "Keep the name under 40 characters."),
  query: taskFilter,
  shared: z.boolean().default(false),
});
export type SavedFilterBody = z.input<typeof savedFilterBody>;

export const savedFilter = z.object({
  id: z.number().int(),
  name: z.string(),
  query: taskFilter,
  shared: z.boolean(),
  ownerId: z.number().int(),
});
export type SavedFilter = z.infer<typeof savedFilter>;
export const savedFiltersResponse = z.object({ filters: z.array(savedFilter) });

export type { Priority, Scope };

// ---- Report drill-downs (section 16 "View tasks"): narrower than the board's own filters, carried in the URL
// alongside them: ?category=done&due=overdue&milestone=4&component=2.

export type DrillFilter = {
  category: "todo" | "in_progress" | "done" | "open" | null;
  due: "overdue" | "soon" | null;
  milestone: number | null;
  component: number | null;
};

const positive = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

export function drillFromSearch(params: URLSearchParams): DrillFilter {
  const category = params.get("category");
  const due = params.get("due");
  return {
    category: category === "todo" || category === "in_progress" || category === "done" || category === "open" ? category : null,
    due: due === "overdue" || due === "soon" ? due : null,
    milestone: positive(params.get("milestone")),
    component: positive(params.get("component")),
  };
}

export function isDrillActive(d: DrillFilter): boolean {
  return d.category !== null || d.due !== null || d.milestone !== null || d.component !== null;
}

export function clearDrill(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of ["category", "due", "milestone", "component"]) next.delete(k);
  return next;
}

/** `categoryOf` maps a column to its category; `today` is the viewer's YYYY-MM-DD. */
export function matchesDrill(
  task: Pick<TaskCard, "stateId" | "dueDate" | "milestoneId" | "componentId">,
  d: DrillFilter,
  categoryOf: (stateId: number) => string | undefined,
  today: string,
): boolean {
  const category = categoryOf(task.stateId);
  if (d.category === "open" ? category === "done" : d.category && category !== d.category) return false;
  if (d.due) {
    if (!task.dueDate || category === "done") return false;
    if (d.due === "overdue" && task.dueDate >= today) return false;
    if (d.due === "soon") {
      const [y, m, day] = today.split("-").map(Number);
      const week = new Date(Date.UTC(y!, m! - 1, day! + 7)).toISOString().slice(0, 10);
      if (task.dueDate > week) return false;
    }
  }
  if (d.milestone !== null && task.milestoneId !== d.milestone) return false;
  if (d.component !== null && task.componentId !== d.component) return false;
  return true;
}

/** A plain-words description of an active drill-down, for the banner above the board. */
export function describeDrill(d: DrillFilter, names: { milestone?: string; component?: string; category?: string }): string {
  const parts: string[] = [];
  if (d.category === "open") parts.push("open tasks");
  else if (d.category) parts.push(`${names.category ?? d.category} tasks`);
  if (d.due === "overdue") parts.push("overdue");
  if (d.due === "soon") parts.push("overdue or due within 7 days");
  if (d.milestone !== null) parts.push(`in ${names.milestone ?? "the milestone"}`);
  if (d.component !== null) parts.push(`in ${names.component ?? "the component"}`);
  return parts.join(", ");
}

import { z } from "zod";
import { PRIORITIES, type Priority, SCOPES, type Scope, type TaskCard } from "./tasks";

// Board and list filters (section 11.2: Assignee, Label, Priority, Scope) and saved filters (ORG-5).
// The same shape is kept in the URL, stored in saved_filters.query_json and applied on the client.

const id = z.number().int().positive();

export const taskFilter = z.object({
  /** "none" matches unassigned tasks. */
  assignees: z.array(z.union([id, z.literal("none")])).max(50).default([]),
  labels: z.array(id).max(50).default([]),
  priorities: z.array(z.enum(PRIORITIES)).max(PRIORITIES.length).default([]),
  scopes: z.array(z.enum(SCOPES)).max(SCOPES.length).default([]),
});
export type TaskFilter = z.infer<typeof taskFilter>;

export const EMPTY_FILTER: TaskFilter = { assignees: [], labels: [], priorities: [], scopes: [] };

export function isFilterActive(f: TaskFilter): boolean {
  return f.assignees.length + f.labels.length + f.priorities.length + f.scopes.length > 0;
}

/**
 * Within a group any value matches (OR); across groups all must match (AND). A person matches tasks where they are
 * the assignee or the secondary assignee (v4.6); "none" matches tasks with no assignee.
 */
export function matchesFilter(
  task: Pick<TaskCard, "assigneeId" | "labelIds" | "priority" | "scope"> & Partial<Pick<TaskCard, "secondaryAssigneeId">>,
  f: TaskFilter,
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
  return next;
}

export type FilterGroup = "assignees" | "labels" | "priorities" | "scopes";

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

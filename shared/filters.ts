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

/** Within a group any value matches (OR); across groups all must match (AND). */
export function matchesFilter(task: Pick<TaskCard, "assigneeId" | "labelIds" | "priority" | "scope">, f: TaskFilter): boolean {
  if (f.assignees.length && !f.assignees.includes(task.assigneeId ?? "none")) return false;
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

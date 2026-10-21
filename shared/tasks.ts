import { z } from "zod";
import { projectRole } from "./access";
import { PROJECT_COLOURS } from "./projects";
import { richText } from "./richtext";

// Tasks and their organisation — contract shared by the Worker and the app
// (TASK-1 to TASK-10, ORG-1 to ORG-4, sections 6, 11.2, 11.3, 14).

export const TASK_TYPES = ["task", "bug", "idea", "epic"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_TYPE_LABELS: Record<TaskType, string> = { task: "Task", bug: "Bug", idea: "Idea", epic: "Epic" };

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

/** TASK-7 scope marker. */
export const SCOPES = ["in_scope", "out_of_scope", "parked"] as const;
export type Scope = (typeof SCOPES)[number];
export const SCOPE_LABELS: Record<Scope, string> = { in_scope: "In scope", out_of_scope: "Out of scope", parked: "Parked" };

export const WORKFLOW_CATEGORY_VALUES = ["todo", "in_progress", "done"] as const;
export type WorkflowCategory = (typeof WORKFLOW_CATEGORY_VALUES)[number];

export const TASK_LIMITS = {
  title: 200,
  subtaskTitle: 200,
  subtasksPerTask: 50,
  labelsPerTask: 10,
  labelName: 30,
  stateName: 30,
  componentName: 40,
  milestoneName: 60,
  bulk: 100,
  /** PROJ-3: at most 8 columns. */
  columns: 8,
} as const;

/** Exact copy from sections 11.2, 11.3 and 14. */
export const TASK_COPY = {
  saved: "Saved ✓",
  saveFailed: "We couldn't save this change. Check your connection and try again.",
  moveFailed: "Couldn't move this task. The board has been restored.",
  conflict: "This task was updated by someone else. Review the changes before saving yours.",
  emptyBoard: "No tasks yet. Create the first one.",
  emptyDescription: "Add a description.",
  dataSafety: "Don't include children's details or confidential pastoral information.",
  deleted: "Task deleted.",
  confirmFailed: "That didn't go through. Check your connection and try again.",
} as const;

export const TASK_ERRORS = {
  conflict: "conflict",
  invalidReference: "invalid_reference",
  tooMany: "too_many",
  nameTaken: "name_taken",
  /** A workflow column that holds, or once held, tasks can't be removed. */
  notEmpty: "not_empty",
  lastColumn: "last_column",
} as const;

/** Confirmation header values (section 11.14) for destructive task actions. */
export const TASK_CONFIRM = {
  deleteTask: "task.delete",
  deleteComment: "comment.delete",
  deleteSubtask: "subtask.delete",
  deleteLabel: "label.delete",
  deleteComponent: "component.delete",
  deleteMilestone: "milestone.delete",
  deleteAttachment: "attachment.delete",
  deleteSavedFilter: "saved_filter.delete",
  deleteState: "state.delete",
} as const;

// ---- Keys and dates

/** MEDIA-42 → { projectKey: "MEDIA", number: 42 }. */
export const TASK_KEY_RE = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})$/;
export function parseTaskKey(key: string): { projectKey: string; number: number } | null {
  const m = TASK_KEY_RE.exec(key.trim());
  return m ? { projectKey: m[1]!.toUpperCase(), number: Number(m[2]) } : null;
}
export const taskKey = (projectKey: string, number: number) => `${projectKey}-${number}`;

/** Due dates are calendar dates with no time (section 11.3). */
export const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-04-04.")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "That date doesn't exist.");

// ---- Request bodies

const id = z.number().int().positive();
const title = z
  .string()
  .trim()
  .min(1, "Enter a title.")
  .max(TASK_LIMITS.title, `Keep the title under ${TASK_LIMITS.title} characters.`);
const labelIds = z
  .array(id)
  .max(TASK_LIMITS.labelsPerTask, `Use at most ${TASK_LIMITS.labelsPerTask} labels.`)
  .refine((ids) => new Set(ids).size === ids.length, "Each label can be used once.");

const editableFields = {
  title,
  description: richText("description"),
  type: z.enum(TASK_TYPES),
  stateId: id,
  priority: z.enum(PRIORITIES),
  scope: z.enum(SCOPES),
  assigneeId: id.nullable(),
  /** v4.6: a second person on the task. Never the same as the assignee. */
  secondaryAssigneeId: id.nullable(),
  dueDate: dueDate.nullable(),
  labelIds,
  componentId: id.nullable(),
  epicId: id.nullable(),
  milestoneId: id.nullable(),
};

export const createTaskBody = z.object({
  title,
  description: editableFields.description.optional(),
  type: editableFields.type.default("task"),
  /** Defaults to the project's first column. */
  stateId: id.optional(),
  priority: editableFields.priority.default("medium"),
  scope: editableFields.scope.default("in_scope"),
  assigneeId: editableFields.assigneeId.default(null),
  secondaryAssigneeId: editableFields.secondaryAssigneeId.default(null),
  dueDate: editableFields.dueDate.default(null),
  labelIds: labelIds.default([]),
  componentId: editableFields.componentId.default(null),
  epicId: editableFields.epicId.default(null),
  milestoneId: editableFields.milestoneId.default(null),
});
export type CreateTaskBody = z.input<typeof createTaskBody>;

/** NFR-10: every edit carries the version it was based on; a mismatch is a 409 conflict, never an overwrite. */
export const updateTaskBody = z
  .object({ version: z.number().int().nonnegative(), ...editableFields })
  .partial({
    title: true,
    description: true,
    type: true,
    stateId: true,
    priority: true,
    scope: true,
    assigneeId: true,
    secondaryAssigneeId: true,
    dueDate: true,
    labelIds: true,
    componentId: true,
    epicId: true,
    milestoneId: true,
  })
  .refine((b) => Object.keys(b).length > 1, "Nothing to change.");
export type UpdateTaskBody = z.input<typeof updateTaskBody>;
export const TASK_EDITABLE_FIELDS = Object.keys(editableFields) as (keyof typeof editableFields)[];

/** Board move: the target column and the cards it lands between (either may be absent at a column's ends). */
export const moveTaskBody = z.object({
  stateId: id,
  afterId: id.nullable().default(null),
  beforeId: id.nullable().default(null),
});
export type MoveTaskBody = z.input<typeof moveTaskBody>;

/** TASK-10 bulk edit: assignee, status, labels or due date for several tasks at once. */
export const bulkEditBody = z
  .object({
    taskIds: z
      .array(id)
      .min(1, "Select at least one task.")
      .max(TASK_LIMITS.bulk, `Select at most ${TASK_LIMITS.bulk} tasks.`)
      .refine((ids) => new Set(ids).size === ids.length),
    assigneeId: id.nullable().optional(),
    stateId: id.optional(),
    dueDate: dueDate.nullable().optional(),
    addLabelIds: z.array(id).max(TASK_LIMITS.labelsPerTask).optional(),
    removeLabelIds: z.array(id).max(TASK_LIMITS.labelsPerTask).optional(),
  })
  .refine((b) => Object.keys(b).length > 1, "Nothing to change.");
export type BulkEditBody = z.input<typeof bulkEditBody>;

const subtaskTitle = z
  .string()
  .trim()
  .min(1, "Enter the checklist item.")
  .max(TASK_LIMITS.subtaskTitle, `Keep it under ${TASK_LIMITS.subtaskTitle} characters.`);
export const createSubtaskBody = z.object({ title: subtaskTitle });
export const updateSubtaskBody = z
  .object({ title: subtaskTitle, done: z.boolean(), position: z.number().int().nonnegative() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

export const commentBody = z.object({ body: richText("comment") });

export const labelBody = z.object({
  name: z.string().trim().min(1, "Enter a label name.").max(TASK_LIMITS.labelName, `Keep it under ${TASK_LIMITS.labelName} characters.`),
  colour: z.enum(PROJECT_COLOURS, "Choose a colour."),
});
/** PROJ-3: a workflow column's name and the category reports group it under. */
export const stateBody = z.object({
  name: z.string().trim().min(1, "Enter a column name.").max(TASK_LIMITS.stateName, `Keep it under ${TASK_LIMITS.stateName} characters.`),
  category: z.enum(WORKFLOW_CATEGORY_VALUES, "Choose what the column means."),
});
export const stateOrderBody = z.object({ ids: z.array(id).min(1).max(TASK_LIMITS.columns) });

export const componentBody = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a component name.")
    .max(TASK_LIMITS.componentName, `Keep it under ${TASK_LIMITS.componentName} characters.`),
  leadId: id.nullable().default(null),
});
export const milestoneBody = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a milestone name.")
    .max(TASK_LIMITS.milestoneName, `Keep it under ${TASK_LIMITS.milestoneName} characters.`),
  targetDate: dueDate.nullable().default(null),
  released: z.boolean().default(false),
});

// ---- Responses

const richTextDoc = z.object({ type: z.literal("doc"), content: z.array(z.any()).optional() });

export const person = z.object({ id: z.number().int(), name: z.string(), avatarUrl: z.string().nullable() });
export type Person = z.infer<typeof person>;

export const workflowState = z.object({
  id: z.number().int(),
  name: z.string(),
  category: z.enum(WORKFLOW_CATEGORY_VALUES),
  position: z.number().int(),
});
export type WorkflowState = z.infer<typeof workflowState>;

export const label = z.object({ id: z.number().int(), name: z.string(), colour: z.enum(PROJECT_COLOURS) });
export type Label = z.infer<typeof label>;
export const component = z.object({ id: z.number().int(), name: z.string(), leadId: z.number().int().nullable() });
export type Component = z.infer<typeof component>;
export const milestone = z.object({
  id: z.number().int(),
  name: z.string(),
  targetDate: z.string().nullable(),
  released: z.boolean(),
});
export type Milestone = z.infer<typeof milestone>;

export const member = person.extend({ role: projectRole });
export type Member = z.infer<typeof member>;

/** What a board card and a list row need (section 11.2). */
export const taskCard = z.object({
  id: z.number().int(),
  key: z.string(),
  number: z.number().int(),
  title: z.string(),
  type: z.enum(TASK_TYPES),
  stateId: z.number().int(),
  priority: z.enum(PRIORITIES),
  scope: z.enum(SCOPES),
  assigneeId: z.number().int().nullable(),
  secondaryAssigneeId: z.number().int().nullable(),
  reporterId: z.number().int(),
  dueDate: z.string().nullable(),
  labelIds: z.array(z.number().int()),
  componentId: z.number().int().nullable(),
  epicId: z.number().int().nullable(),
  milestoneId: z.number().int().nullable(),
  rank: z.string(),
  version: z.number().int(),
  subtasksDone: z.number().int(),
  subtasksTotal: z.number().int(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type TaskCard = z.infer<typeof taskCard>;

export const boardResponse = z.object({
  states: z.array(workflowState),
  tasks: z.array(taskCard),
  labels: z.array(label),
  components: z.array(component),
  milestones: z.array(milestone),
  members: z.array(member),
  /** Everyone named on a task, including people no longer in the project. */
  people: z.array(person),
});
export type BoardResponse = z.infer<typeof boardResponse>;

export const subtask = z.object({ id: z.number().int(), title: z.string(), done: z.boolean(), position: z.number().int() });
export type Subtask = z.infer<typeof subtask>;

export const comment = z.object({
  id: z.number().int(),
  authorId: z.number().int(),
  body: richTextDoc,
  createdAt: z.number(),
  editedAt: z.number().nullable(),
});
export type Comment = z.infer<typeof comment>;

export const taskEvent = z.object({
  id: z.number().int(),
  actorId: z.number().int().nullable(),
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  at: z.number(),
});
export type TaskEvent = z.infer<typeof taskEvent>;

export const attachment = z.object({
  id: z.number().int(),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number().int(),
  uploadedBy: z.number().int(),
  createdAt: z.number(),
});
export type Attachment = z.infer<typeof attachment>;

export const taskDetail = taskCard.extend({
  projectId: z.number().int(),
  projectKey: z.string(),
  description: richTextDoc,
  subtasks: z.array(subtask),
  comments: z.array(comment),
  events: z.array(taskEvent),
  attachments: z.array(attachment),
  watcherIds: z.array(z.number().int()),
  people: z.array(person),
});
export type TaskDetail = z.infer<typeof taskDetail>;
export const taskResponse = z.object({ task: taskDetail });

/** 409 body: the task as it is now, so the person can review before saving theirs (NFR-10). */
export const conflictResponse = z.object({ error: z.literal(TASK_ERRORS.conflict), task: taskDetail });

// ---- Due dates (section 11.3)

export type DueStatus = "overdue" | "soon" | "later";
const DAY_MS = 86_400_000;

/** Today's calendar date (YYYY-MM-DD) in a timezone. */
export function todayIn(timezone: string, now: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

/** Overdue from 00:00 the day after the due date; due soon from 7 days before it (in the viewer's timezone). */
export function dueStatus(due: string | null, today: string): DueStatus | null {
  if (!due) return null;
  const days = (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
  if (days < 0) return "overdue";
  if (days <= 7) return "soon";
  return "later";
}

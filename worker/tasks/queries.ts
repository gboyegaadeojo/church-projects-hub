import type { ProjectRole } from "../../shared/access";
import type { RichTextDoc } from "../../shared/richtext";
import { type Attachment, type Comment, type Person, type Subtask, type TaskCard, type TaskDetail, type TaskEvent } from "../../shared/tasks";
import type { ProjectContext } from "../auth/permissions";

// Reading tasks: board cards, the access check for one task, task detail, and reference checks.

export const CARD_COLUMNS = `
  t.id, t.project_id, t.number, t.title, t.type, t.state_id, t.priority, t.scope, t.assignee_id, t.secondary_assignee_id, t.reporter_id,
  t.due_date, t.component_id, t.epic_id, t.milestone_id, t.rank, t.version, t.created_at, t.updated_at,
  p.key AS project_key,
  (SELECT group_concat(label_id) FROM task_labels WHERE task_id = t.id) AS label_ids,
  (SELECT count(*) FROM subtasks WHERE task_id = t.id) AS subtasks_total,
  (SELECT count(*) FROM subtasks WHERE task_id = t.id AND done = 1) AS subtasks_done`;

export type CardRow = {
  id: number;
  project_id: number;
  number: number;
  title: string;
  type: TaskCard["type"];
  state_id: number;
  priority: TaskCard["priority"];
  scope: TaskCard["scope"];
  assignee_id: number | null;
  secondary_assignee_id: number | null;
  reporter_id: number;
  due_date: string | null;
  component_id: number | null;
  epic_id: number | null;
  milestone_id: number | null;
  rank: string;
  version: number;
  created_at: number;
  updated_at: number;
  project_key: string;
  label_ids: string | null;
  subtasks_total: number;
  subtasks_done: number;
};

export function labelIdsOf(row: Pick<CardRow, "label_ids">): number[] {
  return row.label_ids ? row.label_ids.split(",").map(Number).sort((a, b) => a - b) : [];
}

export function toCard(row: CardRow): TaskCard {
  return {
    id: row.id,
    key: `${row.project_key}-${row.number}`,
    number: row.number,
    title: row.title,
    type: row.type,
    stateId: row.state_id,
    priority: row.priority,
    scope: row.scope,
    assigneeId: row.assignee_id,
    secondaryAssigneeId: row.secondary_assignee_id,
    reporterId: row.reporter_id,
    dueDate: row.due_date,
    labelIds: labelIdsOf(row),
    componentId: row.component_id,
    epicId: row.epic_id,
    milestoneId: row.milestone_id,
    rank: row.rank,
    version: row.version,
    subtasksDone: row.subtasks_done,
    subtasksTotal: row.subtasks_total,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadCard(env: Env, taskId: number): Promise<TaskCard | null> {
  const row = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS} FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?1 AND t.deleted_at IS NULL`,
  )
    .bind(taskId)
    .first<CardRow>();
  return row ? toCard(row) : null;
}

export type TaskAccess = { task: CardRow & { description_json: string }; project: ProjectContext };

/** One live task with its project and the person's role there, in one query. Null if missing or deleted. */
export async function loadTaskAccess(env: Env, taskId: number, userId: number): Promise<TaskAccess | null> {
  const row = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS}, t.description_json, p.archived_at, p.is_system, m.role
     FROM tasks t JOIN projects p ON p.id = t.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ?2
     WHERE t.id = ?1 AND t.deleted_at IS NULL AND p.deleted_at IS NULL`,
  )
    .bind(taskId, userId)
    .first<CardRow & { description_json: string; archived_at: number | null; is_system: number; role: ProjectRole | null }>();
  if (!row) return null;
  const { archived_at, is_system, role, ...task } = row;
  return { task, project: { id: row.project_id, archived: archived_at !== null, isSystem: is_system === 1, role } };
}

type PersonRow = { id: number; name: string; avatar_url: string | null };
export const toPerson = (r: PersonRow): Person => ({ id: r.id, name: r.name, avatarUrl: r.avatar_url });

/**
 * Everything the task detail shows, in one batch. Opening the task also marks the viewer's mentions in it as
 * seen (My Work's "Mentioned me", NAV-3); that update writes only when there are unseen mentions.
 */
export async function loadTaskDetail(env: Env, taskId: number, viewerId: number | null = null): Promise<TaskDetail | null> {
  const statements = [
    env.DB.prepare(
      `SELECT ${CARD_COLUMNS}, t.description_json FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?1 AND t.deleted_at IS NULL`,
    ).bind(taskId),
    env.DB.prepare("SELECT id, title, done, position FROM subtasks WHERE task_id = ?1 ORDER BY position, id").bind(taskId),
    env.DB.prepare(
      `SELECT id, author_id, body_json, created_at, edited_at FROM comments
       WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id`,
    ).bind(taskId),
    // Newest 200 history entries, shown oldest first.
    env.DB.prepare(
      `SELECT * FROM (SELECT id, actor_id, field, old_value, new_value, at FROM task_events
       WHERE task_id = ?1 ORDER BY at DESC, id DESC LIMIT 200) ORDER BY at, id`,
    ).bind(taskId),
    env.DB.prepare(
      `SELECT id, filename, mime, bytes, uploaded_by, created_at FROM attachments
       WHERE task_id = ?1 AND deleted_at IS NULL ORDER BY created_at, id`,
    ).bind(taskId),
    env.DB.prepare("SELECT user_id FROM watchers WHERE task_id = ?1").bind(taskId),
    // D1 limits how many SELECTs one compound query may join, so the people are gathered in small groups.
    env.DB.prepare(
      `SELECT id, name, avatar_url FROM users
       WHERE id IN (SELECT reporter_id FROM tasks WHERE id = ?1 UNION SELECT assignee_id FROM tasks WHERE id = ?1
                    UNION SELECT secondary_assignee_id FROM tasks WHERE id = ?1)
          OR id IN (SELECT author_id FROM comments WHERE task_id = ?1 AND deleted_at IS NULL
                    UNION SELECT uploaded_by FROM attachments WHERE task_id = ?1 AND deleted_at IS NULL)
          OR id IN (SELECT actor_id FROM task_events WHERE task_id = ?1 UNION SELECT user_id FROM watchers WHERE task_id = ?1)
          OR id IN (SELECT CAST(old_value AS INTEGER) FROM task_events WHERE task_id = ?1 AND field IN ('assignee', 'secondary_assignee')
                    UNION SELECT CAST(new_value AS INTEGER) FROM task_events WHERE task_id = ?1 AND field IN ('assignee', 'secondary_assignee'))`,
    ).bind(taskId),
  ];
  if (viewerId !== null) {
    statements.push(
      env.DB.prepare("UPDATE mentions SET seen_at = ?3 WHERE task_id = ?1 AND user_id = ?2 AND seen_at IS NULL").bind(
        taskId,
        viewerId,
        Date.now(),
      ),
    );
  }
  const [main, subs, comms, events, files, watch, people] = await env.DB.batch(statements);
  const row = (main!.results as (CardRow & { description_json: string })[])[0];
  if (!row) return null;
  return {
    ...toCard(row),
    projectId: row.project_id,
    projectKey: row.project_key,
    description: JSON.parse(row.description_json) as RichTextDoc,
    subtasks: (subs!.results as { id: number; title: string; done: number; position: number }[]).map(
      (s): Subtask => ({ id: s.id, title: s.title, done: s.done === 1, position: s.position }),
    ),
    comments: (comms!.results as { id: number; author_id: number; body_json: string; created_at: number; edited_at: number | null }[]).map(
      (c): Comment => ({
        id: c.id,
        authorId: c.author_id,
        body: JSON.parse(c.body_json) as Comment["body"],
        createdAt: c.created_at,
        editedAt: c.edited_at,
      }),
    ),
    events: (events!.results as { id: number; actor_id: number | null; field: string; old_value: string | null; new_value: string | null; at: number }[]).map(
      (e): TaskEvent => ({ id: e.id, actorId: e.actor_id, field: e.field, oldValue: e.old_value, newValue: e.new_value, at: e.at }),
    ),
    attachments: (files!.results as { id: number; filename: string; mime: string; bytes: number; uploaded_by: number; created_at: number }[]).map(
      (a): Attachment => ({ id: a.id, filename: a.filename, mime: a.mime, bytes: a.bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at }),
    ),
    watcherIds: (watch!.results as { user_id: number }[]).map((w) => w.user_id),
    people: (people!.results as PersonRow[]).map(toPerson),
  };
}

export type RefCheck = {
  stateId?: number;
  assigneeId?: number | null;
  secondaryAssigneeId?: number | null;
  labelIds?: number[];
  componentId?: number | null;
  milestoneId?: number | null;
  epicId?: number | null;
  /** The task being edited, so it can't be its own epic. */
  selfId?: number;
};

/**
 * Checks that every reference belongs to this project (one query). Assignees must be active Project Admins or
 * Contributors here — or App Admins on Hub Feedback, which has no members (PROJ-7). Returns the first bad
 * field, or null.
 */
export async function invalidReference(env: Env, project: ProjectContext, refs: RefCheck): Promise<keyof RefCheck | null> {
  const row = await env.DB.prepare(
    `SELECT
       (?2 IS NULL OR EXISTS (SELECT 1 FROM workflow_states WHERE id = ?2 AND project_id = ?1)) AS stateId,
       (?3 IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = ?3 AND u.status = 'active' AND u.deleted_at IS NULL AND (
          EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ?1 AND m.user_id = u.id AND m.role IN ('admin', 'contributor'))
          OR (u.app_role = 'admin' AND ?8 = 1)))) AS assigneeId,
       (?10 IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = ?10 AND u.status = 'active' AND u.deleted_at IS NULL AND (
          EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ?1 AND m.user_id = u.id AND m.role IN ('admin', 'contributor'))
          OR (u.app_role = 'admin' AND ?8 = 1)))) AS secondaryAssigneeId,
       ((SELECT count(*) FROM labels WHERE project_id = ?1 AND id IN (SELECT value FROM json_each(?4))) = json_array_length(?4)) AS labelIds,
       (?5 IS NULL OR EXISTS (SELECT 1 FROM components WHERE id = ?5 AND project_id = ?1)) AS componentId,
       (?6 IS NULL OR EXISTS (SELECT 1 FROM milestones WHERE id = ?6 AND project_id = ?1)) AS milestoneId,
       (?7 IS NULL OR EXISTS (SELECT 1 FROM tasks WHERE id = ?7 AND project_id = ?1 AND type = 'epic' AND deleted_at IS NULL AND id != ?9)) AS epicId`,
  )
    .bind(
      project.id,
      refs.stateId ?? null,
      refs.assigneeId ?? null,
      JSON.stringify(refs.labelIds ?? []),
      refs.componentId ?? null,
      refs.milestoneId ?? null,
      refs.epicId ?? null,
      project.isSystem ? 1 : 0,
      refs.selfId ?? 0,
      refs.secondaryAssigneeId ?? null,
    )
    .first<Record<"stateId" | "assigneeId" | "secondaryAssigneeId" | "labelIds" | "componentId" | "milestoneId" | "epicId", number>>();
  for (const field of ["stateId", "assigneeId", "secondaryAssigneeId", "labelIds", "componentId", "milestoneId", "epicId"] as const) {
    if (row?.[field] !== 1) return field;
  }
  return null;
}

/** The last rank in a column, so a new or re-statused task goes to the bottom. */
export async function lastRankIn(env: Env, projectId: number, stateId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT max(rank) AS rank FROM tasks WHERE project_id = ?1 AND state_id = ?2 AND deleted_at IS NULL",
  )
    .bind(projectId, stateId)
    .first<{ rank: string | null }>();
  return row?.rank ?? null;
}

/**
 * @mentions saved to the mentions table (section 11.5). Only people who can see the project are recorded, never
 * the author. `taskIdSql` is `?6` for an existing task or a subquery for one inserted in the same batch.
 */
export function insertMentions(
  env: Env,
  opts: { projectId: number; isSystem: boolean; userIds: number[]; actorId: number; now: number; taskIdSql: string; taskId?: number; commentIdSql?: string },
) {
  return env.DB.prepare(
    `INSERT INTO mentions (task_id, comment_id, user_id, created_at, updated_at, created_by)
     SELECT ${opts.taskIdSql}, ${opts.commentIdSql ?? "NULL"}, u.id, ?4, ?4, ?3 FROM users u
     WHERE u.id IN (SELECT value FROM json_each(?2)) AND u.id != ?3 AND u.status = 'active' AND (
       EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ?1 AND m.user_id = u.id)
       OR (u.app_role = 'admin' AND ?5 = 1))`,
  ).bind(
    ...[opts.projectId, JSON.stringify(opts.userIds), opts.actorId, opts.now, opts.isSystem ? 1 : 0],
    // ?6 only when the SQL uses it: D1 rejects unused parameters.
    ...(opts.taskId === undefined ? [] : [opts.taskId]),
  );
}

/** Mentioned user ids in a stored document, to record only new mentions on edit. */
export function mentionsIn(doc: unknown): Set<number> {
  const out = new Set<number>();
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const node = n as { type?: string; attrs?: { id?: unknown }; content?: unknown[] };
    if (node.type === "mention") out.add(Number(node.attrs?.id));
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(doc);
  return out;
}

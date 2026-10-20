import { type Context, Hono } from "hono";
import { ACCESS_ERRORS, CONFIRM_HEADER, type ProjectRole } from "../../shared/access";
import type { ParsedRichText } from "../../shared/richtext";
import {
  type BoardResponse,
  bulkEditBody,
  createTaskBody,
  moveTaskBody,
  parseTaskKey,
  TASK_CONFIRM,
  TASK_ERRORS,
  type TaskCard,
  updateTaskBody,
} from "../../shared/tasks";
import { AUDIT, auditStatement } from "../audit";
import { forbidden, idParam, requirePermission } from "../auth/authorize";
import { ipHash } from "../auth/ip";
import { requireSession } from "../auth/middleware";
import { type Action, can } from "../auth/permissions";
import type { AppEnv } from "../types";
import {
  CARD_COLUMNS,
  type CardRow,
  insertMentions,
  invalidReference,
  labelIdsOf,
  lastRankIn,
  loadCard,
  loadTaskAccess,
  loadTaskDetail,
  mentionsIn,
  type RefCheck,
  type TaskAccess,
  toCard,
  toPerson,
} from "./queries";
import { rankBetween } from "../../shared/rank";
import { type Notice, noticesStatements, statusChangeNotice } from "../notify";
import { refreshSearch, refreshSearchFor, removeFromSearch } from "./search";

// Tasks (TASK-1 to TASK-8, TASK-10, NFR-10, NFR-12). Every route checks the section 2 matrix in the API (NFR-1).

const projectIdParam = { projectId: (c: Context<AppEnv>) => idParam(c, "id") };

/** Finds the task inserted earlier in the same batch: the project's previous next_task_number. Binds ?1 = project id. */
const NEW_TASK_ID = `(SELECT id FROM tasks WHERE project_id = ?1 AND number = (SELECT next_task_number - 1 FROM projects WHERE id = ?1))`;

export function invalid(c: Context<AppEnv>, issues: unknown) {
  return c.json({ error: ACCESS_ERRORS.invalid, issues }, 400);
}

export function badReference(c: Context<AppEnv>, field: string) {
  return c.json({ error: TASK_ERRORS.invalidReference, field }, 400);
}

/** Loads the task named by :id (or `taskId`) and checks `action` on it. Returns the task or an error response. */
export async function guardTask(c: Context<AppEnv>, action: Action, taskId = idParam(c, "id")): Promise<TaskAccess | Response> {
  if (taskId === null) return forbidden(c, 404);
  const { user } = c.get("auth");
  const access = await loadTaskAccess(c.env, taskId, user.id);
  if (!access) return forbidden(c, 404);
  const resource = { task: { reporterId: access.task.reporter_id, createdAt: access.task.created_at } };
  if (!can(user, action, access.project, resource)) return forbidden(c, 403);
  return access;
}

/** Destructive actions need the confirmation dialog's header (section 11.14); checked after permissions. */
export function unconfirmed(c: Context<AppEnv>, confirmAction: string): Response | null {
  return c.req.header(CONFIRM_HEADER) === confirmAction ? null : c.json({ error: ACCESS_ERRORS.confirmationRequired }, 428);
}

/** NFR-10: the task as it is now, so the person can review the changes before saving theirs. */
async function conflict(c: Context<AppEnv>, taskId: number) {
  const task = await loadTaskDetail(c.env, taskId);
  if (!task) return forbidden(c, 404);
  return c.json({ error: TASK_ERRORS.conflict, task }, 409);
}

/** The update's version guard: a stale or deleted task sets version to NULL, which fails NOT NULL and rolls the batch back. */
const isVersionConflict = (err: unknown) => String(err).includes("NOT NULL constraint failed: tasks.version");

type EventRow = { field: string; old: string | null; new: string | null };
function eventsStatement(env: Env, taskId: number, actorId: number, now: number, events: EventRow[]) {
  return env.DB.prepare(
    `INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at)
     SELECT ?1, ?2, json_extract(e.value, '$.field'), json_extract(e.value, '$.old'), json_extract(e.value, '$.new'), ?3
     FROM json_each(?4) e`,
  ).bind(taskId, actorId, now, JSON.stringify(events));
}

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? null : String(v));

async function stateNameOf(env: Env, stateId: number): Promise<string | null> {
  const row = await env.DB.prepare("SELECT name FROM workflow_states WHERE id = ?1").bind(stateId).first<{ name: string }>();
  return row?.name ?? null;
}

export function taskRoutes() {
  const routes = new Hono<AppEnv>();

  // ---- Board (TASK-2, section 11.2): columns, cards and everything a card or filter refers to, in one batch.
  routes.get("/projects/:id/board", requireSession, requirePermission("task.view", projectIdParam), async (c) => {
    const project = c.get("project");
    const db = c.env.DB;
    const [states, tasks, labels, components, milestones, members, people] = await db.batch([
      db.prepare("SELECT id, name, category, position FROM workflow_states WHERE project_id = ?1 ORDER BY position").bind(project.id),
      db.prepare(
        `SELECT ${CARD_COLUMNS} FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.project_id = ?1 AND t.deleted_at IS NULL ORDER BY t.state_id, t.rank`,
      ).bind(project.id),
      db.prepare("SELECT id, name, colour FROM labels WHERE project_id = ?1 ORDER BY name COLLATE NOCASE").bind(project.id),
      db.prepare("SELECT id, name, lead_id FROM components WHERE project_id = ?1 ORDER BY name COLLATE NOCASE").bind(project.id),
      db.prepare(
        `SELECT id, name, target_date, released_at FROM milestones WHERE project_id = ?1
         ORDER BY target_date IS NULL, target_date, name COLLATE NOCASE`,
      ).bind(project.id),
      // Members who can be assigned or mentioned; on Hub Feedback that's the App Admins (PROJ-7).
      db.prepare(
        `SELECT u.id, u.name, u.avatar_url, m.role FROM project_members m JOIN users u ON u.id = m.user_id
         WHERE m.project_id = ?1 AND u.status = 'active' AND u.deleted_at IS NULL
         UNION
         SELECT u.id, u.name, u.avatar_url, 'admin' FROM users u
         WHERE ?2 = 1 AND u.app_role = 'admin' AND u.status = 'active' AND u.deleted_at IS NULL
         ORDER BY 2 COLLATE NOCASE`,
      ).bind(project.id, project.isSystem ? 1 : 0),
      db.prepare(
        `SELECT id, name, avatar_url FROM users WHERE id IN (
           SELECT assignee_id FROM tasks WHERE project_id = ?1 AND deleted_at IS NULL
           UNION SELECT secondary_assignee_id FROM tasks WHERE project_id = ?1 AND deleted_at IS NULL
           UNION SELECT reporter_id FROM tasks WHERE project_id = ?1 AND deleted_at IS NULL)`,
      ).bind(project.id),
    ]);
    const body: BoardResponse = {
      states: states!.results as BoardResponse["states"],
      tasks: (tasks!.results as CardRow[]).map(toCard),
      labels: labels!.results as BoardResponse["labels"],
      components: (components!.results as { id: number; name: string; lead_id: number | null }[]).map((r) => ({
        id: r.id,
        name: r.name,
        leadId: r.lead_id,
      })),
      milestones: (milestones!.results as { id: number; name: string; target_date: string | null; released_at: number | null }[]).map(
        (r) => ({ id: r.id, name: r.name, targetDate: r.target_date, released: r.released_at !== null }),
      ),
      members: (members!.results as { id: number; name: string; avatar_url: string | null; role: ProjectRole }[]).map((r) => ({
        ...toPerson(r),
        role: r.role,
      })),
      people: (people!.results as { id: number; name: string; avatar_url: string | null }[]).map(toPerson),
    };
    return c.json(body);
  });

  // ---- Create (TASK-1). The key number, task, labels, watchers, history, mentions and search row in one batch.
  routes.post("/projects/:id/tasks", requireSession, requirePermission("task.edit", projectIdParam), async (c) => {
    const parsed = createTaskBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const body = parsed.data;
    const project = c.get("project");
    const { user } = c.get("auth");
    const db = c.env.DB;

    let stateId = body.stateId;
    if (stateId === undefined) {
      const first = await db
        .prepare("SELECT id FROM workflow_states WHERE project_id = ?1 ORDER BY position LIMIT 1")
        .bind(project.id)
        .first<{ id: number }>();
      if (!first) return badReference(c, "stateId");
      stateId = first.id;
    }
    if (body.type === "epic" && body.epicId !== null) return badReference(c, "epicId");
    // v4.6: the secondary assignee is a different person from the assignee.
    if (body.secondaryAssigneeId !== null && body.secondaryAssigneeId === body.assigneeId) return badReference(c, "secondaryAssigneeId");
    const bad = await invalidReference(c.env, project, {
      stateId,
      assigneeId: body.assigneeId,
      secondaryAssigneeId: body.secondaryAssigneeId,
      labelIds: body.labelIds,
      componentId: body.componentId,
      milestoneId: body.milestoneId,
      epicId: body.epicId,
    });
    if (bad) return badReference(c, bad);

    const now = Date.now();
    const rank = rankBetween(await lastRankIn(c.env, project.id, stateId), null);
    const description: ParsedRichText = body.description ?? { doc: { type: "doc", content: [] }, text: "", mentions: [] };
    const results = await db.batch([
      db.prepare("UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = ?1").bind(project.id),
      db
        .prepare(
          `INSERT INTO tasks (project_id, number, title, description_json, description_text, type, state_id, priority, scope,
             assignee_id, reporter_id, due_date, epic_id, component_id, milestone_id, rank, created_at, updated_at, created_by,
             secondary_assignee_id)
           SELECT ?1, next_task_number - 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, ?10, ?17
           FROM projects WHERE id = ?1 RETURNING id`,
        )
        .bind(
          project.id,
          body.title,
          JSON.stringify(description.doc),
          description.text,
          body.type,
          stateId,
          body.priority,
          body.scope,
          body.assigneeId,
          user.id,
          body.dueDate,
          body.epicId,
          body.componentId,
          body.milestoneId,
          rank,
          now,
          body.secondaryAssigneeId,
        ),
      db.prepare(`INSERT INTO task_labels (task_id, label_id) SELECT ${NEW_TASK_ID}, value FROM json_each(?2)`).bind(
        project.id,
        JSON.stringify(body.labelIds),
      ),
      // TASK-8: the reporter and both assignees watch automatically.
      db.prepare(`INSERT OR IGNORE INTO watchers (task_id, user_id) SELECT ${NEW_TASK_ID}, value FROM json_each(?2)`).bind(
        project.id,
        JSON.stringify([user.id, body.assigneeId, body.secondaryAssigneeId].filter((id) => id !== null)),
      ),
      db.prepare(
        `INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at) SELECT ${NEW_TASK_ID}, ?2, 'created', NULL, ?3, ?4`,
      ).bind(project.id, user.id, String(stateId), now),
      insertMentions(c.env, {
        projectId: project.id,
        isSystem: project.isSystem,
        userIds: description.mentions,
        actorId: user.id,
        now,
        taskIdSql: NEW_TASK_ID,
      }),
      refreshSearchFor(c.env, NEW_TASK_ID, project.id),
      // NOTIF-1: the new assignee, and anyone @mentioned in the description.
      ...noticesStatements(
        c.env,
        [
          {
            type: "task.assigned",
            recipients: [body.assigneeId, body.secondaryAssigneeId].filter((id): id is number => id !== null),
            actorId: user.id,
            task: { newInProject: project.id },
            projectId: project.id,
            payload: {},
          },
          {
            type: "task.mentioned",
            recipients: description.mentions.filter((id) => id !== body.assigneeId && id !== body.secondaryAssigneeId),
            actorId: user.id,
            task: { newInProject: project.id },
            projectId: project.id,
            payload: {},
          },
        ],
        now,
      ),
    ]);
    const taskId = (results[1]!.results as { id: number }[])[0]!.id;
    return c.json({ task: await loadTaskDetail(c.env, taskId) }, 201);
  });

  // ---- Task detail (section 11.3), by id or by key (MEDIA-42).
  routes.get("/tasks/by-key/:key", requireSession, async (c) => {
    const key = parseTaskKey(c.req.param("key"));
    if (!key) return forbidden(c, 404);
    const row = await c.env.DB.prepare(
      `SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE p.key = ?1 AND t.number = ?2 AND t.deleted_at IS NULL AND p.deleted_at IS NULL`,
    )
      .bind(key.projectKey, key.number)
      .first<{ id: number }>();
    if (!row) return forbidden(c, 404);
    const access = await guardTask(c, "task.view", row.id);
    if (access instanceof Response) return access;
    return c.json({ task: await loadTaskDetail(c.env, row.id, c.get("auth").user.id) });
  });

  routes.get("/tasks/:id", requireSession, async (c) => {
    const access = await guardTask(c, "task.view");
    if (access instanceof Response) return access;
    return c.json({ task: await loadTaskDetail(c.env, access.task.id, c.get("auth").user.id) });
  });

  // ---- Inline edit (section 11.3) with optimistic concurrency (NFR-10).
  routes.patch("/tasks/:id", requireSession, async (c) => {
    const access = await guardTask(c, "task.edit");
    if (access instanceof Response) return access;
    const parsed = updateTaskBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { version, ...body } = parsed.data;
    const { task, project } = access;
    if (version !== task.version) return conflict(c, task.id);

    // Only fields that actually change are written and recorded in history.
    const events: EventRow[] = [];
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = ?${values.length + 3}`);
    };
    const refs: RefCheck = { selfId: task.id };
    const simple = [
      ["title", "title", task.title],
      ["type", "type", task.type],
      ["priority", "priority", task.priority],
      ["scope", "scope", task.scope],
      ["dueDate", "due_date", task.due_date],
    ] as const;
    for (const [field, column, current] of simple) {
      const next = body[field];
      if (next === undefined || next === current) continue;
      set(column, next);
      events.push({ field: column === "due_date" ? "due_date" : field, old: str(current), new: str(next) });
    }
    const refFields = [
      ["stateId", "state_id", "state", task.state_id],
      ["assigneeId", "assignee_id", "assignee", task.assignee_id],
      ["secondaryAssigneeId", "secondary_assignee_id", "secondary_assignee", task.secondary_assignee_id],
      ["componentId", "component_id", "component", task.component_id],
      ["epicId", "epic_id", "epic", task.epic_id],
      ["milestoneId", "milestone_id", "milestone", task.milestone_id],
    ] as const;
    // v4.6: the two assignees are different people. Making the secondary assignee the assignee moves them up and
    // clears the secondary slot; naming the assignee as secondary is refused.
    if (body.secondaryAssigneeId !== undefined && body.secondaryAssigneeId !== null) {
      const nextAssignee = body.assigneeId === undefined ? task.assignee_id : body.assigneeId;
      if (body.secondaryAssigneeId === nextAssignee) return badReference(c, "secondaryAssigneeId");
    } else if (body.secondaryAssigneeId === undefined && body.assigneeId != null && body.assigneeId === task.secondary_assignee_id) {
      body.secondaryAssigneeId = null;
    }
    for (const [field, column, eventField, current] of refFields) {
      const next = body[field];
      if (next === undefined || next === current) continue;
      refs[field] = next as never;
      set(column, next);
      events.push({ field: eventField, old: str(current), new: str(next) });
    }
    if (refs.stateId !== undefined) set("rank", rankBetween(await lastRankIn(c.env, project.id, refs.stateId), null));

    const currentLabels = labelIdsOf(task);
    const nextLabels = body.labelIds ? [...body.labelIds].sort((a, b) => a - b) : undefined;
    const labelsChanged = nextLabels !== undefined && nextLabels.join(",") !== currentLabels.join(",");
    if (labelsChanged) {
      refs.labelIds = nextLabels;
      events.push({ field: "labels", old: currentLabels.join(",") || null, new: nextLabels.join(",") || null });
    }

    const description = body.description;
    const descriptionChanged = description !== undefined && JSON.stringify(description.doc) !== task.description_json;
    if (descriptionChanged) {
      set("description_json", JSON.stringify(description.doc));
      set("description_text", description.text);
      events.push({ field: "description", old: null, new: null });
    }

    if (events.length === 0) return c.json({ task: await loadTaskDetail(c.env, task.id) });

    const nextType = body.type ?? task.type;
    const nextEpic = body.epicId === undefined ? task.epic_id : body.epicId;
    if (nextType === "epic" && nextEpic !== null) return badReference(c, "epicId");
    const bad = await invalidReference(c.env, project, refs);
    if (bad) return badReference(c, bad);

    const { user } = c.get("auth");
    const now = Date.now();
    const db = c.env.DB;
    const statements = [
      db
        .prepare(
          `UPDATE tasks SET ${[...sets, "updated_at = ?2", "version = CASE WHEN version = ?3 AND deleted_at IS NULL THEN version + 1 END"].join(", ")}
           WHERE id = ?1`,
        )
        .bind(task.id, now, version, ...values),
      eventsStatement(c.env, task.id, user.id, now, events),
    ];
    if (labelsChanged) {
      statements.push(
        db.prepare("DELETE FROM task_labels WHERE task_id = ?1").bind(task.id),
        db.prepare("INSERT INTO task_labels (task_id, label_id) SELECT ?1, value FROM json_each(?2)").bind(task.id, JSON.stringify(nextLabels)),
      );
    }
    for (const watcher of [refs.assigneeId, refs.secondaryAssigneeId]) {
      if (watcher) statements.push(db.prepare("INSERT OR IGNORE INTO watchers (task_id, user_id) VALUES (?1, ?2)").bind(task.id, watcher));
    }
    if (descriptionChanged) {
      const before = mentionsIn(JSON.parse(task.description_json));
      const added = description.mentions.filter((id) => !before.has(id));
      if (added.length > 0) {
        statements.push(
          insertMentions(c.env, { projectId: project.id, isSystem: project.isSystem, userIds: added, actorId: user.id, now, taskIdSql: "?6", taskId: task.id }),
        );
      }
    }
    if (descriptionChanged || body.title !== undefined) statements.push(refreshSearch(c.env, task.id));

    // NOTIF-1: assigned, status change on the reporter's task, new @mentions in the description.
    const notices: Notice[] = [];
    const newlyAssigned = [refs.assigneeId, refs.secondaryAssigneeId].filter((id): id is number => !!id);
    if (newlyAssigned.length) notices.push({ type: "task.assigned", recipients: newlyAssigned, actorId: user.id, task: { id: task.id }, projectId: project.id, payload: {} });
    if (refs.stateId !== undefined) {
      notices.push(
        statusChangeNotice(project, {
          recipients: [task.reporter_id],
          actorId: user.id,
          task: { id: task.id },
          payload: { stateName: (await stateNameOf(c.env, refs.stateId)) ?? undefined },
        }),
      );
    }
    if (descriptionChanged) {
      const before = mentionsIn(JSON.parse(task.description_json));
      const added = description.mentions.filter((id) => !before.has(id));
      notices.push({ type: "task.mentioned", recipients: added, actorId: user.id, task: { id: task.id }, projectId: project.id, payload: {} });
    }
    statements.push(...noticesStatements(c.env, notices, now));

    try {
      await db.batch(statements);
    } catch (err) {
      if (isVersionConflict(err)) return conflict(c, task.id);
      throw err;
    }
    return c.json({ task: await loadTaskDetail(c.env, task.id) });
  });

  // ---- Board move (TASK-2, NFR-12): the client moves the card first and rolls back if this fails.
  routes.post("/tasks/:id/move", requireSession, async (c) => {
    const access = await guardTask(c, "task.edit");
    if (access instanceof Response) return access;
    const parsed = moveTaskBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const { stateId, afterId, beforeId } = parsed.data;
    const { task, project } = access;
    if (await invalidReference(c.env, project, { stateId })) return badReference(c, "stateId");

    // Neighbours count only if they're live cards in the target column.
    const neighbours = new Map<number, string>();
    const ids = [afterId, beforeId].filter((id): id is number => id !== null && id !== task.id);
    if (ids.length > 0) {
      const { results } = await c.env.DB.prepare(
        `SELECT id, rank FROM tasks WHERE id IN (SELECT value FROM json_each(?1)) AND project_id = ?2 AND state_id = ?3 AND deleted_at IS NULL`,
      )
        .bind(JSON.stringify(ids), project.id, stateId)
        .all<{ id: number; rank: string }>();
      for (const r of results) neighbours.set(r.id, r.rank);
    }
    let after = afterId !== null ? (neighbours.get(afterId) ?? null) : null;
    const before = beforeId !== null ? (neighbours.get(beforeId) ?? null) : null;
    // No usable neighbours: the bottom of the column.
    if (after === null && before === null) after = await lastRankIn(c.env, project.id, stateId);
    const rank = rankBetween(after, before);

    const { user } = c.get("auth");
    const now = Date.now();
    const db = c.env.DB;
    const statements = [
      db
        .prepare("UPDATE tasks SET state_id = ?2, rank = ?3, updated_at = ?4, version = version + 1 WHERE id = ?1 AND deleted_at IS NULL")
        .bind(task.id, stateId, rank, now),
    ];
    if (stateId !== task.state_id) {
      statements.push(
        eventsStatement(c.env, task.id, user.id, now, [{ field: "state", old: String(task.state_id), new: String(stateId) }]),
        ...noticesStatements(
          c.env,
          [
            statusChangeNotice(project, {
              recipients: [task.reporter_id],
              actorId: user.id,
              task: { id: task.id },
              payload: { stateName: (await stateNameOf(c.env, stateId)) ?? undefined },
            }),
          ],
          now,
        ),
      );
    }
    await db.batch(statements);
    return c.json({ task: (await loadCard(c.env, task.id)) as TaskCard });
  });

  // ---- Delete (section 2: Contributors only their own, within 24 hours). Soft delete, audited (section 11.14).
  routes.delete("/tasks/:id", requireSession, async (c) => {
    const access = await guardTask(c, "task.delete");
    if (access instanceof Response) return access;
    const notConfirmed = unconfirmed(c, TASK_CONFIRM.deleteTask);
    if (notConfirmed) return notConfirmed;
    const { task } = access;
    const { user } = c.get("auth");
    const now = Date.now();
    const key = `${task.project_key}-${task.number}`;
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE tasks SET deleted_at = ?2, updated_at = ?2, version = version + 1 WHERE id = ?1").bind(task.id, now),
      eventsStatement(c.env, task.id, user.id, now, [{ field: "deleted", old: null, new: null }]),
      removeFromSearch(c.env, task.id),
      auditStatement(
        c.env,
        { actorId: user.id, action: AUDIT.taskDeleted, targetType: "task", targetId: task.id, detail: { key, title: task.title }, ipHash: await ipHash(c) },
        now,
      ),
    ]);
    return c.json({ ok: true });
  });

  // ---- Watchers (TASK-8): anyone who can see the task can follow it.
  routes.put("/tasks/:id/watch", requireSession, async (c) => {
    const access = await guardTask(c, "task.view");
    if (access instanceof Response) return access;
    await c.env.DB.prepare("INSERT OR IGNORE INTO watchers (task_id, user_id) VALUES (?1, ?2)").bind(access.task.id, c.get("auth").user.id).run();
    return c.json({ watching: true });
  });
  routes.delete("/tasks/:id/watch", requireSession, async (c) => {
    const access = await guardTask(c, "task.view");
    if (access instanceof Response) return access;
    await c.env.DB.prepare("DELETE FROM watchers WHERE task_id = ?1 AND user_id = ?2").bind(access.task.id, c.get("auth").user.id).run();
    return c.json({ watching: false });
  });

  // ---- Bulk edit (TASK-10): assignee, status, labels or due date for up to 100 tasks, one batch.
  routes.post("/projects/:id/tasks/bulk", requireSession, requirePermission("task.edit", projectIdParam), async (c) => {
    const parsed = bulkEditBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const body = parsed.data;
    const project = c.get("project");
    const db = c.env.DB;
    const { results: rows } = await db
      .prepare(
        `SELECT ${CARD_COLUMNS} FROM tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.id IN (SELECT value FROM json_each(?1)) AND t.project_id = ?2 AND t.deleted_at IS NULL`,
      )
      .bind(JSON.stringify(body.taskIds), project.id)
      .all<CardRow>();
    if (rows.length !== body.taskIds.length) return badReference(c, "taskIds");
    const addLabels = body.addLabelIds ?? [];
    const removeLabels = body.removeLabelIds ?? [];
    const bad = await invalidReference(c.env, project, {
      stateId: body.stateId,
      assigneeId: body.assigneeId ?? null,
      labelIds: [...new Set([...addLabels, ...removeLabels])],
    });
    if (bad) return badReference(c, bad);

    const { user } = c.get("auth");
    const now = Date.now();
    const events: { task: number; field: string; old: string | null; new: string | null }[] = [];
    for (const t of rows) {
      if (body.assigneeId !== undefined && body.assigneeId !== t.assignee_id) {
        events.push({ task: t.id, field: "assignee", old: str(t.assignee_id), new: str(body.assigneeId) });
        if (body.assigneeId !== null && body.assigneeId === t.secondary_assignee_id) {
          events.push({ task: t.id, field: "secondary_assignee", old: str(t.secondary_assignee_id), new: null });
        }
      }
      if (body.stateId !== undefined && body.stateId !== t.state_id) {
        events.push({ task: t.id, field: "state", old: str(t.state_id), new: str(body.stateId) });
      }
      if (body.dueDate !== undefined && body.dueDate !== t.due_date) {
        events.push({ task: t.id, field: "due_date", old: t.due_date, new: body.dueDate });
      }
      if (addLabels.length || removeLabels.length) {
        const before = labelIdsOf(t);
        const after = [...new Set([...before.filter((id) => !removeLabels.includes(id)), ...addLabels])].sort((a, b) => a - b);
        if (after.join(",") !== before.join(",")) {
          events.push({ task: t.id, field: "labels", old: before.join(",") || null, new: after.join(",") || null });
        }
      }
    }
    if (events.length === 0) return c.json({ updated: 0 });

    const changed = JSON.stringify([...new Set(events.map((e) => e.task))]);
    const sets = ["updated_at = ?2", "version = version + 1"];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = ?${values.length + 2}`);
    };
    if (body.assigneeId !== undefined) {
      set("assignee_id", body.assigneeId);
      // v4.6: the new assignee can't also be the secondary assignee.
      if (body.assigneeId !== null) sets.push(`secondary_assignee_id = CASE WHEN secondary_assignee_id = ?${values.length + 2} THEN NULL ELSE secondary_assignee_id END`);
    }
    if (body.stateId !== undefined) set("state_id", body.stateId);
    if (body.dueDate !== undefined) set("due_date", body.dueDate);
    const statements = [
      db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id IN (SELECT value FROM json_each(?1))`).bind(changed, now, ...values),
      db
        .prepare(
          `INSERT INTO task_events (task_id, actor_id, field, old_value, new_value, at)
           SELECT json_extract(e.value, '$.task'), ?1, json_extract(e.value, '$.field'), json_extract(e.value, '$.old'),
                  json_extract(e.value, '$.new'), ?2 FROM json_each(?3) e`,
        )
        .bind(user.id, now, JSON.stringify(events)),
    ];
    if (removeLabels.length) {
      statements.push(
        db
          .prepare("DELETE FROM task_labels WHERE task_id IN (SELECT value FROM json_each(?1)) AND label_id IN (SELECT value FROM json_each(?2))")
          .bind(changed, JSON.stringify(removeLabels)),
      );
    }
    if (addLabels.length) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO task_labels (task_id, label_id)
             SELECT t.value, l.value FROM json_each(?1) t, json_each(?2) l
             WHERE (SELECT count(*) FROM task_labels WHERE task_id = t.value) < ?3`,
          )
          .bind(changed, JSON.stringify(addLabels), 10),
      );
    }
    if (body.assigneeId) {
      statements.push(
        db.prepare("INSERT OR IGNORE INTO watchers (task_id, user_id) SELECT value, ?2 FROM json_each(?1)").bind(changed, body.assigneeId),
      );
    }
    // NOTIF-1 per task: the new assignee, and each reporter whose task changed status.
    const reporterOf = new Map(rows.map((r) => [r.id, r.reporter_id]));
    const stateName = body.stateId !== undefined ? ((await stateNameOf(c.env, body.stateId)) ?? undefined) : undefined;
    const bulkNotices: Notice[] = events.flatMap((e): Notice[] => {
      const base = { actorId: user.id, task: { id: e.task }, projectId: project.id };
      if (e.field === "assignee" && body.assigneeId) return [{ ...base, type: "task.assigned", recipients: [body.assigneeId], payload: {} }];
      if (e.field === "state") return [statusChangeNotice(project, { actorId: user.id, task: { id: e.task }, recipients: [reporterOf.get(e.task)!], payload: { stateName } })];
      return [];
    });
    statements.push(...noticesStatements(c.env, bulkNotices, now));
    await db.batch(statements);
    return c.json({ updated: JSON.parse(changed).length });
  });

  return routes;
}

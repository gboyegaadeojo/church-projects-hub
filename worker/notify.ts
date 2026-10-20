import { NOTIFICATION_EVENTS, type NotificationPayload, type NotificationType } from "../shared/notifications";

// Turning an event into notifications (NOTIF-4) — and, from Stage 5b, email_outbox rows — as statements that go
// in the same batch as the change itself, so a committed change always has its notifications and a failed one
// never does (section 8, rule 1).
//
// Rules for every event: the actor never notifies themselves (section 8, rule 5); suspended and deleted people
// get nothing (Pending people do: they need to hear about their request); and when a project is named, only
// people who can see it (members, or App Admins).

export type Notice = {
  type: NotificationType;
  recipients: number[];
  actorId: number | null;
  /** An existing task, or the task inserted earlier in the same batch for a project ({ newInProject }). */
  task?: { id: number } | { newInProject: number } | null;
  /** Limits recipients to people who can see this project. */
  projectId?: number;
  payload: NotificationPayload;
  /**
   * SQL that must be true for the notice to be written, e.g. "changes() = 1" straight after the update that
   * records a decision, so only the batch that won a race notifies. Never built from user input.
   */
  onlyIf?: string;
};

const NEW_TASK = "(SELECT id FROM tasks WHERE project_id = ?6 AND number = (SELECT next_task_number - 1 FROM projects WHERE id = ?6))";

export function noticeStatements(env: Pick<Env, "DB">, notice: Notice, now: number = Date.now()): D1PreparedStatement[] {
  const recipients = [...new Set(notice.recipients)].filter((id) => id !== notice.actorId);
  if (recipients.length === 0 || !NOTIFICATION_EVENTS[notice.type].bell) return [];
  const task = notice.task ?? null;
  const taskSql = task === null ? "NULL" : "id" in task ? "?6" : NEW_TASK;
  const taskBind = task === null ? null : "id" in task ? task.id : task.newInProject;
  const canSee =
    (notice.projectId === undefined
      ? ""
      : `AND (u.app_role = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ?7 AND m.user_id = u.id))`) +
    (notice.onlyIf ? ` AND ${notice.onlyIf}` : "");
  // With a task, its key, title and project come from the row itself, so a task created in the same batch
  // gets its real key (MEDIA-42) without guessing the number.
  const sql =
    taskSql === "NULL"
      ? `INSERT INTO notifications (user_id, type, actor_id, task_id, payload_json, created_at)
         SELECT u.id, ?1, ?2, NULL, ?3, ?4 FROM users u
         WHERE u.id IN (SELECT value FROM json_each(?5)) AND u.status != 'suspended' AND u.deleted_at IS NULL ${canSee}`
      : `INSERT INTO notifications (user_id, type, actor_id, task_id, payload_json, created_at)
         SELECT u.id, ?1, ?2, t.id,
                json_patch(?3, json_object('taskKey', p.key || '-' || t.number, 'taskTitle', t.title, 'projectKey', p.key, 'projectName', p.name)), ?4
         FROM users u, tasks t JOIN projects p ON p.id = t.project_id
         WHERE t.id = ${taskSql} AND u.id IN (SELECT value FROM json_each(?5)) AND u.status != 'suspended' AND u.deleted_at IS NULL ${canSee}`;
  const binds: unknown[] = [notice.type, notice.actorId, JSON.stringify(notice.payload), now, JSON.stringify(recipients)];
  // D1 rejects unused parameters, so ?6 and ?7 are bound only when the SQL uses them.
  if (taskSql !== "NULL" || notice.projectId !== undefined) binds.push(taskBind);
  if (notice.projectId !== undefined) binds.push(notice.projectId);
  return [env.DB.prepare(sql).bind(...binds)];
}

/** Statements for several notices. */
export function noticesStatements(env: Pick<Env, "DB">, notices: Notice[], now: number = Date.now()): D1PreparedStatement[] {
  return notices.flatMap((n) => noticeStatements(env, n, now));
}

/** The people who decide a project's access requests: its active Project Admins, or every active App Admin. */
export async function requestDeciders(env: Pick<Env, "DB">, projectId: number): Promise<number[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM project_members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = ?1 AND m.role = 'admin' AND u.status = 'active'`,
  )
    .bind(projectId)
    .all<{ id: number }>();
  if (results.length > 0) return results.map((r) => r.id);
  const { results: admins } = await env.DB.prepare("SELECT id FROM users WHERE app_role = 'admin' AND status = 'active'").all<{ id: number }>();
  return admins.map((r) => r.id);
}

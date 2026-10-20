import { NOTIFICATION_EVENTS, type NotificationPayload, type NotificationType } from "../shared/notifications";

// Turning an event into notifications (NOTIF-4) and email_outbox rows (section 8) as statements that go in the
// same batch as the change itself, so a committed change always has its notifications and emails queued and a
// failed one never does (section 8, rule 1).
//
// Rules for every event: the actor never notifies themselves (section 8, rule 5); suspended and deleted people
// get nothing (Pending people do: they need to hear about their request); and when a project is named, only
// people who can see it (members, or App Admins). Email follows each person's preference (NOTIF-5): instant,
// digest or off, defaulting to the event's mode in shared/notifications.ts.

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
   * SQL that must be true for the notice to be written. Never built from user input. "changes() = 1" straight
   * after the update that records a decision lets only the batch that won a race notify — but only with one
   * recipient: the bell insert runs first and changes() then counts its rows.
   */
  onlyIf?: string;
  /** Section 8, rule 4: a key that makes a repeated email impossible (the recipient's id is appended). */
  dedupeKey?: string;
};

const NEW_TASK = "(SELECT id FROM tasks WHERE project_id = ?6 AND number = (SELECT next_task_number - 1 FROM projects WHERE id = ?6))";

/**
 * Both statements share one parameter list:
 * ?1 type, ?2 actor, ?3 payload, ?4 now, ?5 recipients, ?6 task id or project id, ?7 project id,
 * ?8 default email mode, ?9 dedupe key.
 */
function parts(notice: Notice) {
  const task = notice.task ?? null;
  const taskSql = task === null ? null : "id" in task ? "?6" : NEW_TASK;
  const where = [
    "u.id IN (SELECT value FROM json_each(?5))",
    "u.status != 'suspended'",
    "u.deleted_at IS NULL",
    ...(notice.projectId === undefined
      ? []
      : ["(u.app_role = 'admin' OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ?7 AND m.user_id = u.id))"]),
    ...(taskSql ? [`t.id = ${taskSql}`] : []),
    ...(notice.onlyIf ? [notice.onlyIf] : []),
  ].join(" AND ");
  // With a task, its key, title and project come from the row itself, so a task created in the same batch gets
  // its real key (MEDIA-42) without guessing the number.
  const from = taskSql ? "users u, tasks t JOIN projects p ON p.id = t.project_id" : "users u";
  const payload = taskSql
    ? "json_patch(?3, json_object('taskKey', p.key || '-' || t.number, 'taskTitle', t.title, 'projectKey', p.key, 'projectName', p.name, 'dueDate', t.due_date))"
    : "?3";
  return { taskSql, where, from, payload, taskBind: task === null ? null : "id" in task ? task.id : task.newInProject };
}

export function noticeStatements(env: Pick<Env, "DB">, notice: Notice, now: number = Date.now()): D1PreparedStatement[] {
  const recipients = [...new Set(notice.recipients)].filter((id) => id !== notice.actorId);
  if (recipients.length === 0) return [];
  const event = NOTIFICATION_EVENTS[notice.type];
  const { taskSql, where, from, payload, taskBind } = parts(notice);
  const binds = [
    notice.type,
    notice.actorId,
    JSON.stringify(notice.payload),
    now,
    JSON.stringify(recipients),
    taskBind,
    notice.projectId ?? null,
    event.email,
    notice.dedupeKey ?? null,
  ];
  const statements: D1PreparedStatement[] = [];
  if (event.bell) {
    statements.push(
      prepare(
        env,
        `INSERT INTO notifications (user_id, type, actor_id, task_id, payload_json, created_at)
         SELECT u.id, ?1, ?2, ${taskSql ? "t.id" : "NULL"}, ${payload}, ?4 FROM ${from} WHERE ${where}`,
        binds,
      ),
    );
  }
  // Email: the person's own setting for this event, else its default; nothing when it's off. The actor's name
  // goes into the payload for the email's first line.
  statements.push(
    prepare(
      env,
      `INSERT OR IGNORE INTO email_outbox (user_id, template, payload_json, dedupe_key, mode, send_after, created_at)
       SELECT x.id, ?1, x.payload, CASE WHEN ?9 IS NULL THEN NULL ELSE ?9 || ':' || x.id END, x.mode, ?4, ?4
       FROM (
         SELECT u.id,
                json_patch(${payload}, json_object('actorName', (SELECT name FROM users WHERE id = ?2))) AS payload,
                coalesce((SELECT np.mode FROM notification_prefs np WHERE np.user_id = u.id AND np.event_type = ?1 AND np.channel = 'email'), ?8) AS mode
         FROM ${from} WHERE ${where}
       ) x
       WHERE x.mode != 'off'`,
      binds,
    ),
  );
  return statements;
}

/** D1 wants exactly as many values as the highest ?N the statement uses. */
function prepare(env: Pick<Env, "DB">, sql: string, binds: unknown[]): D1PreparedStatement {
  const highest = Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
  return env.DB.prepare(sql).bind(...binds.slice(0, highest));
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

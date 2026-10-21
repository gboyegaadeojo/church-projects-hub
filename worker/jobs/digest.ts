import { NOTIFICATION_EVENTS } from "../../shared/notifications";
import { todayIn } from "../../shared/tasks";
import { DEFAULT_TIMEZONE, localHour } from "../lib/time";

// The morning digest and due-date reminders (section 8, NOTIF-2, NOTIF-5).

export const DIGEST_HOUR = 7;

/**
 * Section 8 rule 3, hourly: for everyone whose local time is 7 am, gather their pending digest rows into one
 * "digest" row that the regular sender then delivers (with its retries). The digest row lists the ids it took,
 * and only those are marked digested, in the same batch — so a row queued a moment later waits for tomorrow
 * rather than being lost. The dedupe key makes it one digest per person per day, even if the hour reruns.
 */
export async function queueDigests(env: Pick<Env, "DB">, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT u.timezone FROM email_outbox o JOIN users u ON u.id = o.user_id
     WHERE o.status = 'pending' AND o.mode = 'digest' AND o.send_after <= ?1`,
  )
    .bind(now)
    .all<{ timezone: string }>();
  const zones = results.map((r) => r.timezone).filter((tz) => localHour(now, tz) === DIGEST_HOUR);
  if (zones.length === 0) return 0;

  const day = new Date(now).toISOString().slice(0, 10);
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO email_outbox (user_id, template, payload_json, dedupe_key, mode, send_after, created_at)
       SELECT o.user_id, 'digest',
              json_object('ids', json_group_array(o.id), 'items', json_group_array(json_object('template', o.template, 'payload', json(o.payload_json)))),
              'digest:' || o.user_id || ':' || ?3, 'instant', ?1, ?1
       FROM (SELECT o.* FROM email_outbox o JOIN users u ON u.id = o.user_id
             WHERE o.status = 'pending' AND o.mode = 'digest' AND o.send_after <= ?1
               AND u.timezone IN (SELECT value FROM json_each(?2))
             ORDER BY o.id) o
       GROUP BY o.user_id`,
    ).bind(now, JSON.stringify(zones), day),
    env.DB.prepare(
      `UPDATE email_outbox SET status = 'digested', sent_at = ?1
       WHERE id IN (SELECT j.value FROM email_outbox d, json_each(d.payload_json, '$.ids') j
                    WHERE d.template = 'digest' AND d.created_at = ?1 AND d.dedupe_key LIKE 'digest:%:' || ?2)`,
    ).bind(now, day),
  ]);
  return inserted!.meta.changes;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/**
 * NOTIF-2 and the section 8 table, from the daily job: due in 7 days and due tomorrow to the assignee; overdue
 * (once, the day after the due date) to the assignee and the project's admins. Dates are the church's calendar
 * day (Winnipeg). "Assignee" includes the secondary assignee (v4.6). Open tasks only, in projects that aren't archived. Email follows each person's preference
 * and carries a dedupe key per task, date and person (rule 4); the bell gets overdue notices once.
 */
export function dueReminderStatements(env: Pick<Env, "DB">, now: number): D1PreparedStatement[] {
  const today = todayIn(DEFAULT_TIMEZONE, now);
  const kinds = [
    { type: "task.due_soon", date: addDays(today, 7), admins: false, key: "due7" },
    { type: "task.due_tomorrow", date: addDays(today, 1), admins: false, key: "due1" },
    { type: "task.overdue", date: addDays(today, -1), admins: true, key: "overdue" },
  ] as const;
  const statements: D1PreparedStatement[] = [];
  for (const kind of kinds) {
    const event = NOTIFICATION_EVENTS[kind.type];
    // ?1 type, ?2 due date, ?3 include project admins, ?4 now, ?5 default email mode, ?6 dedupe prefix.
    const recipients = `
      WITH due AS (
        SELECT t.id AS task_id, t.project_id,
               json_object('taskKey', p.key || '-' || t.number, 'taskTitle', t.title, 'projectKey', p.key,
                           'projectName', p.name, 'dueDate', t.due_date) AS payload,
               p.key || '-' || t.number AS task_key, t.assignee_id, t.secondary_assignee_id
        FROM tasks t JOIN projects p ON p.id = t.project_id JOIN workflow_states s ON s.id = t.state_id
        WHERE t.due_date = ?2 AND t.deleted_at IS NULL AND p.archived_at IS NULL AND s.category != 'done'
      ),
      r AS (
        SELECT task_id, project_id, payload, task_key, assignee_id AS user_id FROM due WHERE assignee_id IS NOT NULL
        UNION
        SELECT task_id, project_id, payload, task_key, secondary_assignee_id FROM due WHERE secondary_assignee_id IS NOT NULL
        UNION
        SELECT d.task_id, d.project_id, d.payload, d.task_key, m.user_id FROM due d
        JOIN project_members m ON m.project_id = d.project_id AND m.role = 'admin' WHERE ?3 = 1
      ),
      x AS (SELECT r.* FROM r JOIN users u ON u.id = r.user_id WHERE u.status = 'active' AND u.deleted_at IS NULL)`;
    const binds = [kind.type, kind.date, kind.admins ? 1 : 0, now, event.email, kind.key];
    statements.push(
      env.DB.prepare(
        `${recipients}
         INSERT OR IGNORE INTO email_outbox (user_id, template, payload_json, dedupe_key, mode, send_after, created_at)
         SELECT user_id, ?1, payload, ?6 || ':' || task_key || ':' || ?2 || ':' || user_id, mode, ?4, ?4
         FROM (SELECT x.*, coalesce((SELECT np.mode FROM notification_prefs np
                                     WHERE np.user_id = x.user_id AND np.event_type = ?1 AND np.channel = 'email'), ?5) AS mode FROM x)
         WHERE mode != 'off'`,
      ).bind(...binds),
    );
    if (event.bell) {
      statements.push(
        env.DB.prepare(
          `${recipients}
           INSERT INTO notifications (user_id, type, actor_id, task_id, payload_json, created_at)
           SELECT x.user_id, ?1, NULL, x.task_id, x.payload, ?4 FROM x
           WHERE NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = x.user_id AND n.type = ?1 AND n.task_id = x.task_id
                             AND json_extract(n.payload_json, '$.dueDate') = ?2)`,
        ).bind(...binds.slice(0, 4)),
      );
    }
  }
  return statements;
}

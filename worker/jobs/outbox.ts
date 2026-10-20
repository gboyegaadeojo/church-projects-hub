import { type DigestItem, renderDigest, renderEmail, type EmailTemplate } from "../email/templates";
import { type EmailSender, unsubscribeUrls } from "../email/sender";

// Sends due instant emails (section 8 "Sending mechanics"), every 5 minutes from the cron dispatcher.
// - Failures retry after 5, 30 and 120 minutes, then park as failed (visible to admins in Stage 6).
// - A failed email never undoes or blocks the action that queued it (NFR-9): the action committed already.
// - Cap protection: past 6 instant emails for a person today, or 80 for everyone today (80% of Resend's free 100),
//   instant emails move into that person's next digest — except access-request emails, which stay instant.
// - At most BATCH emails per run, to stay inside the Worker's CPU and subrequest limits (NFR-22).

export const RETRY_AFTER_MIN = [5, 30, 120] as const;
export const PER_PERSON_DAILY = 6;
export const DAILY_SWITCH_TO_DIGEST = 80;
const BATCH = 20;
const ALWAYS_INSTANT = new Set<string>(["access.requested", "access.decided", "access.nudge", "access.reminder", "invite", "digest"]);

type Row = {
  id: number;
  user_id: number | null;
  to_email: string | null;
  template: string;
  payload_json: string;
  attempts: number;
  email: string | null;
  user_status: string | null;
  deleted_at: number | null;
};

const startOfUtcDay = (now: number) => now - (now % 86_400_000);

export async function sendDueEmails(
  env: Pick<Env, "DB" | "APP_BASE_URL" | "SESSION_SECRET">,
  sender: EmailSender | null,
  now: number = Date.now(),
): Promise<{ sent: number; failed: number; digested: number }> {
  const result = { sent: 0, failed: 0, digested: 0 };
  // No provider configured yet: leave everything pending, without spending attempts.
  if (!sender) return result;

  const { results: rows } = await env.DB.prepare(
    `SELECT o.id, o.user_id, o.to_email, o.template, o.payload_json, o.attempts,
            u.email, u.status AS user_status, u.deleted_at
     FROM email_outbox o LEFT JOIN users u ON u.id = o.user_id
     WHERE o.status = 'pending' AND o.mode = 'instant' AND o.send_after <= ?1
     ORDER BY o.id LIMIT ?2`,
  )
    .bind(now, BATCH)
    .all<Row>();
  if (rows.length === 0) return result;

  const dayStart = startOfUtcDay(now);
  const counts = await env.DB.prepare(
    `SELECT user_id, count(*) AS n FROM email_outbox WHERE status = 'sent' AND sent_at >= ?1 GROUP BY user_id`,
  )
    .bind(dayStart)
    .all<{ user_id: number | null; n: number }>();
  const perPerson = new Map<number | null, number>();
  let total = 0;
  for (const c of counts.results) {
    perPerson.set(c.user_id, c.n);
    total += c.n;
  }

  const settings = `${env.APP_BASE_URL}/settings/notifications`;
  // Invites go to someone who isn't a user yet, so they have no settings to unsubscribe from.
  const links = async (userId: number | null, template: string) =>
    userId === null || template === "invite"
      ? { base: env.APP_BASE_URL, settings, unsubscribe: null, oneClick: null }
      : { base: env.APP_BASE_URL, settings, ...(await unsubscribeUrls(env, userId, template)) };

  for (const row of rows) {
    const to = row.to_email ?? row.email;
    if (!to || (row.user_id !== null && (row.user_status === "suspended" || row.deleted_at !== null))) {
      await env.DB.prepare("UPDATE email_outbox SET status = 'failed', last_error = ?2 WHERE id = ?1").bind(row.id, "No recipient").run();
      result.failed += 1;
      continue;
    }
    const mine = perPerson.get(row.user_id) ?? 0;
    if (!ALWAYS_INSTANT.has(row.template) && row.user_id !== null && (mine >= PER_PERSON_DAILY || total >= DAILY_SWITCH_TO_DIGEST)) {
      await env.DB.prepare("UPDATE email_outbox SET mode = 'digest' WHERE id = ?1").bind(row.id).run();
      result.digested += 1;
      continue;
    }
    try {
      const l = await links(row.user_id, row.template);
      const payload = JSON.parse(row.payload_json);
      const rendered =
        row.template === "digest" ? renderDigest((payload as { items: DigestItem[] }).items, l) : renderEmail(row.template as EmailTemplate, payload, l);
      await sender.send({ to, ...rendered, unsubscribeUrl: l.oneClick });
      // Invites carry a one-time link; once sent it isn't kept.
      await env.DB.prepare(
        `UPDATE email_outbox SET status = 'sent', sent_at = ?2, attempts = attempts + 1, last_error = NULL,
           payload_json = CASE WHEN template = 'invite' THEN json_remove(payload_json, '$.link') ELSE payload_json END
         WHERE id = ?1`,
      )
        .bind(row.id, now)
        .run();
      perPerson.set(row.user_id, mine + 1);
      total += 1;
      result.sent += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const giveUp = attempts > RETRY_AFTER_MIN.length;
      await env.DB.prepare("UPDATE email_outbox SET attempts = ?2, status = ?3, send_after = ?4, last_error = ?5 WHERE id = ?1")
        .bind(
          row.id,
          attempts,
          giveUp ? "failed" : "pending",
          giveUp ? now : now + RETRY_AFTER_MIN[attempts - 1]! * 60_000,
          (err instanceof Error ? err.message : String(err)).slice(0, 200),
        )
        .run();
      if (giveUp) result.failed += 1;
    }
  }
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Section 7: a request still pending 3 days after it was made is reminded once, to every current App Admin,
 * resolved when the daily job runs (rule 6). Each run covers the requests that crossed the 3-day mark in the
 * day since the last run, so each request is counted once; admins get one email however many there are, and
 * the dedupe key makes a rerun of the same day harmless.
 */
export function accessReminderStatement(env: Pick<Env, "DB">, now: number) {
  return env.DB.prepare(
    `INSERT OR IGNORE INTO email_outbox (user_id, template, payload_json, dedupe_key, mode, send_after, created_at)
     SELECT a.id, 'access.reminder', json_object('count', x.n), 'reminder:' || ?4 || ':' || a.id, 'instant', ?1, ?1
     FROM users a,
          (SELECT count(*) AS n FROM access_requests r JOIN users requester ON requester.id = r.user_id
           WHERE r.status = 'pending' AND r.created_at <= ?2 AND r.created_at > ?3
             AND requester.status != 'suspended' AND requester.deleted_at IS NULL) x
     WHERE x.n > 0 AND a.app_role = 'admin' AND a.status = 'active' AND a.deleted_at IS NULL`,
  ).bind(now, now - 3 * DAY_MS, now - 4 * DAY_MS, new Date(now).toISOString().slice(0, 10));
}

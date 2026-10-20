// Single cron (every 5 minutes) dispatches all background work — see docs/REQUIREMENTS.md section 5.
// Each job is filled in during its build stage; until then the dispatcher only decides what is due.

import { inviteExpiryStatement } from "../access/manage";
import { emailSenderFor } from "../email/sender";
import { dueReminderStatements, queueDigests } from "./digest";
import { usageChecks } from "../admin/usage";
import { cleanOrphanedAttachments } from "./orphans";
import { accessReminderStatement, sendDueEmails } from "./outbox";

export type DueJobs = {
  outbox: boolean; // every tick
  hourly: boolean; // digests + incremental report snapshots, top of each hour
  daily: boolean; // retention queue, orphaned-file cleanup, invite expiry — 3 am Winnipeg
};

const DAILY_HOUR_LOCAL = 3;
const TIMEZONE = "America/Winnipeg";

export function dueJobs(now: Date): DueJobs {
  const minute = now.getUTCMinutes();
  const isTopOfHour = minute < 5;
  const localHour = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, hour: "numeric", hourCycle: "h23" }).format(now),
  );
  return {
    outbox: true,
    hourly: isTopOfHour,
    daily: isTopOfHour && localHour === DAILY_HOUR_LOCAL,
  };
}

export async function runScheduledJobs(now: Date, env: Env): Promise<DueJobs> {
  const due = dueJobs(now);
  const ms = now.getTime();
  if (due.daily) {
    await cleanOrphanedAttachments(env, ms);
    // Section 7: one reminder per request pending more than 3 days, queued before this tick's send.
    await accessReminderStatement(env, ms).run();
    // NOTIF-2: due in 7 days, due tomorrow, overdue — mostly into the 7 am digest.
    await env.DB.batch(dueReminderStatements(env, ms));
    // Section 6: "invite expired", once per invite.
    await inviteExpiryStatement(env, ms).run();
  }
  // Section 8 rule 3: digests for everyone whose local time is 7 am, sent by the outbox step below.
  if (due.hourly) {
    await queueDigests(env, ms);
    // ADM-5 and NFR-15: free-tier warnings and the error-spike alert, sent by the outbox step below.
    await usageChecks(env, ms);
  }
  // Stage 7: incremental report_snapshots.
  // Stage 6d: retention queue (ADM-8).
  if (due.outbox) await sendDueEmails(env, emailSenderFor(env), ms);
  return due;
}

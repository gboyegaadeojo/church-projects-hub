// Single cron (every 5 minutes) dispatches all background work — see docs/REQUIREMENTS.md section 5.
// Each job is filled in during its build stage; until then the dispatcher only decides what is due.

import { cleanOrphanedAttachments } from "./orphans";

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
  if (due.daily) await cleanOrphanedAttachments(env, now.getTime());
  // Stage 5: send due email_outbox rows.
  // Stage 5: build digests for users whose local time is 7 am. Stage 7: incremental report_snapshots.
  // Stage 6: retention queue (ADM-8), invite expiry (audit "invite expired").
  // TODO(Stage 5, section 7): daily, queue one reminder email_outbox row for each access request pending
  // more than 3 days — template "access_request.reminder", recipients all active App Admins resolved at
  // send time (section 8 rule 6), dedupe key "reminder:<request id>" so each request is reminded once.
  return due;
}

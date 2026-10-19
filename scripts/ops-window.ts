// Time rules for the GitHub Actions deploy and backup workflows, in Winnipeg time.
// Pure functions so they're tested (test/ops-window.test.ts); scripts/ops-window-cli.ts runs them in CI.

const ZONE = "America/Winnipeg";

/** Weekday (0 = Sunday … 6 = Saturday) and hour (0–23) in Winnipeg at the given instant. */
export function winnipegClock(at: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")!.value);
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  return { weekday, hour };
}

/** NFR-6: no deploys from Saturday 6 pm to Sunday 2 pm Winnipeg time. */
export function isDeployFrozen(at: Date): boolean {
  const { weekday, hour } = winnipegClock(at);
  return (weekday === 6 && hour >= 18) || (weekday === 0 && hour < 14);
}

/**
 * NFR-8: the nightly backup runs at 3 am Winnipeg. GitHub cron is UTC only, so the workflow is scheduled at
 * both 08:00 UTC (3 am CDT) and 09:00 UTC (3 am CST); each run checks whether its own scheduled slot is 3 am
 * today. It looks at the scheduled slot, not the start time, because GitHub can start scheduled runs late.
 */
export function isBackupSlot(scheduledUtcHour: number, at: Date): boolean {
  const slot = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), scheduledUtcHour));
  return winnipegClock(slot).hour === 3;
}

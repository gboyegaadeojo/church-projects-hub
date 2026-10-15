// Calendar-day boundaries in a person's timezone (RATE-2 counts "per day" in the user's timezone).

export const DEFAULT_TIMEZONE = "America/Winnipeg";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(at: number, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    min: Number(parts.minute),
    s: Number(parts.second),
  };
}

/** Milliseconds the zone is ahead of UTC at instant `at` (negative west of Greenwich). */
function offsetAt(at: number, timeZone: string): number {
  const w = wallClock(at, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - (at - (at % 1000));
}

/** Epoch ms of local midnight that starts the calendar day containing `now` in `timeZone`. */
export function startOfDay(now: number, timeZone: string): number {
  let zone = timeZone;
  try {
    formatter(zone);
  } catch {
    zone = DEFAULT_TIMEZONE; // An unknown zone name never blocks the request.
  }
  const w = wallClock(now, zone);
  const midnightAsUtc = Date.UTC(w.y, w.m - 1, w.d);
  // Use the offset in force at midnight itself, which differs from now's on DST-change days.
  const guess = midnightAsUtc - offsetAt(now, zone);
  return midnightAsUtc - offsetAt(guess, zone);
}

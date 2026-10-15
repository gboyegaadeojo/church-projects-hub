// My Work welcome (section 11.1), by time of day in the person's own timezone (decision 14 Oct 2026, v4.4):
// before noon "Good morning", before 5 pm "Good afternoon", otherwise "Good evening".

export function greetingFor(timeZone: string, at: Date = new Date()): string {
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at));
  } catch {
    // Unknown timezone on the profile: fall back to the device's clock.
    hour = at.getHours();
  }
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function welcomeLine(timeZone: string, at?: Date): string {
  return `${greetingFor(timeZone, at)} 👋 Here's what needs your attention this week.`;
}

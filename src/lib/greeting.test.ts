import { describe, expect, it } from "vitest";
import { greetingFor, welcomeLine } from "./greeting";

describe("Section 11.1 My Work welcome by time of day in the person's timezone", () => {
  // 2026-10-14 is in Central Daylight Time in Winnipeg (UTC-5).
  it.each([
    ["2026-10-14T12:30:00Z", "Good morning"], // 07:30 Winnipeg
    ["2026-10-14T16:59:00Z", "Good morning"], // 11:59
    ["2026-10-14T17:00:00Z", "Good afternoon"], // 12:00
    ["2026-10-14T21:59:00Z", "Good afternoon"], // 16:59
    ["2026-10-14T22:00:00Z", "Good evening"], // 17:00
    ["2026-10-15T04:30:00Z", "Good evening"], // 23:30
  ])("%s in America/Winnipeg is %s", (iso, expected) => {
    expect(greetingFor("America/Winnipeg", new Date(iso))).toBe(expected);
  });

  it("uses the person's timezone, not the device's", () => {
    const at = new Date("2026-10-14T13:00:00Z");
    expect(greetingFor("America/Winnipeg", at)).toBe("Good morning"); // 08:00
    expect(greetingFor("Asia/Tokyo", at)).toBe("Good evening"); // 22:00
  });

  it("keeps the rest of the section 11.1 sentence", () => {
    expect(welcomeLine("America/Winnipeg", new Date("2026-10-14T13:00:00Z"))).toBe(
      "Good morning 👋 Here's what needs your attention this week.",
    );
  });
});

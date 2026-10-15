import { describe, expect, it } from "vitest";
import { startOfDay } from "../worker/lib/time";

// RATE-2 counts per calendar day in the user's timezone.
describe("RATE-2 calendar day in the user's timezone", () => {
  it("finds Winnipeg midnight in summer (CDT, UTC-5)", () => {
    expect(startOfDay(Date.parse("2026-07-15T03:30:00Z"), "America/Winnipeg")).toBe(Date.parse("2026-07-14T05:00:00Z"));
    expect(startOfDay(Date.parse("2026-07-15T18:00:00Z"), "America/Winnipeg")).toBe(Date.parse("2026-07-15T05:00:00Z"));
  });

  it("finds Winnipeg midnight in winter (CST, UTC-6)", () => {
    expect(startOfDay(Date.parse("2026-12-01T12:00:00Z"), "America/Winnipeg")).toBe(Date.parse("2026-12-01T06:00:00Z"));
  });

  it("uses the offset in force at midnight on a DST-change day", () => {
    // 1 Nov 2026: clocks go back at 2 am; midnight was still CDT (UTC-5).
    expect(startOfDay(Date.parse("2026-11-01T20:00:00Z"), "America/Winnipeg")).toBe(Date.parse("2026-11-01T05:00:00Z"));
    // 8 Mar 2026: clocks go forward at 2 am; midnight was still CST (UTC-6).
    expect(startOfDay(Date.parse("2026-03-08T20:00:00Z"), "America/Winnipeg")).toBe(Date.parse("2026-03-08T06:00:00Z"));
  });

  it("follows other timezones and falls back to Winnipeg for an unknown one", () => {
    expect(startOfDay(Date.parse("2026-07-15T12:00:00Z"), "Europe/London")).toBe(Date.parse("2026-07-14T23:00:00Z"));
    expect(startOfDay(Date.parse("2026-07-15T18:00:00Z"), "Not/AZone")).toBe(Date.parse("2026-07-15T05:00:00Z"));
  });
});

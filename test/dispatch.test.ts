import { describe, expect, it } from "vitest";
import { dueJobs } from "../worker/jobs/dispatch";

// Section 5: one cron every 5 minutes dispatches all jobs.
describe("Stage 0 — cron dispatcher", () => {
  it("runs only the outbox mid-hour", () => {
    expect(dueJobs(new Date("2026-11-01T15:25:00Z"))).toEqual({ outbox: true, hourly: false, daily: false });
  });

  it("runs hourly jobs at the top of the hour", () => {
    expect(dueJobs(new Date("2026-11-01T15:00:00Z"))).toEqual({ outbox: true, hourly: true, daily: false });
  });

  it("runs daily jobs at 3 am Winnipeg time (CST, UTC-6)", () => {
    expect(dueJobs(new Date("2026-11-02T09:00:00Z"))).toEqual({ outbox: true, hourly: true, daily: true });
  });

  it("runs daily jobs at 3 am Winnipeg time (CDT, UTC-5)", () => {
    expect(dueJobs(new Date("2026-10-15T08:00:00Z"))).toEqual({ outbox: true, hourly: true, daily: true });
  });
});

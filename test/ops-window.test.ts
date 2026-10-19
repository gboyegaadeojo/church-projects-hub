import { describe, expect, it } from "vitest";
import { isBackupSlot, isDeployFrozen } from "../scripts/ops-window";

describe("NFR-6 no deploys from Saturday 6 pm to Sunday 2 pm Winnipeg time", () => {
  it("blocks Saturday evening and Sunday morning (CDT, UTC-5)", () => {
    expect(isDeployFrozen(new Date("2026-10-17T23:00:00Z"))).toBe(true); // Sat 6:00 pm
    expect(isDeployFrozen(new Date("2026-10-18T04:59:00Z"))).toBe(true); // Sat 11:59 pm
    expect(isDeployFrozen(new Date("2026-10-18T18:59:00Z"))).toBe(true); // Sun 1:59 pm
  });

  it("allows just outside the window", () => {
    expect(isDeployFrozen(new Date("2026-10-17T22:59:00Z"))).toBe(false); // Sat 5:59 pm
    expect(isDeployFrozen(new Date("2026-10-18T19:00:00Z"))).toBe(false); // Sun 2:00 pm
    expect(isDeployFrozen(new Date("2026-10-19T15:00:00Z"))).toBe(false); // Mon 10 am
  });

  it("uses Winnipeg time in winter (CST, UTC-6)", () => {
    expect(isDeployFrozen(new Date("2026-12-12T23:30:00Z"))).toBe(false); // Sat 5:30 pm
    expect(isDeployFrozen(new Date("2026-12-13T00:00:00Z"))).toBe(true); // Sat 6:00 pm
    expect(isDeployFrozen(new Date("2026-12-13T19:59:00Z"))).toBe(true); // Sun 1:59 pm
    expect(isDeployFrozen(new Date("2026-12-13T20:00:00Z"))).toBe(false); // Sun 2:00 pm
  });
});

describe("NFR-8 nightly backup at 3 am Winnipeg time", () => {
  it("runs the 08:00 UTC slot in summer and skips the 09:00 one", () => {
    expect(isBackupSlot(8, new Date("2026-07-15T08:03:00Z"))).toBe(true);
    expect(isBackupSlot(9, new Date("2026-07-15T09:03:00Z"))).toBe(false);
  });

  it("runs the 09:00 UTC slot in winter and skips the 08:00 one", () => {
    expect(isBackupSlot(8, new Date("2026-12-01T08:03:00Z"))).toBe(false);
    expect(isBackupSlot(9, new Date("2026-12-01T09:03:00Z"))).toBe(true);
  });

  it("judges the scheduled slot, not a late start", () => {
    expect(isBackupSlot(8, new Date("2026-07-15T10:40:00Z"))).toBe(true);
  });

  it("runs exactly once on DST-change days", () => {
    // 8 Mar 2026, 3 am is CDT (UTC-5); 1 Nov 2026, 3 am is CST (UTC-6).
    expect([isBackupSlot(8, new Date("2026-03-08T12:00:00Z")), isBackupSlot(9, new Date("2026-03-08T12:00:00Z"))]).toEqual([true, false]);
    expect([isBackupSlot(8, new Date("2026-11-01T12:00:00Z")), isBackupSlot(9, new Date("2026-11-01T12:00:00Z"))]).toEqual([false, true]);
  });
});

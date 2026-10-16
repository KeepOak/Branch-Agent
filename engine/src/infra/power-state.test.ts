// Always on (Private #454 D): polite on battery. The priority call is a fake and the power answer is a temp file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shouldDeferWake } from "./heartbeat-cooldown.js";
import { POWER_STATE_FILE, readOnBattery, startBatteryPoliteness } from "./power-state.js";

describe("polite on battery", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const stateDir = (value?: unknown) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-power-"));
    dirs.push(dir);
    if (value !== undefined) fs.writeFileSync(path.join(dir, POWER_STATE_FILE), JSON.stringify(value));
    return dir;
  };

  it("lowers the engine's priority on battery and puts it back when plugged in", () => {
    const now = 1_000_000;
    const dir = stateDir({ onBattery: true, at: now - 1_000 });
    const priorities: number[] = [];
    const battery = startBatteryPoliteness({ stateDir: dir, now: () => now, setPriority: (p) => priorities.push(p), pollMs: 60_000 });
    try {
      expect(battery.onBattery()).toBe(true);
      expect(priorities).toEqual([os.constants.priority.PRIORITY_BELOW_NORMAL]);
      expect(battery.backoffMs(60_000)).toBe(180_000);
    } finally {
      battery.stop();
    }
    fs.writeFileSync(path.join(dir, POWER_STATE_FILE), JSON.stringify({ onBattery: false, at: now }));
    const plugged = startBatteryPoliteness({ stateDir: dir, now: () => now, setPriority: (p) => priorities.push(p), pollMs: 60_000 });
    plugged.stop();
    expect(plugged.backoffMs(60_000)).toBeUndefined();
  });

  it("treats a missing or stale answer as plugged in", () => {
    expect(readOnBattery(stateDir())).toBe(false);
    expect(readOnBattery(stateDir({ onBattery: true, at: 0 }), 31 * 60_000)).toBe(false);
  });

  it("backs off an interval poll that can wait, and never a manual or task wake", () => {
    const base = { now: 100_000, nextDueMs: 90_000, lastRunStartedAtMs: 40_000, batteryBackoffMs: 180_000 };
    expect(shouldDeferWake({ ...base, intent: "scheduled" })).toEqual({ defer: true, reason: "not-due", retryAtMs: 220_000 });
    expect(shouldDeferWake({ ...base, intent: "scheduled", batteryBackoffMs: undefined })).toEqual({ defer: false });
    expect(shouldDeferWake({ ...base, intent: "manual" })).toEqual({ defer: false });
    expect(shouldDeferWake({ ...base, intent: "task" }).defer).toBe(false);
  });
});

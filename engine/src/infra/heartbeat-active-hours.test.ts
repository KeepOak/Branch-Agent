// Covers heartbeat active-hours evaluation.
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { isWithinActiveHours } from "./heartbeat-active-hours.js";
import { HeartbeatSchema } from "../config/zod-schema.agent-runtime.js";

function cfgWithUserTimezone(userTimezone = "UTC"): BranchConfig {
  return {
    agents: {
      defaults: {
        userTimezone,
      },
    },
  };
}

function heartbeatWindow(start: string, end: string, timezone: string) {
  return {
    activeHours: {
      start,
      end,
      timezone,
    },
  };
}

describe("isWithinActiveHours", () => {
  it("returns true when activeHours is not configured", () => {
    expect(
      isWithinActiveHours(cfgWithUserTimezone("UTC"), undefined, Date.UTC(2025, 0, 1, 3)),
    ).toBe(true);
  });

  it("returns true when activeHours start/end are invalid", () => {
    const cfg = cfgWithUserTimezone("UTC");
    expect(
      isWithinActiveHours(cfg, heartbeatWindow("bad", "10:00", "UTC"), Date.UTC(2025, 0, 1, 9)),
    ).toBe(true);
    expect(
      isWithinActiveHours(cfg, heartbeatWindow("08:00", "24:30", "UTC"), Date.UTC(2025, 0, 1, 9)),
    ).toBe(true);
  });

  it("returns false when activeHours start equals end", () => {
    const cfg = cfgWithUserTimezone("UTC");
    expect(
      isWithinActiveHours(
        cfg,
        heartbeatWindow("08:00", "08:00", "UTC"),
        Date.UTC(2025, 0, 1, 12, 0, 0),
      ),
    ).toBe(false);
  });

  it("respects user timezone windows for normal ranges", () => {
    const cfg = cfgWithUserTimezone("UTC");
    const heartbeat = heartbeatWindow("08:00", "24:00", "user");

    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 7, 0, 0))).toBe(false);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 8, 0, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 23, 59, 0))).toBe(true);
  });

  it("supports overnight ranges", () => {
    const cfg = cfgWithUserTimezone("UTC");
    const heartbeat = heartbeatWindow("22:00", "06:00", "UTC");

    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 23, 0, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 5, 30, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 12, 0, 0))).toBe(false);
  });

  it("respects explicit non-user timezones", () => {
    const cfg = cfgWithUserTimezone("UTC");
    const heartbeat = heartbeatWindow("09:00", "17:00", "America/New_York");

    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 15, 0, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 23, 30, 0))).toBe(false);
  });

  it("falls back to user timezone when activeHours timezone is invalid", () => {
    const cfg = cfgWithUserTimezone("UTC");
    const heartbeat = heartbeatWindow("08:00", "10:00", "Mars/Olympus");

    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 9, 0, 0))).toBe(true);
    expect(isWithinActiveHours(cfg, heartbeat, Date.UTC(2025, 0, 1, 11, 0, 0))).toBe(false);
  });
});

describe("heartbeat calendar days", () => {
  const weekdays = [1, 2, 3, 4, 5];
  const allows = (iso: string, activeHours: { days?: number[]; timezone?: string; start?: string; end?: string }) =>
    isWithinActiveHours(cfgWithUserTimezone("UTC"), { activeHours }, Date.parse(iso));

  it("supports days-only windows and preserves all-day omission defaults", () => {
    expect(allows("2026-10-02T12:00:00Z", { days: weekdays })).toBe(true);
    expect(allows("2026-10-03T12:00:00Z", { days: weekdays })).toBe(false);
    expect(allows("2026-10-04T12:00:00Z", { days: weekdays })).toBe(false);
    expect(allows("2026-10-03T12:00:00Z", {})).toBe(true);
    expect(allows("2026-10-02T12:00:00Z", { days: [] })).toBe(false);
  });

  it("uses the local calendar day rather than the UTC weekend", () => {
    const active = { days: weekdays, timezone: "America/New_York" };
    expect(allows("2026-10-03T03:59:59Z", active)).toBe(true);
    expect(allows("2026-10-03T04:00:00Z", active)).toBe(false);
    expect(allows("2026-10-05T03:59:59Z", active)).toBe(false);
    expect(allows("2026-10-05T04:00:00Z", active)).toBe(true);
  });

  it("combines weekday admission with normal and overnight hour bounds", () => {
    const active = { days: weekdays, timezone: "UTC", start: "22:00", end: "06:00" };
    expect(allows("2026-10-02T22:00:00Z", active)).toBe(true);
    expect(allows("2026-10-03T01:00:00Z", active)).toBe(false);
    expect(allows("2026-10-05T05:59:00Z", active)).toBe(true);
    expect(allows("2026-10-05T06:00:00Z", active)).toBe(false);
    expect(allows("2026-10-05T09:00:00Z", { ...active, start: "09:00", end: "17:00" })).toBe(true);
  });

  it("uses source timezone fallback and follows daylight saving changes", () => {
    expect(allows("2026-10-03T00:00:00Z", { days: weekdays, timezone: "user" })).toBe(false);
    expect(allows("2026-10-03T00:00:00Z", { days: weekdays, timezone: "Mars/Olympus" })).toBe(false);
    const active = { days: [0], timezone: "America/New_York", start: "08:00", end: "09:00" };
    expect(allows("2027-03-07T13:00:00Z", active)).toBe(true);
    expect(allows("2027-03-14T12:00:00Z", active)).toBe(true);
    expect(allows("2027-03-14T13:00:00Z", active)).toBe(false);
  });

  it("validates weekday values for both default and per-agent heartbeat settings", () => {
    expect(HeartbeatSchema.safeParse({ activeHours: { days: weekdays } }).success).toBe(true);
    expect(HeartbeatSchema.safeParse({ activeHours: { days: [] } }).success).toBe(true);
    for (const days of [[-1], [7], [1.5], ["Monday"], "weekdays"]) {
      expect(HeartbeatSchema.safeParse({ activeHours: { days } }).success).toBe(false);
    }
  });
});

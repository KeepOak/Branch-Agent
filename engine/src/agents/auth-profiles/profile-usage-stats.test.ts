import { describe, expect, it } from "vitest";
import { isProfilePausedByUser } from "./order.js";
import { coerceProfileUsageStats } from "./profile-usage-stats.js";

describe("paused accounts in persisted usage stats", () => {
  it("keeps an open pause and a timed pause", () => {
    expect(coerceProfileUsageStats({ paused: {} })?.paused).toStrictEqual({});
    expect(coerceProfileUsageStats({ paused: { until: 1_700_000_000_000 } })?.paused).toStrictEqual(
      {
        until: 1_700_000_000_000,
      },
    );
  });

  it("drops a malformed pause instead of pausing the account", () => {
    expect(coerceProfileUsageStats({ paused: true })?.paused).toBeUndefined();
    expect(coerceProfileUsageStats({ paused: "1 hour" })?.paused).toBeUndefined();
  });

  it("reads an open pause as paused and a timed pause only before its end", () => {
    const now = 1_000;
    expect(isProfilePausedByUser({ paused: {} }, now)).toBe(true);
    expect(isProfilePausedByUser({ paused: { until: 2_000 } }, now)).toBe(true);
    expect(isProfilePausedByUser({ paused: { until: 500 } }, now)).toBe(false);
    expect(isProfilePausedByUser({}, now)).toBe(false);
    expect(isProfilePausedByUser(undefined, now)).toBe(false);
  });
});

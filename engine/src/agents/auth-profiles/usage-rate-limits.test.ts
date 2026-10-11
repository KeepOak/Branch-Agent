import { afterEach, describe, expect, it } from "vitest";
import {
  ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS,
  anthropicUnifiedUsageWindows,
  claimAnthropicUnifiedRefresh,
  parseAnthropicUnifiedRateLimitHeaders,
  readAnthropicUnifiedRateLimits,
  recordAnthropicUnifiedRateLimits,
  resetAnthropicUnifiedRateLimitsForTest,
} from "./usage-rate-limits.js";
import { RECORDED_UNIFIED_HEADERS } from "./usage-rate-limits.test-support.js";

describe("anthropic unified rate-limit headers", () => {
  afterEach(() => resetAnthropicUnifiedRateLimitsForTest());

  it("parses the recorded response into 5h and weekly windows with reset times", () => {
    const limits = parseAnthropicUnifiedRateLimitHeaders(new Headers(RECORDED_UNIFIED_HEADERS), 42);
    expect(limits).toEqual({
      observedAt: 42,
      status: "allowed",
      representativeClaim: "five_hour",
      fiveHour: { usedPercent: 9, resetAt: 1_791_764_400_000, status: "allowed" },
      sevenDay: { usedPercent: 1, resetAt: 1_792_360_800_000, status: "allowed" },
    });
    expect(anthropicUnifiedUsageWindows(limits)).toEqual([
      { label: "5h", usedPercent: 9, resetAt: 1_791_764_400_000 },
      { label: "Week", usedPercent: 1, resetAt: 1_792_360_800_000 },
    ]);
  });

  it("reads plain header records case-insensitively and clamps utilization", () => {
    const limits = parseAnthropicUnifiedRateLimitHeaders({
      "Anthropic-Ratelimit-Unified-5h-Utilization": "1.3",
      "anthropic-ratelimit-unified-5h-status": "rejected",
    });
    expect(limits?.fiveHour).toEqual({ usedPercent: 100, status: "rejected" });
    expect(limits?.sevenDay).toBeUndefined();
  });

  it("ignores responses without unified headers", () => {
    expect(parseAnthropicUnifiedRateLimitHeaders({ "x-ratelimit-limit-requests": "50" })).toBe(
      undefined,
    );
    expect(
      parseAnthropicUnifiedRateLimitHeaders({ "anthropic-ratelimit-unified-5h-utilization": "x" }),
    ).toBe(undefined);
    expect(
      recordAnthropicUnifiedRateLimits({ profileId: "anthropic:a", headers: { a: "b" } }),
    ).toBe(false);
    expect(readAnthropicUnifiedRateLimits({ profileId: "anthropic:a" })).toBeUndefined();
  });

  it("keeps the newest reading per profile and per token", () => {
    const older = {
      ...RECORDED_UNIFIED_HEADERS,
      "anthropic-ratelimit-unified-5h-utilization": "0.5",
    };
    recordAnthropicUnifiedRateLimits({
      profileId: "anthropic:a",
      headers: RECORDED_UNIFIED_HEADERS,
      now: 200,
    });
    recordAnthropicUnifiedRateLimits({ profileId: "anthropic:a", headers: older, now: 100 });
    recordAnthropicUnifiedRateLimits({ token: "tok", headers: older, now: 300 });
    expect(
      readAnthropicUnifiedRateLimits({ profileId: "anthropic:a" })?.fiveHour?.usedPercent,
    ).toBe(9);
    expect(readAnthropicUnifiedRateLimits({ profileId: "anthropic:b" })).toBeUndefined();
    expect(
      readAnthropicUnifiedRateLimits({ profileId: "anthropic:a", token: "tok" })?.observedAt,
    ).toBe(300);
  });

  it("allows one refresh per profile every 30 minutes", () => {
    const key = { profileId: "anthropic:a", token: "tok" };
    expect(claimAnthropicUnifiedRefresh(key, 1_000)).toBe(true);
    expect(
      claimAnthropicUnifiedRefresh(key, 1_000 + ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS - 1),
    ).toBe(false);
    expect(claimAnthropicUnifiedRefresh({ profileId: "anthropic:a" }, 2_000)).toBe(false);
    expect(claimAnthropicUnifiedRefresh({ profileId: "anthropic:b" }, 2_000)).toBe(true);
    expect(claimAnthropicUnifiedRefresh(key, 1_000 + ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS)).toBe(
      true,
    );
    expect(claimAnthropicUnifiedRefresh({}, 1_000)).toBe(false);
  });
});

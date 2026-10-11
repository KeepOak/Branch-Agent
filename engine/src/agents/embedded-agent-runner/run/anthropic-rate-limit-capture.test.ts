import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readAnthropicUnifiedRateLimits,
  resetAnthropicUnifiedRateLimitsForTest,
} from "../../auth-profiles/usage-rate-limits.js";
import { RECORDED_UNIFIED_HEADERS } from "../../auth-profiles/usage-rate-limits.test-support.js";
import type { StreamFn } from "../../runtime/index.js";
import { wrapStreamFnWithAnthropicRateLimitCapture } from "./anthropic-rate-limit-capture.js";

describe("wrapStreamFnWithAnthropicRateLimitCapture", () => {
  afterEach(() => resetAnthropicUnifiedRateLimitsForTest());

  it("keeps each response's unified headers under the run's auth profile", async () => {
    const original = vi.fn();
    const inner = vi.fn(((_model, _context, options) => {
      void options?.onResponse?.({ status: 200, headers: RECORDED_UNIFIED_HEADERS }, _model);
      return "stream";
    }) as StreamFn);
    const wrapped = wrapStreamFnWithAnthropicRateLimitCapture(inner, () => "anthropic:work");
    const model = { provider: "anthropic" } as Parameters<StreamFn>[0];
    expect(wrapped(model, { messages: [] } as never, { onResponse: original })).toBe("stream");
    expect(original).toHaveBeenCalledWith(
      { status: 200, headers: RECORDED_UNIFIED_HEADERS },
      model,
    );
    expect(readAnthropicUnifiedRateLimits({ profileId: "anthropic:work" })?.sevenDay).toEqual({
      usedPercent: 1,
      resetAt: 1_792_360_800_000,
      status: "allowed",
    });
  });

  it("records nothing without an auth profile", () => {
    const inner = vi.fn(((_model, _context, options) => {
      void options?.onResponse?.({ status: 200, headers: RECORDED_UNIFIED_HEADERS }, _model);
      return "stream";
    }) as StreamFn);
    wrapStreamFnWithAnthropicRateLimitCapture(inner, () => undefined)(
      { provider: "anthropic" } as Parameters<StreamFn>[0],
      { messages: [] } as never,
      undefined,
    );
    expect(readAnthropicUnifiedRateLimits({ profileId: "anthropic:work" })).toBeUndefined();
  });
});

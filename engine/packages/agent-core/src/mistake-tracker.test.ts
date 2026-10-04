// Behaviour of cline/cline sdk/packages/core/src/runtime/safety/mistake-tracker.ts
// at 0809928ab28783c0d2b41c1e56edaf0951dadcab, including its limit-decision cases
// from apps/cli/src/runtime/interactive/mistakes.test.ts (stop, continue with guidance).
import { describe, expect, it, vi } from "vitest";
import {
  buildMistakeLimitStopMessage,
  DEFAULT_MAX_CONSECUTIVE_MISTAKES,
  MistakeTracker,
  recordToolTurnOutcome,
} from "./mistake-tracker.js";

function tracker(max: number, onLimitReached?: ConstructorParameters<typeof MistakeTracker>[0]["onLimitReached"]) {
  const notices: string[] = [];
  const instance = new MistakeTracker({
    maxConsecutiveMistakes: max,
    onLimitReached,
    appendRecoveryNotice: (message) => notices.push(message),
  });
  return { instance, notices };
}

const failed = (text: string) => ({
  isError: true,
  toolName: "exec",
  content: [{ type: "text", text }],
});
const ok = { isError: false, toolName: "read", content: [{ type: "text", text: "fine" }] };

describe("MistakeTracker", () => {
  it("uses cline's default cap of six", () => {
    expect(DEFAULT_MAX_CONSECUTIVE_MISTAKES).toBe(6);
  });

  it("continues below the cap and stops with the stop message at the cap", async () => {
    const { instance } = tracker(3);
    await expect(instance.record({ iteration: 1, reason: "api_error" })).resolves.toEqual({
      action: "continue",
    });
    await expect(instance.record({ iteration: 2, reason: "api_error" })).resolves.toEqual({
      action: "continue",
    });
    const outcome = await instance.record({
      iteration: 3,
      reason: "tool_execution_failed",
      details: "bad args",
    });
    expect(outcome).toEqual({
      action: "stop",
      reason: "maximum consecutive mistakes reached (3)",
      message:
        "Stopped after 3/3 consecutive mistakes (tool_execution_failed) at iteration 3. Error: bad args Decision: maximum consecutive mistakes reached (3) Session state was preserved. Send a new prompt to resume from the latest state.",
    });
  });

  it("jumps straight to the cap when forced", async () => {
    const { instance } = tracker(5);
    const outcome = await instance.record({ iteration: 1, reason: "invalid_tool_call", forceAtLimit: true });
    expect(outcome.action).toBe("stop");
    expect(instance.value).toBe(5);
  });

  it("never stops when the cap is zero", async () => {
    const { instance } = tracker(0);
    for (let i = 1; i <= 20; i += 1) {
      await expect(instance.record({ iteration: i, reason: "api_error" })).resolves.toEqual({
        action: "continue",
      });
    }
  });

  it("continues with guidance from the limit handler, appends a notice and resets", async () => {
    const handler = vi.fn(() => ({
      action: "continue" as const,
      guidance:
        "mistake_limit_reached: retry with a different approach, validate tool parameters before calls, and avoid repeating failed steps.",
    }));
    const { instance, notices } = tracker(2, handler);
    await instance.record({ iteration: 1, reason: "tool_execution_failed" });
    const outcome = await instance.record({ iteration: 2, reason: "tool_execution_failed", details: "x" });
    expect(handler).toHaveBeenCalledWith({
      iteration: 2,
      consecutiveMistakes: 2,
      maxConsecutiveMistakes: 2,
      reason: "tool_execution_failed",
      details: "x",
    });
    expect(outcome).toMatchObject({
      action: "continue",
      guidance: expect.stringContaining("retry with a different approach"),
    });
    expect(notices).toHaveLength(1);
    expect(instance.value).toBe(0);
  });

  it("honors an explicit stop decision and stops when the handler throws", async () => {
    const stop = tracker(1, () => ({ action: "stop", reason: "stopped after mistake_limit_reached prompt" }));
    await expect(stop.instance.record({ iteration: 4, reason: "invalid_tool_call" })).resolves.toMatchObject({
      action: "stop",
      reason: "stopped after mistake_limit_reached prompt",
    });
    const thrown = tracker(1, () => {
      throw new Error("handler broke");
    });
    await expect(thrown.instance.record({ iteration: 1, reason: "api_error" })).resolves.toMatchObject({
      action: "stop",
      reason: "handler broke",
    });
  });
});

describe("recordToolTurnOutcome", () => {
  it("records a mistake only when every tool call in the turn failed", async () => {
    const { instance } = tracker(6);
    await recordToolTurnOutcome(instance, 1, [failed("boom"), failed("again")]);
    expect(instance.value).toBe(1);
    await recordToolTurnOutcome(instance, 2, [failed("boom"), ok]);
    expect(instance.value).toBe(0);
    await recordToolTurnOutcome(instance, 3, []);
    expect(instance.value).toBe(0);
  });

  it("reports the failed tool details in the stop message", async () => {
    const { instance } = tracker(1);
    const outcome = await recordToolTurnOutcome(instance, 7, [failed("no such file")]);
    expect(outcome).toMatchObject({ action: "stop" });
    expect(outcome.action === "stop" ? outcome.message : "").toContain(
      "Error: 1 tool call(s) failed: [exec] no such file",
    );
  });
});

describe("buildMistakeLimitStopMessage", () => {
  it("omits empty details and decision", () => {
    expect(
      buildMistakeLimitStopMessage({
        iteration: 2,
        consecutiveMistakes: 6,
        maxConsecutiveMistakes: 6,
        reason: "api_error",
      }),
    ).toBe(
      "Stopped after 6/6 consecutive mistakes (api_error) at iteration 2. Session state was preserved. Send a new prompt to resume from the latest state.",
    );
  });
});

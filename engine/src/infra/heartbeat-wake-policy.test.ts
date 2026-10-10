import { describe, expect, it } from "vitest";
import {
  isTargetedUnscheduledWake,
  resolveHeartbeatWakePayloadFlags,
} from "./heartbeat-wake-policy.js";

const SESSION_KEY = "agent:builder-1:main";

describe("isTargetedUnscheduledWake signal source", () => {
  it.each(["ci-red", "fix-verdict"])("admits an immediate targeted %s wake", (reason) => {
    expect(
      isTargetedUnscheduledWake({
        source: "signal",
        intent: "immediate",
        reason,
        agentId: "builder-1",
        sessionKey: SESSION_KEY,
      }),
    ).toBe(true);
  });

  it("rejects an unknown signal reason", () => {
    expect(
      isTargetedUnscheduledWake({
        source: "signal",
        intent: "immediate",
        reason: "ci-red-extra",
        sessionKey: SESSION_KEY,
      }),
    ).toBe(false);
  });

  it("rejects a signal wake without a session target", () => {
    expect(
      isTargetedUnscheduledWake({
        source: "signal",
        intent: "immediate",
        reason: "ci-red",
        agentId: "builder-1",
      }),
    ).toBe(false);
  });

  it("rejects a non-immediate signal wake", () => {
    expect(
      isTargetedUnscheduledWake({
        source: "signal",
        intent: "event",
        reason: "ci-red",
        sessionKey: SESSION_KEY,
      }),
    ).toBe(false);
  });
});

describe("resolveHeartbeatWakePayloadFlags signal source", () => {
  it("treats a signal wake as a payload wake so its queued event is read", () => {
    expect(resolveHeartbeatWakePayloadFlags({ source: "signal", reason: "ci-red" })).toMatchObject({
      isWakePayload: true,
      isCronWake: false,
      isExecEventWake: false,
    });
  });
});

// Engine-only lease bounds are not duplicated in the desktop deadline table.
import { describe, expect, it } from "vitest";
import timeouts from "../../../desktop/src/handoff-timeouts.json" with { type: "json" };

describe("P45 handoff deadlines", () => {
  it("does not duplicate engine-only lease and rollback lock bounds", () => {
    expect(timeouts).not.toHaveProperty("leaseMaxWaitMs");
    expect(timeouts).not.toHaveProperty("leaseMaxAgeMs");
    expect(timeouts).not.toHaveProperty("rollbackLockWaitMs");
    expect(timeouts.retireKillAfterMs).toBeGreaterThan(
      timeouts.stepDownTimeoutMs + timeouts.takeOverTimeoutMs + timeouts.standbyReadyTimeoutMs + timeouts.rollbackTimeoutMs,
    );
  });
});

// Engine-only lease bounds are not duplicated in the desktop deadline table.
import { describe, expect, it } from "vitest";
import timeouts from "../../../desktop/src/handoff-timeouts.json" with { type: "json" };
import { SESSION_HANDOFF_LEASE_MAX_AGE_MS, SESSION_HANDOFF_LEASE_MAX_WAIT_MS } from "../process/session-handoff-lease-files.js";

describe("P45 handoff deadlines", () => {
  it("does not duplicate engine-only lease and rollback lock bounds", () => {
    expect(timeouts).not.toHaveProperty("leaseMaxWaitMs");
    expect(timeouts).not.toHaveProperty("leaseMaxAgeMs");
    expect(timeouts).not.toHaveProperty("rollbackLockWaitMs");
    expect(timeouts.retireKillAfterMs).toBeGreaterThan(
      timeouts.stepDownTimeoutMs + timeouts.takeOverTimeoutMs + timeouts.standbyReadyTimeoutMs + timeouts.rollbackTimeoutMs,
    );
    expect(timeouts.retireKillAfterMs).toBeGreaterThan(SESSION_HANDOFF_LEASE_MAX_WAIT_MS);
    expect(timeouts.retireKillAfterMs).toBeLessThan(SESSION_HANDOFF_LEASE_MAX_AGE_MS);
  });
});

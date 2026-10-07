// The desktop retire backstop must stay between the engine's actual lease deadline and stale age.
import { describe, expect, it } from "vitest";
import timeouts from "../../../desktop/src/handoff-timeouts.json" with { type: "json" };
import { SESSION_HANDOFF_LEASE_MAX_AGE_MS, SESSION_HANDOFF_LEASE_MAX_WAIT_MS } from "../process/session-handoff-lease-files.js";

describe("P45 handoff deadlines", () => {
  it("retire a stepped-down engine before its leases can become stale", () => {
    expect(timeouts.retireKillAfterMs).toBeGreaterThan(SESSION_HANDOFF_LEASE_MAX_WAIT_MS);
    expect(timeouts.retireKillAfterMs).toBeLessThan(SESSION_HANDOFF_LEASE_MAX_AGE_MS);
  });
});

// The P45 handoff deadlines live in one JSON file both sides import (desktop/src/handoff-timeouts.json). This proves
// the engine resolves and type-checks that import, and that the lease bounds there are the ones the engine expects.
import { describe, expect, it } from "vitest";
import timeouts from "../../../desktop/src/handoff-timeouts.json" with { type: "json" };

describe("shared P45 handoff deadlines", () => {
  it("are importable by the engine", () => {
    expect(timeouts.leaseMaxWaitMs).toBe(330_000);
    expect(timeouts.leaseMaxAgeMs).toBe(360_000);
    expect(timeouts.rollbackLockWaitMs).toBeLessThan(timeouts.rollbackTimeoutMs);
  });
});

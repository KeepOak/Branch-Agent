import { describe, expect, it } from "vitest";
import { isFreshRestartInterruption } from "./main-session-restart-recovery-freshness.js";

describe("Hermes restart auto-continue freshness", () => {
  const now = 1_700_000_000_000;

  it("keeps the one-hour boundary inclusive and rejects older interruptions", () => {
    expect(isFreshRestartInterruption({ timestamp: now - 3_600_000, now })).toBe(true);
    expect(isFreshRestartInterruption({ timestamp: now - 3_600_001, now })).toBe(false);
    expect(isFreshRestartInterruption({ timestamp: now - 7_200_000, now })).toBe(false);
  });

  it("treats unknown timestamps as fresh and supports the upstream override", () => {
    expect(isFreshRestartInterruption({ timestamp: undefined, now })).toBe(true);
    expect(isFreshRestartInterruption({ timestamp: Number.NaN, now })).toBe(true);
    expect(
      isFreshRestartInterruption({
        timestamp: now - 7_200_000,
        now,
        cfg: { gateway: { autoContinueFreshnessSeconds: 7_200 } },
      }),
    ).toBe(true);
    expect(
      isFreshRestartInterruption({
        timestamp: now - 7_200_000,
        now,
        cfg: { gateway: { autoContinueFreshnessSeconds: 0 } },
      }),
    ).toBe(true);
  });
});

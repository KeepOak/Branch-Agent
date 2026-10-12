import { describe, expect, it, vi } from "vitest";

const { abortRuns, waitRuns, waitJobs } = vi.hoisted(() => ({
  abortRuns: vi.fn(() => 1),
  waitRuns: vi.fn(),
  waitJobs: vi.fn(),
}));

vi.mock("../cron/service/active-run-cancellation.js", () => ({
  abortActiveCronTaskRuns: abortRuns,
  waitForActiveCronTaskRuns: waitRuns,
}));
vi.mock("../cron/active-jobs.js", () => ({ waitForActiveCronJobs: waitJobs }));

import { drainGatewayCron } from "./server-cron-drain.js";

describe("Gateway cron handoff drain", () => {
  it("lets an active run finish without cancelling it before releasing state", async () => {
    let finishRun!: () => void;
    const runFinished = new Promise<void>((resolve) => {
      finishRun = resolve;
    });
    waitRuns.mockImplementation(async () => {
      await runFinished;
      return { drained: true, active: 0 };
    });
    waitJobs.mockResolvedValue({ drained: true, active: 0 });
    const draining = drainGatewayCron({
      settlements: [],
      logger: { warn: vi.fn() },
      preserveActiveRuns: true,
    });
    let settled = false;
    void draining.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(abortRuns).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    finishRun();
    await draining;
    expect(settled).toBe(true);
  });

  it("bounds a stuck handoff drain without cancelling the running cron job", async () => {
    vi.useFakeTimers();
    try {
      waitRuns.mockImplementation(() => new Promise(() => {}));
      waitJobs.mockImplementation(() => new Promise(() => {}));
      const draining = drainGatewayCron({
        settlements: [new Promise(() => {})],
        logger: { warn: vi.fn() },
        preserveActiveRuns: true,
      });
      const rejection = expect(draining).rejects.toThrow("Cron runs did not finish before Gateway handoff");
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
      expect(waitRuns).toHaveBeenCalledWith(15_000);
      expect(waitJobs).toHaveBeenCalledWith(15_000);
      expect(abortRuns).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

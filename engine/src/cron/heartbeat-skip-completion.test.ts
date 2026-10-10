import { describe, expect, it } from "vitest";
import {
  createCronRegressionState,
  createDueIsolatedJob,
} from "../../test/helpers/cron/service-regression-fixtures.js";
import {
  resolveAdmittedCronCompletionStatus,
  resolveCronCompletionStatus,
} from "./completion-status.js";
import { applyJobResult } from "./service/timer-outcomes.js";

describe("heartbeat skipped completion", () => {
  it("never counts a skipped heartbeat as a failed completion", () => {
    expect(
      resolveCronCompletionStatus({ status: "skipped", deliveryStatus: "not-requested" }),
    ).toBe("unknown");
    expect(
      resolveAdmittedCronCompletionStatus(
        { delivery: { mode: "announce" } },
        "skipped",
        "not-delivered",
      ),
    ).toBe("unknown");
    expect(resolveCronCompletionStatus({ status: "error" })).toBe("failed");
  });
  it("retains the first real failure time and clears it on a skip", () => {
    const state = createCronRegressionState({
      storePath: "unused",
      runIsolatedAgentJob: async () => ({ status: "ok" }),
    });
    const job = createDueIsolatedJob({ id: "heartbeat", nowMs: 1000, nextRunAtMs: 1000 });
    const apply = (startedAt: number, status: "error" | "skipped", error: string) =>
      applyJobResult(
        state,
        job,
        { status, startedAt, endedAt: startedAt + 1, error },
        { deferredNotifications: [] },
      );
    apply(1000, "error", "First error");
    apply(2000, "error", "Last error");
    expect(job.state).toMatchObject({
      failingSinceMs: 1000,
      lastError: "Last error",
      lastCompletionStatus: "failed",
    });
    apply(3000, "skipped", "heartbeat skipped: no-route");
    expect(job.state.failingSinceMs).toBeUndefined();
    expect(job.state.lastCompletionStatus).toBe("unknown");
  });
});

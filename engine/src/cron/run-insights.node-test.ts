import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";
import { CronRunsParamsSchema } from "../../packages/gateway-protocol/src/schema/cron.js";
import { projectCronRunHistoryPage } from "./run-history.js";
import { summarizeCronRuns } from "./run-insights.js";
import type { CronRunLogEntry } from "./run-log-types.js";
import type { CronRunRecord } from "./store/run-history.types.js";
function entry(overrides: Partial<CronRunLogEntry> = {}): CronRunLogEntry {
  return {
    action: "finished",
    jobId: "proof",
    ts: 20,
    status: "ok",
    completionStatus: "succeeded",
    durationMs: 1000,
    ...overrides,
  };
}
test("source empty and skipped samples report unknown success and duration", () => {
  for (const entries of [[], [entry({ status: "skipped" })]]) {
    const result = summarizeCronRuns({ entries, total: entries.length, offset: 0 });
    assert.equal(result.recentSuccessRate, null);
    assert.equal(result.averageDurationMs, null);
    assert.equal(result.completedTotal, 0);
  }
});
test("source task-aware success rate excludes completed-but-failed work", () => {
  const result = summarizeCronRuns({
    entries: [
      entry(),
      entry({ status: "error", durationMs: 3000 }),
      entry({ completionStatus: "failed", durationMs: 2000 }),
      entry({ status: "skipped" }),
    ],
    total: 4,
    offset: 0,
  });
  assert.deepEqual(result, {
    sampleSize: 4,
    terminalSampleSize: 3,
    successfulSampleSize: 1,
    completedTotal: 1,
    recentSuccessRate: 1 / 3,
    averageDurationMs: 2000,
  });
});
test("partial history cannot invent lifetime completion totals", () => {
  assert.equal(summarizeCronRuns({ entries: [entry()], total: 9, offset: 0 }).completedTotal, null);
  assert.equal(summarizeCronRuns({ entries: [entry()], total: 1, offset: 1 }).completedTotal, null);
});
test("invalid source durations are excluded instead of poisoning averages", () => {
  const result = summarizeCronRuns({
    entries: [
      entry(),
      entry({ durationMs: Number.NaN }),
      entry({ durationMs: -1 }),
      entry({ durationMs: Infinity }),
    ],
    total: 4,
    offset: 0,
  });
  assert.equal(result.averageDurationMs, 1000);
});
test("production history projection computes insights after visibility filtering and pagination", () => {
  function record(id: string, durationMs: number): CronRunRecord {
    return {
      id,
      jobId: id,
      createdAt: 1,
      endedAt: 20,
      status: "succeeded",
      detail: {
        kind: "cron-run",
        storeKey: "proof-store",
        status: "ok",
        completionStatus: "succeeded",
        durationMs,
      },
    };
  }
  const records = [record("visible", 1000), record("hidden", 999999)];
  const page = projectCronRunHistoryPage(records, {
    storeKey: "proof-store",
    includeInsights: true,
    entryFilter: (entry) => entry.jobId === "visible",
  });
  assert.equal(page.total, 1);
  assert.equal(page.insights?.averageDurationMs, 1000);
  assert.equal(page.insights?.completedTotal, 1);
  assert.equal(projectCronRunHistoryPage(records, { storeKey: "proof-store" }).insights, undefined);
  assert.equal(
    projectCronRunHistoryPage(records, { storeKey: "proof-store", includeInsights: true, limit: 1 })
      .insights?.completedTotal,
    null,
  );
});
test("existing Gateway parameter schema validates the optional insights request", () => {
  assert.equal(Value.Check(CronRunsParamsSchema, { id: "proof", includeInsights: true }), true);
  assert.equal(Value.Check(CronRunsParamsSchema, { id: "proof", includeInsights: "yes" }), false);
  assert.equal(Value.Check(CronRunsParamsSchema, { id: "proof" }), true);
});

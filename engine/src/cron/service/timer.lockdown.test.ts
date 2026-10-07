// Lockdown rests Seasons (DESIGN-SPEC §7246): nothing runs, nothing counts as a failure, nothing is auto-disabled.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCronRegressionState as createCronServiceState,
  createDueIsolatedJob,
  setupCronRegressionFixtures,
} from "../../../test/helpers/cron/service-regression-fixtures.js";
import { LOCKDOWN_MESSAGE } from "../../config/lockdown.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import { saveCronStore } from "../store.js";
import type { CronJob } from "../types.js";
import { runMissedJobs } from "./timer.js";
import { onTimer } from "./timer.test-support.js";

const fixtures = setupCronRegressionFixtures({ prefix: "cron-lockdown-" });
const scheduledAt = Date.parse("2026-02-06T10:00:00.000Z");

function recurringJob(id: string): CronJob {
  return {
    ...createDueIsolatedJob({ id, nowMs: scheduledAt, nextRunAtMs: scheduledAt }),
    schedule: { kind: "every", everyMs: 60_000, anchorMs: scheduledAt - 60_000 },
  };
}

async function stateWith(jobs: CronJob[], runIsolatedAgentJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" })) {
  const { storePath } = fixtures.makeStorePath();
  await saveCronStore(storePath, { version: 1, jobs });
  let now = scheduledAt + 1_000;
  const state = createCronServiceState({ storePath, nowMs: () => now, runIsolatedAgentJob });
  return { state, runIsolatedAgentJob, advance: (ms: number) => (now += ms) };
}

const job = (state: { store?: { jobs?: CronJob[] } | null }, id: string) =>
  state.store?.jobs?.find((candidate) => candidate.id === id);

describe("cron while Lockdown is on", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  it("rests: eleven ticks run nothing, count no errors, disable nothing, and keep the one-shot due", async () => {
    const { state, runIsolatedAgentJob, advance } = await stateWith([
      createDueIsolatedJob({ id: "once", nowMs: scheduledAt, nextRunAtMs: scheduledAt }),
      recurringJob("every-minute"),
    ]);
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
    for (let tick = 0; tick < 11; tick += 1) {
      await onTimer(state);
      advance(60_000);
    }
    expect(runIsolatedAgentJob).not.toHaveBeenCalled();
    for (const id of ["once", "every-minute"]) {
      expect(job(state, id)?.enabled, id).toBe(true);
      expect(job(state, id)?.state.consecutiveErrors ?? 0, id).toBe(0);
      expect(job(state, id)?.state.autoDisabled, id).toBeUndefined();
      expect(job(state, id)?.state.nextRunAtMs, id).toBe(scheduledAt);
    }
    clearRuntimeConfigSnapshot();
    await onTimer(state);
    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(2);
  });

  it("does not count a run refused by Lockdown as a failure", async () => {
    const runner = vi.fn().mockResolvedValue({ status: "error", error: LOCKDOWN_MESSAGE });
    const { state, advance } = await stateWith([recurringJob("refused")], runner);
    for (let tick = 0; tick < 11; tick += 1) {
      await onTimer(state);
      advance(60_000);
    }
    expect(runner).toHaveBeenCalled();
    expect(job(state, "refused")?.enabled).toBe(true);
    expect(job(state, "refused")?.state.consecutiveErrors ?? 0).toBe(0);
    expect(job(state, "refused")?.state.autoDisabled).toBeUndefined();
  });

  it("skips startup catch-up on an engine that starts locked", async () => {
    const { state, runIsolatedAgentJob } = await stateWith([recurringJob("missed")]);
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
    await runMissedJobs(state);
    expect(runIsolatedAgentJob).not.toHaveBeenCalled();
  });
});

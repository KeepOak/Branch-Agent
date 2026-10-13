// Written by Branch for AUTOMATION-0008 from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3 cron startup/recovery contracts; not copied.
import { describe, expect, it, vi } from "vitest";
import { createTestGatewayScheduler } from "../../test-utils/gateway-scheduler-clock.js";
import { readCronRunHistoryPageForTests } from "../run-history.test-support.js";
import { CronService, type CronEvent } from "../service.js";
import { setupCronServiceSuite, writeCronStoreSnapshot } from "../service.test-harness.js";
import { loadCronStore } from "../store.js";
import { cronStoreKey } from "../store/key.js";
import { makeCronRecoveryJob } from "../store/run-receipt-store.test-support.js";
import { STARTUP_INTERRUPTED_ERROR } from "./startup-run-repair.js";

const { logger, makeStorePath } = setupCronServiceSuite({ prefix: "harvest-restart-recovery-" });

function service(storePath: string, nowMs: number, events: CronEvent[]) {
  const runCommandJob = vi.fn(async () => ({ status: "ok" as const }));
  const cron = new CronService({
    scheduler: createTestGatewayScheduler(),
    storePath,
    cronEnabled: true,
    log: logger,
    nowMs: () => nowMs,
    isAgentAvailable: () => true,
    enqueueSystemEvent: vi.fn(),
    requestHeartbeat: vi.fn(),
    runIsolatedAgentJob: vi.fn(),
    runCommandJob,
    onEvent: (event) => events.push(structuredClone(event)),
  });
  return { cron, runCommandJob };
}

describe("Harvest restart recovery", () => {
  it.each(["at", "every"] as const)(
    "settles a disabled interrupted %s job once and permits an explicit run",
    async (kind) => {
      const { storePath } = await makeStorePath();
      const nowMs = Date.now();
      const startedAtMs = nowMs - 30_000;
      const job = makeCronRecoveryJob(`disabled-${kind}`, startedAtMs);
      job.enabled = false;
      job.deleteAfterRun = false;
      if (kind === "at") {
        job.schedule = { kind: "at", at: new Date(startedAtMs).toISOString() };
      }
      await writeCronStoreSnapshot({ storePath, jobs: [job] });
      const events: CronEvent[] = [];
      const { cron, runCommandJob } = service(storePath, nowMs, events);
      try {
        await cron.start();
        const repaired = (await loadCronStore(storePath)).jobs[0]!;
        expect(repaired.enabled).toBe(false);
        expect(repaired.state).toMatchObject({
          lastRunAtMs: startedAtMs,
          lastRunStatus: "error",
          lastError: STARTUP_INTERRUPTED_ERROR,
          lastDurationMs: 30_000,
          consecutiveErrors: 1,
        });
        expect(repaired.state.runningAtMs).toBeUndefined();
        expect(repaired.state.runningReceiptId).toBeUndefined();
        expect(repaired.state.nextRunAtMs).toBeUndefined();
        expect(runCommandJob).not.toHaveBeenCalled();
        cron.stop();
        await cron.start();
        expect((await loadCronStore(storePath)).jobs[0]).toEqual(repaired);
        const history = readCronRunHistoryPageForTests({
          storeKey: cronStoreKey(storePath),
          jobId: job.id,
        }).entries;
        expect(history).toHaveLength(1);
        expect(history[0]).toMatchObject({ jobId: job.id, status: "error", runAtMs: startedAtMs });
        expect(events.filter((event) => event.action === "finished")).toHaveLength(1);
        await expect(cron.run(job.id, "force")).resolves.toEqual({ ok: true, ran: true });
        expect(runCommandJob).toHaveBeenCalledOnce();
        expect(cron.getJob(job.id)?.state.lastRunStatus).toBe("ok");
      } finally {
        cron.stop();
      }
    },
  );

  it("coalesces missed intervals into one announced catch-up without replaying on restart", async () => {
    const { storePath } = await makeStorePath();
    const nowMs = Date.now();
    const dueAtMs = nowMs - 10 * 60_000;
    const job = makeCronRecoveryJob("overdue-interval", dueAtMs);
    delete job.state.runningAtMs;
    await writeCronStoreSnapshot({ storePath, jobs: [job] });
    const events: CronEvent[] = [];
    const { cron, runCommandJob } = service(storePath, nowMs, events);
    try {
      await cron.start();
      expect(runCommandJob).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith(
        { count: 1, jobIds: [job.id] },
        "cron: running missed jobs after restart",
      );
      const completed = (await loadCronStore(storePath)).jobs[0]!;
      expect(completed.state.lastRunStatus).toBe("ok");
      expect(completed.state.runningAtMs).toBeUndefined();
      expect(completed.state.nextRunAtMs).toBe(nowMs + 60_000);
      cron.stop();
      await cron.start();
      expect(runCommandJob).toHaveBeenCalledOnce();
      expect(events.filter((event) => event.action === "finished")).toHaveLength(1);
      expect((await loadCronStore(storePath)).jobs[0]).toEqual(completed);
    } finally {
      cron.stop();
    }
  });
});

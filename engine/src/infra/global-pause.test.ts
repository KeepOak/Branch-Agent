// AUTOMATION-0026: ported from elizaOS/eliza global-pause store.test.ts and service.test.ts,
// plus the Branch callers (cron timer, heartbeat runner) that consult the pause.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCronRegressionState,
  createDueIsolatedJob,
} from "../../test/helpers/cron/service-regression-fixtures.js";
import type { BranchConfig } from "../config/config.js";
import { armTimer, stopTimer } from "../cron/service/timer.js";
import { systemHandlers } from "../gateway/server-methods/system.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { createGlobalPauseStore, readGlobalPause } from "./global-pause.js";
import { getLastHeartbeatEvent, resetHeartbeatEventsForTest } from "./heartbeat-events.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeBranchStateDatabaseAsync();
});

describe("global-pause-store", () => {
  it("manages pause window lifecycle and status correctly", async () => {
    await withBranchTestState({ label: "global-pause-lifecycle" }, async () => {
      const store = createGlobalPauseStore();

      // Initially inactive
      expect(store.current().active).toBe(false);

      // Set pause window for vacation
      const start = new Date(Date.now() - 10000).toISOString();
      const end = new Date(Date.now() + 60000).toISOString();
      store.set({ startIso: start, endIso: end, reason: "On vacation in Paris" });

      const activeStatus = store.current();
      expect(activeStatus).toEqual({
        active: true,
        startIso: start,
        endIso: end,
        reason: "On vacation in Paris",
      });

      // Check status after window ends
      expect(store.current(new Date(Date.now() + 100000)).active).toBe(false);

      // Clear window
      store.clear();
      expect(store.current().active).toBe(false);
    });
  });

  it("validates startIso and endIso ordering", async () => {
    await withBranchTestState({ label: "global-pause-validate" }, async () => {
      const store = createGlobalPauseStore();

      // Invalid start ISO
      expect(() => store.set({ startIso: "not-a-date" })).toThrowError(/invalid startIso/);

      // endIso before startIso
      expect(() =>
        store.set({ startIso: "2026-08-20T10:00:00Z", endIso: "2026-08-19T10:00:00Z" }),
      ).toThrowError(/endIso must be strictly after startIso/);
    });
  });

  it("set + current + clear lifecycle survives a reopened store", async () => {
    await withBranchTestState({ label: "global-pause-reopen" }, async () => {
      expect(readGlobalPause(Date.now()).active).toBe(false);
      const startIso = new Date(Date.now() - 60_000).toISOString();
      const endIso = new Date(Date.now() + 86_400_000).toISOString();
      createGlobalPauseStore().set({ startIso, endIso, reason: "  vacation  " });

      const active = readGlobalPause(Date.now());
      expect(active).toMatchObject({ active: true, reason: "vacation", startIso, endIso });
      expect(readGlobalPause(Date.parse(endIso) + 1).active).toBe(false);

      createGlobalPauseStore().clear();
      expect(readGlobalPause(Date.now()).active).toBe(false);
    });
  });
});

describe("global pause callers", () => {
  it("is switched on and off through the system.pause gateway methods", async () => {
    await withBranchTestState({ label: "global-pause-gateway" }, async () => {
      const call = async (method: string, params: Record<string, unknown> = {}) => {
        const handler = systemHandlers[method];
        if (!handler) {
          throw new Error(`missing ${method}`);
        }
        const respond = vi.fn();
        await handler({ params, respond } as unknown as Parameters<typeof handler>[0]);
        return respond.mock.calls[0] as [boolean, unknown, unknown];
      };
      const endIso = new Date(Date.now() + 3_600_000).toISOString();
      const [setOk, setStatus] = await call("system.pause.set", { endIso, reason: "travel" });
      expect(setOk).toBe(true);
      expect(setStatus).toMatchObject({ active: true, endIso, reason: "travel" });
      expect((await call("system.pause.get"))[1]).toMatchObject({ active: true });
      const [badOk] = await call("system.pause.set", { endIso: "not-a-date" });
      expect(badOk).toBe(false);
      expect((await call("system.pause.clear"))[1]).toEqual({ active: false });
    });
  });

  it("holds a due scheduled job until the pause window ends", async () => {
    await withBranchTestState({ label: "global-pause-cron" }, async () => {
      const now = Date.parse("2026-08-13T18:00:00.000Z");
      const state = createCronRegressionState({
        storePath: "/tmp/global-pause-cron.json",
        nowMs: () => now,
        runIsolatedAgentJob: vi.fn(),
      });
      state.store = {
        version: 1,
        jobs: [createDueIsolatedJob({ id: "due-job", nowMs: now, nextRunAtMs: now })],
      };
      const schedule = vi.spyOn(state.deps.scheduler, "schedule");
      try {
        armTimer(state);
        // Past-due work normally re-fires after the 2s refire floor.
        expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ delayMs: 2_000 }));

        createGlobalPauseStore().set({
          startIso: new Date(now - 1_000).toISOString(),
          endIso: new Date(now + 30_000).toISOString(),
        });
        armTimer(state);
        expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ delayMs: 30_000 }));
      } finally {
        stopTimer(state);
      }
    });
  });

  it("skips proactive check-ins while paused", async () => {
    await withBranchTestState({ label: "global-pause-heartbeat" }, async () => {
      resetHeartbeatEventsForTest();
      const now = Date.UTC(2025, 0, 1, 12, 0, 0);
      createGlobalPauseStore().set({
        startIso: new Date(now - 60_000).toISOString(),
        reason: "vacation",
      });
      const cfg: BranchConfig = {
        agents: { defaults: { userTimezone: "UTC", heartbeat: { every: "30m" } } },
      };
      await expect(
        runHeartbeatOnce({
          cfg,
          source: "interval",
          intent: "task",
          reason: "heartbeat-task:job-inbox",
          tasks: [{ jobId: "job-inbox", name: "inbox", prompt: "Check inbox" }],
          deps: { nowMs: () => now },
        }),
      ).resolves.toEqual({ status: "skipped", reason: "global-pause" });
      expect(getLastHeartbeatEvent()).toMatchObject({ status: "skipped", reason: "global-pause" });
    });
  });
});

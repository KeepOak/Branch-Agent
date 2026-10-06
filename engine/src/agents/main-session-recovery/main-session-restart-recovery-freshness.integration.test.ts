import { beforeEach, expect, it, vi } from "vitest";
import * as sessionAccessor from "../../config/sessions/session-accessor.js";
import { loadSessionEntry, replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { callGateway } from "../../gateway/call.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { createRecoveryRuntimeFixture } from "./main-session-recovery-runtime.test-support.js";
import { recoverRestartAbortedMainSessions } from "./main-session-restart-recovery-runtime.js";

vi.mock("../../gateway/call.js", () => ({ callGateway: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

it("does not dispatch a restart continuation for an expired pending mark", async () => {
  await withBranchTestState({ label: "recovery-expired-pending" }, async (state) => {
    const sessionKey = "agent:main:main";
    const sessionId = "expired-session";
    const now = Date.now();
    await replaceSessionEntry(
      { sessionKey },
      {
        sessionId,
        updatedAt: now - 2 * 60 * 60_000,
        status: "running",
        abortedLastRun: true,
        mainRestartRecovery: {
          cycleId: "expired-cycle",
          revision: 1,
          chargedAttempts: 0,
          interruptedAt: now - 2 * 60 * 60_000,
          turnStartedAt: now - 60_000,
        },
      },
    );
    const gatewayRuntime = createRecoveryRuntimeFixture({
      callGateway,
      getDispatchSettlement: () => Promise.resolve(),
      sendRecoveryNotice: vi.fn(async () => ({ suppressed: false })),
    });

    const result = await recoverRestartAbortedMainSessions({
      stateDir: state.stateDir,
      gatewayRuntime,
    });

    expect(result).toEqual({ started: 0, settled: 0, failed: 0, skipped: 1 });
    expect(callGateway).not.toHaveBeenCalled();
    expect(loadSessionEntry({ sessionKey })).toMatchObject({
      status: "failed",
      abortedLastRun: false,
    });
  });
});

it("dispatches a fresh mark even when its in-flight turn began two hours ago", async () => {
  await withBranchTestState({ label: "recovery-fresh-pending" }, async (state) => {
    const sessionKey = "agent:main:main";
    const now = Date.now();
    await replaceSessionEntry(
      { sessionKey },
      {
        sessionId: "fresh-session",
        updatedAt: now,
        status: "running",
        abortedLastRun: true,
        mainRestartRecovery: {
          cycleId: "fresh-cycle",
          revision: 1,
          chargedAttempts: 0,
          interruptedAt: now - 60_000,
          turnStartedAt: now - 2 * 60 * 60_000,
        },
      },
    );
    const gatewayRuntime = createRecoveryRuntimeFixture({
      callGateway,
      getDispatchSettlement: () => Promise.resolve(),
      sendRecoveryNotice: vi.fn(async () => ({ suppressed: false })),
    });
    const result = await recoverRestartAbortedMainSessions({
      stateDir: state.stateDir,
      gatewayRuntime,
    });
    expect(result.started).toBe(1);
    expect(callGateway).toHaveBeenCalledTimes(1);
  });
});

it("persists a normalized interruption time for a corrupt recovery mark", async () => {
  await withBranchTestState({ label: "recovery-corrupt-mark" }, async (state) => {
    const sessionKey = "agent:main:main";
    await replaceSessionEntry(
      { sessionKey },
      {
        sessionId: "corrupt-session",
        updatedAt: Date.now(),
        status: "running",
        abortedLastRun: true,
        mainRestartRecovery: {
          cycleId: "corrupt-cycle",
          revision: 1,
          chargedAttempts: 0,
          interruptedAt: "not-a-number" as unknown as number,
        },
      },
    );
    const gatewayRuntime = createRecoveryRuntimeFixture({
      callGateway,
      getDispatchSettlement: () => Promise.resolve(),
      sendRecoveryNotice: vi.fn(async () => ({ suppressed: false })),
    });
    const before = Date.now();
    await recoverRestartAbortedMainSessions({
      stateDir: state.stateDir,
      gatewayRuntime,
    });
    const recovered = loadSessionEntry({ sessionKey })?.mainRestartRecovery;
    expect(recovered?.interruptedAt).toBeGreaterThanOrEqual(before);
    expect(recovered?.interruptedAt).toBeLessThanOrEqual(Date.now());
    expect(recovered?.revision).toBe(2);
  });
});

it("settles an expired mark whose final reply was already persisted for delivery", async () => {
  await withBranchTestState({ label: "recovery-expired-persisted-final" }, async (state) => {
    const sessionKey = "agent:main:main";
    const now = Date.now();
    await replaceSessionEntry(
      { sessionKey },
      {
        sessionId: "persisted-final-session",
        updatedAt: now,
        status: "running",
        abortedLastRun: true,
        mainRestartRecovery: {
          cycleId: "persisted-final-cycle",
          revision: 1,
          chargedAttempts: 0,
          interruptedAt: now - 2 * 60 * 60_000,
        },
        pendingFinalDelivery: {
          kind: "replayable",
          text: "The answer was already prepared.",
          createdAt: now - 2 * 60 * 60_000,
          intentId: "persisted-final-intent",
          deliveries: [{ id: "persisted-final-delivery", state: "delivered" }],
        },
      },
    );
    const gatewayRuntime = createRecoveryRuntimeFixture({
      callGateway,
      getDispatchSettlement: () => Promise.resolve(),
      sendRecoveryNotice: vi.fn(async () => ({ suppressed: false })),
    });
    expect(
      await recoverRestartAbortedMainSessions({ stateDir: state.stateDir, gatewayRuntime }),
    ).toEqual({ started: 0, settled: 1, failed: 0, skipped: 0 });
    expect(callGateway).not.toHaveBeenCalled();
    expect(loadSessionEntry({ sessionKey })).toMatchObject({ status: "done", abortedLastRun: false });
    expect(loadSessionEntry({ sessionKey })?.pendingFinalDelivery).toBeUndefined();
  });
});

it("does not re-send a previous answer after a process timezone change", async () => {
  await withBranchTestState({ label: "recovery-timezone-prior-answer" }, async (state) => {
    const sessionKey = "agent:main:main";
    const priorTz = process.env.TZ;
    try {
      process.env.TZ = "Etc/GMT+7";
      const startedAt = Date.now() - 60_000;
      await replaceSessionEntry(
        { sessionKey },
        {
          sessionId: "timezone-prior-answer",
          updatedAt: startedAt,
          startedAt,
          status: "running",
          abortedLastRun: true,
          mainRestartRecovery: {
            cycleId: "timezone-prior-answer-cycle",
            revision: 1,
            chargedAttempts: 0,
            interruptedAt: startedAt,
            turnStartedAt: startedAt,
          },
          pendingFinalDelivery: {
            kind: "replayable",
            text: "The previous answer was already sent.",
            createdAt: startedAt,
            intentId: "timezone-prior-answer-intent",
            deliveries: [{ id: "timezone-prior-answer-delivery", state: "delivered" }],
          },
        },
      );
      process.env.TZ = "UTC";
      const gatewayRuntime = createRecoveryRuntimeFixture({
        callGateway,
        getDispatchSettlement: () => Promise.resolve(),
        sendRecoveryNotice: vi.fn(async () => ({ suppressed: false })),
      });
      expect(
        await recoverRestartAbortedMainSessions({ stateDir: state.stateDir, gatewayRuntime }),
      ).toEqual({ started: 0, settled: 1, failed: 0, skipped: 0 });
      expect(callGateway).not.toHaveBeenCalled();
      expect(loadSessionEntry({ sessionKey })).toMatchObject({ status: "done", abortedLastRun: false });
    } finally {
      if (priorTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = priorTz;
      }
    }
  });
});

it.each(["revision", "reservation", "foregroundClaims"] as const)(
  "does not retire an expired mark after a concurrent %s update",
  async (change) => {
    await withBranchTestState({ label: `recovery-expired-cas-${change}` }, async (state) => {
      const sessionKey = "agent:main:main";
      const now = Date.now();
      await replaceSessionEntry(
        { sessionKey },
        {
          sessionId: "cas-session",
          updatedAt: now,
          status: "running",
          abortedLastRun: true,
          mainRestartRecovery: {
            cycleId: "cas-cycle",
            revision: 1,
            chargedAttempts: 0,
            interruptedAt: now - 2 * 60 * 60_000,
          },
        },
      );
      const update = sessionAccessor.updateSessionEntry;
      const spy = vi.spyOn(sessionAccessor, "updateSessionEntry").mockImplementationOnce(
        async (scope, patch, options) => {
          await update(scope, (current) => ({
            mainRestartRecovery: {
              ...current.mainRestartRecovery!,
              ...(change === "revision" ? { revision: 2 } : {}),
              ...(change === "reservation"
                ? { reservation: { runId: "new-owner", attempt: 1, lifecycleGeneration: "new" } }
                : {}),
              ...(change === "foregroundClaims"
                ? { foregroundClaims: { lifecycleGeneration: "new", tokens: ["new-owner"] } }
                : {}),
            },
          }));
          return update(scope, patch, options);
        },
      );
      try {
        const gatewayRuntime = createRecoveryRuntimeFixture({
          callGateway,
          getDispatchSettlement: () => Promise.resolve(),
          sendRecoveryNotice: vi.fn(async () => ({ suppressed: false })),
        });
        expect(
          await recoverRestartAbortedMainSessions({ stateDir: state.stateDir, gatewayRuntime }),
        ).toEqual({ started: 0, settled: 0, failed: 0, skipped: 1 });
        expect(loadSessionEntry({ sessionKey })).toMatchObject({
          status: "running",
          abortedLastRun: true,
          mainRestartRecovery: { cycleId: "cas-cycle" },
        });
      } finally {
        spy.mockRestore();
      }
    });
  },
);

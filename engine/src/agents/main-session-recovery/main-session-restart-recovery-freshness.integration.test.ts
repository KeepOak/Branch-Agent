import { expect, it, vi } from "vitest";
import { loadSessionEntry, replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { callGateway } from "../../gateway/call.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { createRecoveryRuntimeFixture } from "./main-session-recovery-runtime.test-support.js";
import { recoverRestartAbortedMainSessions } from "./main-session-restart-recovery-runtime.js";

vi.mock("../../gateway/call.js", () => ({ callGateway: vi.fn() }));

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

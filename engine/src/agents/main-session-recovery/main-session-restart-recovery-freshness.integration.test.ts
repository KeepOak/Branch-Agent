import { expect, it, vi } from "vitest";
import { loadSessionEntry, replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { callGateway } from "../../gateway/call.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { createRecoveryRuntimeFixture } from "./main-session-recovery-runtime.test-support.js";
import { recoverRestartAbortedMainSessions } from "./main-session-restart-recovery-runtime.js";

vi.mock("../../gateway/call.js", () => ({ callGateway: vi.fn() }));

it.each(["expired pending mark", "ancient in-flight turn"] as const)(
  "does not dispatch a restart continuation for an %s",
  async (scenario) => {
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
            interruptedAt:
              scenario === "expired pending mark" ? now - 2 * 60 * 60_000 : now - 60_000,
            turnStartedAt:
              scenario === "ancient in-flight turn" ? now - 2 * 60 * 60_000 : now - 60_000,
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
  },
);

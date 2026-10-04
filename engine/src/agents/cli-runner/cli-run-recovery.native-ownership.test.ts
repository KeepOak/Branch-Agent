import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildPreparedCliRunContext } from "../cli-runner.test-helpers.js";
import { FailoverError } from "../failover-error.js";
import { runWithModelFallback } from "../model-fallback-runner.js";
import { runCliRecovery } from "./cli-run-recovery.js";
describe("native-account turn never replays after launch", () => {
  it.each([
    { reason: "session_expired" as const, code: "expired" },
    { reason: "timeout" as const, code: "cli_no_output_timeout" },
    { reason: "rate_limit" as const, code: "quota" },
  ])("terminates $reason once with source ownership intact", async ({ reason, code }) => {
    const context = buildPreparedCliRunContext({
      sessionKey: "agent:fixture:main",
      timeoutMs: 60_000,
    });
    context.nativeConfigDir = path.resolve("account-a");
    context.reusableCliSession = { mode: "reuse", sessionId: "owned-thread" };
    context.branchHistoryPrompt = "settled history";
    context.preparedBackend.backend.forkArg = "--fork-session";
    context.preparedBackend.backend.resumeAtArg = "--resume-session-at";
    context.params.cliSessionBinding = {
      sessionId: "owned-thread",
      nativeConfigDir: context.nativeConfigDir,
      resumeCheckpointId: "checkpoint",
    };
    context.params.onBeforeForkedCliSessionRetry = vi.fn(async () => true);
    context.params.onBeforeFreshCliSessionRetry = vi.fn(async () => true);
    const error = new FailoverError("fixture-error", { reason, code });
    const executeAttempt = vi.fn(async () => {
      throw error;
    });
    const terminal = vi.fn(async () => {});
    await expect(
      runCliRecovery({
        context,
        executeAttempt,
        finishAttempt: vi.fn(),
        finishDeliveredFailure: vi.fn(async () => undefined),
        onTerminalFailure: terminal,
      }),
    ).rejects.toBe(error);
    expect(executeAttempt).toHaveBeenCalledExactlyOnceWith("owned-thread", undefined);
    expect(terminal).toHaveBeenCalledExactlyOnceWith(error);
    expect(context.params.onBeforeForkedCliSessionRetry).not.toHaveBeenCalled();
    expect(context.params.onBeforeFreshCliSessionRetry).not.toHaveBeenCalled();
    expect(context.params.cliSessionBinding.sessionId).toBe("owned-thread");
  });
});

describe("native terminal failure fences the outer model fallback", () => {
  it.each(["none", "terminal", "delivered"])(
    "does not replay via an alternate model even when cleanup phase=%s",
    async (cleanupPhase) => {
      const context = buildPreparedCliRunContext({
        sessionKey: "agent:fixture:main",
        timeoutMs: 60000,
      });
      context.nativeConfigDir = path.resolve("account-a");
      context.reusableCliSession = { mode: "reuse", sessionId: "owned-thread" };
      const error = Object.freeze(
        new FailoverError("fixture quota exhausted", { reason: "rate_limit", code: "quota" }),
      );
      const terminalError = cleanupPhase !== "none" ? new Error("fixture cleanup failed") : error;
      const executeAttempt = vi.fn(async () => {
        throw error;
      });
      const run = vi.fn(async () =>
        runCliRecovery({
          context,
          executeAttempt,
          finishAttempt: vi.fn(),
          finishDeliveredFailure: async () => {
            if (cleanupPhase === "delivered") throw terminalError;
            return undefined;
          },
          onTerminalFailure: async () => {
            if (cleanupPhase === "terminal") throw terminalError;
          },
        }),
      );
      await expect(
        runWithModelFallback({
          cfg: undefined,
          provider: "fixture-primary",
          model: "fixture-model",
          manifestPlugins: [],
          fallbacksOverride: ["fixture-next/fixture-model"],
          run,
        }),
      ).rejects.toBe(terminalError);
      expect(run).toHaveBeenCalledOnce();
      expect(executeAttempt).toHaveBeenCalledOnce();
    },
  );
});

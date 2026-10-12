import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHandoffRetryWait } from "../agents/embedded-agent-runner/retry-handoff.js";
import { captureAgentRunLifecycleGeneration } from "../infra/agent-events.js";
import { isGatewayHandoffFatalError } from "./server-handoff-error.js";
import { createGatewayRunHandoff } from "./server-run-handoff.js";

const mocks = vi.hoisted(() => ({
  admission: { commit: vi.fn(() => true), release: vi.fn(), rollback: vi.fn() },
  leases: {
    seal: vi.fn(),
    releaseAll: vi.fn(),
    released: Promise.resolve(),
    deadline: new Promise<boolean>(() => {}),
    expiresAt: undefined,
  },
}));
vi.mock("../config/io.js", () => ({ getRuntimeConfig: () => ({}) }));
vi.mock("../channels/plugins/registry-loaded.js", () => ({
  listLoadedChannelPluginsForRegistry: () => [],
}));
vi.mock("../cron/maintenance.js", () => ({ startCronMaintenance: vi.fn() }));
vi.mock("../cron/store/receipt-authority-owner.js", () => ({
  beginCronReceiptAuthorityClose: vi.fn(),
  drainCronReceiptAuthority: vi.fn(),
  releaseCronReceiptAuthorityForHandoff: vi.fn(),
  resumeCronReceiptAuthorityHostAfterFailedHandoff: vi.fn(),
}));
vi.mock("../process/gateway-work-admission.js", () => ({
  getActiveGatewayRootWorkCount: () => 0,
  isGatewayRestartDraining: () => false,
  tryBeginGatewaySuspendAdmission: () => mocks.admission,
}));
vi.mock("../process/session-handoff-lease-holder.js", () => ({
  holdSessionHandoffLeases: () => mocks.leases,
  isSessionLaneBusy: () => false,
  listBusySessionLanes: () => [],
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function createHandoffFixture(
  cron: { start: () => unknown; stopAndDrainForHandoff: () => unknown },
  chatAbortControllers = new Map<string, { sessionKey: string }>(),
) {
  const persist = vi.fn(async () => ({ marked: 1 }));
  const channelManager = { startChannels: vi.fn(), stopChannel: vi.fn() };
  const handoff = createGatewayRunHandoff({
    runtime: {
      channelManager,
      chatAbortControllers,
      pluginRuntime: { registry: {} },
      resolvePluginGatewayContext: vi.fn(),
      scheduler: {},
    } as unknown as Parameters<typeof createGatewayRunHandoff>[0]["runtime"],
    shutdownRuntime: {
      markRestartAbortedMainSessions: persist,
      stopCronMaintenance: vi.fn(),
    } as unknown as Parameters<typeof createGatewayRunHandoff>[0]["shutdownRuntime"],
    getCron: () =>
      cron as unknown as ReturnType<Parameters<typeof createGatewayRunHandoff>[0]["getCron"]>,
  });
  return { handoff, persist, channelManager };
}

describe("Gateway quiet-run handoff state transfer", () => {
  it.each([true, false])(
    "retires the waiting owner only after successful state release (%s)",
    async (released) => {
      const runId = "state-release-retry";
      const abort = vi.fn();
      const wait = registerHandoffRetryWait({
        runId,
        sessionId: "session",
        sessionKey: "agent:main:main",
        lifecycleGeneration: captureAgentRunLifecycleGeneration(runId),
        deadlineAtMs: Date.now() + 30 * 60 * 60 * 1000,
        isCurrent: () => true,
        abort,
      });
      const persist = vi.fn(async () => ({ marked: 1 }));
      const cron = { start: vi.fn(), stopAndDrainForHandoff: vi.fn() };
      const handoff = createGatewayRunHandoff({
        runtime: {
          channelManager: { startChannels: vi.fn(), stopChannel: vi.fn() },
          chatAbortControllers: new Map(),
          pluginRuntime: { registry: {} },
          resolvePluginGatewayContext: vi.fn(),
          scheduler: {},
        } as unknown as Parameters<typeof createGatewayRunHandoff>[0]["runtime"],
        shutdownRuntime: {
          markRestartAbortedMainSessions: persist,
          stopCronMaintenance: vi.fn(),
        } as unknown as Parameters<typeof createGatewayRunHandoff>[0]["shutdownRuntime"],
        getCron: () =>
          cron as unknown as ReturnType<Parameters<typeof createGatewayRunHandoff>[0]["getCron"]>,
      });
      try {
        await handoff.deactivate();
        expect(persist).toHaveBeenCalledOnce();
        expect(abort).not.toHaveBeenCalled();
        if (released) {
          handoff.commitStateRelease();
        } else {
          await handoff.restoreFailedStateRelease();
          expect(cron.start).toHaveBeenCalledOnce();
          expect(mocks.admission.rollback).toHaveBeenCalledOnce();
        }
        await wait.finish();
        expect(abort).toHaveBeenCalledTimes(released ? 1 : 0);
      } finally {
        handoff.release();
        wait.release();
      }
    },
  );
});

describe("Gateway handoff deactivation overrun", () => {
  it("aborts the handoff and keeps the old engine serving when a step overruns the deadline", async () => {
    vi.useFakeTimers();
    const runId = "deactivation-overrun";
    const abort = vi.fn();
    const wait = registerHandoffRetryWait({
      runId,
      sessionId: "session",
      sessionKey: "agent:main:main",
      lifecycleGeneration: captureAgentRunLifecycleGeneration(runId),
      deadlineAtMs: Date.now() + 30 * 60 * 60 * 1000,
      isCurrent: () => true,
      abort,
    });
    // A loaded host: cron drain needs 25 s, past the 18 s base deadline but it does finish.
    const cron = {
      start: vi.fn(),
      stopAndDrainForHandoff: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 25_000);
          }),
      ),
    };
    const { handoff, channelManager } = createHandoffFixture(cron);
    try {
      const outcome = handoff.deactivate().then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(18_000);
      // The overrunning drain is still running: nothing may be restarted under it yet.
      expect(cron.start).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(7_000);
      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(isGatewayHandoffFatalError(error)).toBe(false);
      expect(String(error)).toContain("exceeded 18 seconds");
      expect(String(error)).toContain("0 active run(s), 0 queued session write(s)");
      expect(String(error)).toContain("this engine keeps serving");
      // The old engine took its producers back and reopened admission: it keeps serving.
      expect(cron.start).toHaveBeenCalledOnce();
      expect(channelManager.startChannels).toHaveBeenCalledOnce();
      expect(mocks.leases.releaseAll).toHaveBeenCalled();
      expect(mocks.admission.release).toHaveBeenCalledOnce();
      expect(mocks.admission.rollback).toHaveBeenCalledOnce();
      expect(mocks.admission.commit).not.toHaveBeenCalled();
      // The in-flight run is never retired by an aborted handoff.
      await wait.finish();
      expect(abort).not.toHaveBeenCalled();
    } finally {
      handoff.release();
      wait.release();
    }
  });

  it("stays fatal when the overrunning step never settles", async () => {
    vi.useFakeTimers();
    const cron = {
      start: vi.fn(),
      stopAndDrainForHandoff: vi.fn(() => new Promise<void>(() => {})),
    };
    const { handoff } = createHandoffFixture(cron);
    try {
      const outcome = handoff.deactivate().then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(60_000);
      const error = await outcome;
      expect(isGatewayHandoffFatalError(error)).toBe(true);
      expect(cron.start).not.toHaveBeenCalled();
      expect(mocks.admission.rollback).not.toHaveBeenCalled();
    } finally {
      handoff.release();
    }
  });

  it("gives a loaded engine a larger budget, so a slow drain still hands off", async () => {
    vi.useFakeTimers();
    // Three active runs: 18 s + 3 x 2 s = 24 s. A 22 s cron drain fits.
    const cron = {
      start: vi.fn(),
      stopAndDrainForHandoff: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 22_000);
          }),
      ),
    };
    const runs = new Map(
      ["a", "b", "c"].map((id) => [id, { sessionKey: `agent:${id}:main` }] as const),
    );
    const { handoff } = createHandoffFixture(cron, runs);
    try {
      expect(handoff.resolveDeactivationDeadline()).toMatchObject({
        budgetMs: 24_000,
        reason: "3 active run(s), 0 queued session write(s)",
      });
      const outcome = handoff.deactivate().then(
        () => "deactivated",
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(22_000);
      await expect(outcome).resolves.toBe("deactivated");
      expect(mocks.admission.commit).toHaveBeenCalledOnce();
      expect(cron.start).not.toHaveBeenCalled();
    } finally {
      handoff.release();
    }
  });
});

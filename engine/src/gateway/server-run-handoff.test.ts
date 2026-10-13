import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHandoffRetryWait } from "../agents/embedded-agent-runner/retry-handoff.js";
import { captureAgentRunLifecycleGeneration } from "../infra/agent-events.js";
import { GatewayHandoffDeadlineError } from "./server-handoff-deadline.js";
import { GatewayHandoffFatalError } from "./server-handoff-error.js";
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

function handoffWithCron(cron: { start: () => unknown; stopAndDrainForHandoff: () => unknown }) {
  return createGatewayRunHandoff({
    runtime: {
      channelManager: { startChannels: vi.fn(), stopChannel: vi.fn() },
      chatAbortControllers: new Map(),
      pluginRuntime: { registry: {} },
      resolvePluginGatewayContext: vi.fn(),
      scheduler: {},
    } as unknown as Parameters<typeof createGatewayRunHandoff>[0]["runtime"],
    shutdownRuntime: {
      markRestartAbortedMainSessions: vi.fn(async () => ({ marked: 1 })),
      stopCronMaintenance: vi.fn(),
    } as unknown as Parameters<typeof createGatewayRunHandoff>[0]["shutdownRuntime"],
    getCron: () =>
      cron as unknown as ReturnType<Parameters<typeof createGatewayRunHandoff>[0]["getCron"]>,
  });
}

describe("Gateway handoff deactivation deadline (#481)", () => {
  it("aborts an overrun step-down and keeps this engine serving instead of a fatal exit", async () => {
    vi.useFakeTimers();
    // A loaded host: the cron drain takes 25 s against the 18 s deadline, then finishes.
    const cron = {
      start: vi.fn(),
      stopAndDrainForHandoff: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 25_000);
          }),
      ),
    };
    const handoff = handoffWithCron(cron);
    const deactivation = handoff.deactivate(Date.now() + 18_000, 18_000);
    const outcome = deactivation.then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(25_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(GatewayHandoffDeadlineError);
    expect(error).not.toBeInstanceOf(GatewayHandoffFatalError);
    expect(String(error)).toContain("exceeded 18 seconds at cron drain");
    // The late drain finished first; then every producer came back and admission reopened.
    expect(cron.start).toHaveBeenCalledOnce();
    expect(mocks.leases.releaseAll).toHaveBeenCalled();
    expect(mocks.admission.release).toHaveBeenCalledOnce();
    expect(mocks.admission.rollback).toHaveBeenCalledOnce();
    expect(mocks.admission.commit).not.toHaveBeenCalled();
    handoff.release();
  });

  it("stays fenced and fatal only when the overrun step never settles", async () => {
    vi.useFakeTimers();
    const cron = {
      start: vi.fn(),
      stopAndDrainForHandoff: vi.fn(() => new Promise<void>(() => {})),
    };
    const handoff = handoffWithCron(cron);
    const outcome = handoff.deactivate(Date.now() + 18_000, 18_000).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(36_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(GatewayHandoffFatalError);
    expect(String(error)).toContain("never settled");
    expect(cron.start).not.toHaveBeenCalled();
    expect(mocks.admission.rollback).not.toHaveBeenCalled();
    handoff.release();
  });
});

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

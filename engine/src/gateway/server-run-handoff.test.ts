import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHandoffRetryWait } from "../agents/embedded-agent-runner/retry-handoff.js";
import { captureAgentRunLifecycleGeneration } from "../infra/agent-events.js";
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

afterEach(() => vi.clearAllMocks());

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

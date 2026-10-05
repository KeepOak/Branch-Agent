import { expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { createTestGatewayScheduler } from "../test-utils/gateway-scheduler-clock.js";
import { buildGatewayReloadPlan } from "./config-reload-plan.js";
import type { GatewayCronState } from "./server-cron.js";
import type { GatewayReloadHandlerParams } from "./server-reload-contracts.js";

vi.mock("../agents/prepared-model-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/prepared-model-runtime.js")>()),
  markPreparedModelRuntimeSnapshotsStale: vi.fn(),
  rejectPendingPreparedModelRuntimeReplacement: vi.fn(),
  refreshPreparedModelRuntimeSnapshots: vi.fn(async () => {}),
}));
vi.mock("../agents/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agents/context.js")>()),
  refreshContextWindowCache: vi.fn(async () => {}),
}));
vi.mock("../hooks/loader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/loader.js")>()),
  prepareInternalHooks: vi.fn(async () => ({ commit: vi.fn() })),
}));

const { createGatewayReloadHandlers } = await import("./server-reload-hot.js");

it("keeps an added agent hot when system-job convergence schedules a retry", async () => {
  const reconcileSystemJobs = vi.fn<GatewayCronState["reconcileSystemJobs"]>(
    async () => "retry-scheduled",
  );
  const cronState: GatewayCronState = {
    cron: { start: vi.fn(async () => {}), stop: vi.fn() } as never,
    storePath: "/tmp/cron.json",
    cronEnabled: true,
    reconcileExitWatchers: vi.fn(async () => {}),
    reconcileStreamWatchers: vi.fn(async () => {}),
    stopStreamWatchers: vi.fn(async () => {}),
    reconcileSystemJobs,
  };
  let state: ReturnType<GatewayReloadHandlerParams["getState"]> = {
    hooksConfig: null,
    hookClientIpConfig: { trustedProxies: [], allowRealIpFallback: false },
    heartbeatRunner: { stop: vi.fn(), updateConfig: vi.fn() },
    cronState,
  };
  const setState = vi.fn<GatewayReloadHandlerParams["setState"]>((value) => {
    state = value;
  });
  const requestRecoveryRestart = vi.fn(() => ({ status: "emitted" as const }));
  const handlers = createGatewayReloadHandlers({
    scheduler: createTestGatewayScheduler(),
    deps: {} as GatewayReloadHandlerParams["deps"],
    broadcast: vi.fn(),
    getState: () => state,
    setState,
    getPluginRegistry: () => createEmptyPluginRegistry(),
    startChannel: vi.fn(async () => new Map()),
    stopChannel: vi.fn(async () => {}),
    releaseChannelRouteHandoffs: vi.fn(),
    pruneInactiveChannelAccountState: vi.fn(),
    reloadPlugins: vi.fn<GatewayReloadHandlerParams["reloadPlugins"]>(async () => ({
      runtime: { operationId: "test-reload", generation: 1, pluginIds: [] },
      activeChannels: new Set(),
    })),
    logHooks: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    logChannels: { info: vi.fn(), error: vi.fn() },
    logCron: { error: vi.fn() },
    logReload: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    cronReconciliation: {
      arm: vi.fn(() => ({ complete: vi.fn(async () => {}) })),
      invalidate: vi.fn(),
    },
    requestRecoveryRestart,
  });
  const nextConfig: BranchConfig = { agents: { entries: { main: {}, newcomer: {} } } };
  try {
    expect(
      await handlers.applyHotReload(
        buildGatewayReloadPlan(["agents.entries.newcomer"]),
        nextConfig,
      ),
    ).toBe("applied");
    expect(setState).toHaveBeenCalledOnce();
    expect(reconcileSystemJobs).toHaveBeenCalledOnce();
    expect(requestRecoveryRestart).not.toHaveBeenCalled();
  } finally {
    handlers.stopRestartRetries();
  }
});

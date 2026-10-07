import { afterEach, expect, it, vi } from "vitest";
import {
  markPreparedModelRuntimeSnapshotsStale,
  refreshPreparedModelRuntimeSnapshots,
} from "../agents/prepared-model-runtime.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/io.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { createTestGatewayScheduler } from "../test-utils/gateway-scheduler-clock.js";
import { diffConfigPaths } from "./config-diff.js";
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

function createRosterHandlers(
  reconcileSystemJobs: GatewayCronState["reconcileSystemJobs"] = vi.fn(async () => "converged"),
) {
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
  return { handlers, setState, requestRecoveryRestart };
}

afterEach(() => {
  clearRuntimeConfigSnapshot();
  vi.clearAllMocks();
});

it("keeps an added agent hot when system-job convergence schedules a retry", async () => {
  const reconcileSystemJobs = vi.fn<GatewayCronState["reconcileSystemJobs"]>(
    async () => "retry-scheduled",
  );
  const { handlers, setState, requestRecoveryRestart } = createRosterHandlers(reconcileSystemJobs);
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

const rosterConfig: BranchConfig = {
  agents: {
    defaults: { model: "openai/gpt-5.5" },
    entries: { elm: {}, oak: { model: "anthropic/claude-sonnet-5" } },
  },
  bindings: [{ agentId: "oak", match: { channel: "telegram" } }],
  tools: { agentToAgent: { allow: ["elm", "oak"] } },
  mcp: { servers: { docs: { command: "npx", args: ["docs-mcp"] } } },
  skills: { entries: { summarize: { enabled: true } } },
};

function editRoster(mutate: (config: BranchConfig) => void): BranchConfig {
  const next = structuredClone(rosterConfig);
  mutate(next);
  return next;
}

it.each<{ change: string; next: BranchConfig; refreshed: string[] | null }>([
  {
    change: "Trunk add",
    next: editRoster((c) => {
      c.agents!.entries!.birch = { name: "Birch", model: "openai/gpt-5.5" };
      c.agents!.ownership = "explicit";
    }),
    refreshed: ["birch"],
  },
  {
    change: "Trunk remove",
    next: editRoster((c) => {
      delete c.agents!.entries!.oak;
      c.bindings = [];
      c.tools!.agentToAgent = { allow: ["elm"] };
    }),
    refreshed: ["oak"],
  },
  {
    change: "MCP server add",
    next: editRoster((c) => {
      c.mcp!.servers!.search = { url: "https://mcp.example.invalid/sse" };
    }),
    refreshed: null,
  },
  {
    change: "skill off",
    next: editRoster((c) => {
      c.skills!.entries!.summarize!.enabled = false;
    }),
    refreshed: null,
  },
  {
    change: "MCP Trunk limit",
    next: editRoster((c) => {
      c.tools!.deny = ["mcp__docs"];
    }),
    refreshed: null,
  },
])("hot-applies $change refreshing only the affected Trunks", async ({ next, refreshed }) => {
  setRuntimeConfigSnapshot(rosterConfig);
  const { handlers, requestRecoveryRestart } = createRosterHandlers();
  try {
    const plan = buildGatewayReloadPlan(diffConfigPaths(rosterConfig, next));
    expect(plan.restartGateway).toBe(false);
    expect(await handlers.applyHotReload(plan, next)).toBe("applied");
    expect(requestRecoveryRestart).not.toHaveBeenCalled();
    if (refreshed) {
      expect(refreshPreparedModelRuntimeSnapshots).toHaveBeenCalledOnce();
      expect(vi.mocked(refreshPreparedModelRuntimeSnapshots).mock.calls[0]?.[1]).toMatchObject({
        agentIds: new Set(refreshed),
      });
      expect(vi.mocked(markPreparedModelRuntimeSnapshotsStale).mock.calls[0]?.[1]).toMatchObject({
        agentIds: new Set(refreshed),
      });
    } else {
      expect(refreshPreparedModelRuntimeSnapshots).not.toHaveBeenCalled();
      expect(markPreparedModelRuntimeSnapshotsStale).not.toHaveBeenCalled();
    }
  } finally {
    handlers.stopRestartRetries();
  }
});

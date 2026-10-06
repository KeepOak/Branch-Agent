// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { diffConfigPaths } from "../gateway/config-diff.js";
import { buildGatewayReloadPlan } from "../gateway/config-reload-plan.js";
import { doesReloadAffectProviderAuth } from "../gateway/config-reload-recovery.js";
import {
  refreshModelRuntimeAfterHotReload,
  resolveModelRuntimeRefreshAgentIds,
} from "../gateway/server-reload-model-runtime-scope.js";
import {
  acquireAgentRunPreparedModelRuntime,
  advancePreparedModelRuntimeConfig,
  loadPublishedGatewayReplyDispatchRuntime,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";

const fixture = usePreparedModelRuntimeHarness({ label: "prepared-model-runtime-hot-apply" });
const { mocks } = fixture;

const previousConfig: BranchConfig = {
  agents: {
    defaults: { model: "openai/gpt-5" },
    entries: { elm: {}, oak: { model: "anthropic/claude-sonnet-5" } },
  },
  bindings: [{ agentId: "oak", match: { channel: "telegram" } }],
  mcp: { servers: { docs: { command: "npx", args: ["docs-mcp"] } } },
  skills: { entries: { summarize: { enabled: true } } },
};

function edit(mutate: (config: BranchConfig) => void): BranchConfig {
  const next = structuredClone(previousConfig);
  mutate(next);
  return next;
}

// Elm has an admitted run while each of these lands on another Trunk or a shared surface.
const changes: { kind: string; next: BranchConfig; agentIds: string[] }[] = [
  {
    kind: "Trunk add",
    next: edit((c) => {
      c.agents!.entries!.birch = { name: "Birch", model: "openai/gpt-5" };
      c.agents!.ownership = "explicit";
    }),
    agentIds: ["elm", "oak", "birch"],
  },
  {
    kind: "Trunk remove",
    next: edit((c) => {
      delete c.agents!.entries!.oak;
      c.bindings = [];
    }),
    agentIds: ["elm"],
  },
  {
    kind: "Trunk model change",
    next: edit((c) => {
      c.agents!.entries!.oak!.model = "openai/gpt-5";
    }),
    agentIds: ["elm", "oak"],
  },
  {
    kind: "MCP server add",
    next: edit((c) => {
      c.mcp!.servers!.search = { url: "https://mcp.example.invalid/sse" };
    }),
    agentIds: ["elm", "oak"],
  },
  {
    kind: "MCP server remove",
    next: edit((c) => {
      delete c.mcp!.servers!.docs;
    }),
    agentIds: ["elm", "oak"],
  },
  {
    kind: "skill off",
    next: edit((c) => {
      c.skills!.entries!.summarize!.enabled = false;
    }),
    agentIds: ["elm", "oak"],
  },
  {
    kind: "setting change",
    next: edit((c) => {
      c.logging = { level: "debug" };
    }),
    agentIds: ["elm", "oak"],
  },
];

const publicationOptions = {
  allowGatewaySubagentBinding: true,
  catalogMode: "static" as const,
  gatewayLifecycle: true,
};

function elmRunInput(config: BranchConfig) {
  return {
    agentId: "elm",
    agentDir: fixture.state.agentDir("elm"),
    allowGatewaySubagentBinding: true,
    config,
    runtimePluginSelections: [{ provider: "openai", modelId: "gpt-5", runtime: "branch" }],
    workspaceDir: "/tmp/workspace-elm",
  };
}

/** Mirrors the model runtime tail of the Gateway hot reload for one committed config. */
async function applyHotReload(next: BranchConfig, scope: "planned" | "every agent") {
  const changedPaths = diffConfigPaths(previousConfig, next);
  const plan = buildGatewayReloadPlan(changedPaths);
  expect(plan.restartGateway).toBe(false);
  if (!doesReloadAffectProviderAuth(plan, previousConfig, next)) {
    advancePreparedModelRuntimeConfig(next);
    return;
  }
  const agentIds =
    scope === "planned"
      ? resolveModelRuntimeRefreshAgentIds({
          changedPaths,
          reloadPlugins: plan.reloadPlugins,
          previousConfig,
          nextConfig: next,
        })
      : undefined;
  await refreshModelRuntimeAfterHotReload({
    config: next,
    agentIds,
    pluginMetadataSnapshot: undefined,
  });
}

async function admitElmRun() {
  mocks.configuredAgentIds = ["elm", "oak"];
  await refreshPreparedModelRuntimeSnapshots(previousConfig, publicationOptions);
  const admitted = await loadPublishedGatewayReplyDispatchRuntime({ agentId: "elm" });
  expect(admitted?.pluginGeneration).toBeDefined();
  return admitted!;
}

describe("hot-applied config keeps another Trunk's admitted run", () => {
  it.each(changes)("continues Elm's run across $kind", async ({ next, agentIds }) => {
    const admitted = await admitElmRun();
    mocks.configuredAgentIds = agentIds;
    await applyHotReload(next, "planned");

    const resumed = await acquireAgentRunPreparedModelRuntime(elmRunInput(previousConfig), {
      catalogMode: "static",
      pluginGeneration: admitted.pluginGeneration,
    });
    await resumed[Symbol.asyncDispose]();
    const republished = await loadPublishedGatewayReplyDispatchRuntime({ agentId: "elm" });
    expect(republished?.pluginGeneration).toBe(admitted.pluginGeneration);
  });

  it.each(changes.filter(({ kind }) => kind.startsWith("Trunk")))(
    "supersedes Elm's run when $kind refreshes every Trunk",
    async ({ next, agentIds }) => {
      const admitted = await admitElmRun();
      mocks.configuredAgentIds = agentIds;
      await applyHotReload(next, "every agent");

      await expect(
        acquireAgentRunPreparedModelRuntime(elmRunInput(previousConfig), {
          catalogMode: "static",
          pluginGeneration: admitted.pluginGeneration,
        }),
      ).rejects.toThrow("plugin generation was superseded");
    },
  );
});

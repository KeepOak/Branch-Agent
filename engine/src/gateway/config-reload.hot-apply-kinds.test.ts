import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../plugins/runtime.js";
import { diffGatewayReloadPaths } from "./config-diff.js";
import {
  buildGatewayReloadPlan,
  listConfigReloadRefinementPrefixes,
  resolveConfigReloadMetadata,
} from "./config-reload-plan.js";
import { doesReloadAffectProviderAuth } from "./config-reload-recovery.js";
import { resolveModelRuntimeRefreshAgentIds } from "./server-reload-model-runtime-scope.js";

// Config writes the window makes when adding or removing an MCP server, skill, plugin,
// account or Trunk, or when changing a setting. Each one must apply without a Gateway
// restart, and its model runtime refresh must leave unrelated Trunks' admitted runs alone.

const base: BranchConfig = {
  agents: {
    ownership: "explicit",
    defaults: { model: "openai/gpt-5.5", heartbeat: { every: "30m" } },
    entries: {
      elm: { name: "Elm", workspace: "/tmp/elm" },
      oak: { name: "Oak", workspace: "/tmp/oak", model: "anthropic/claude-sonnet-5" },
    },
  },
  bindings: [{ agentId: "oak", match: { channel: "telegram" } }],
  tools: { agentToAgent: { allow: ["elm", "oak"] } },
  mcp: { servers: { docs: { command: "npx", args: ["docs-mcp"] } } },
  skills: { entries: { summarize: { enabled: true } } },
  plugins: { entries: { "voice-call": { enabled: true } } },
  gateway: { port: 19741 },
  discovery: { mdns: { mode: "minimal" } },
};

function edit(mutate: (config: BranchConfig) => void): BranchConfig {
  const next = structuredClone(base);
  mutate(next);
  return next;
}

type Scope = "none" | "all" | readonly string[];

type HotApplyCase = {
  kind: "mcp" | "skill" | "plugin" | "account" | "trunk" | "setting";
  change: string;
  next: BranchConfig;
  scope: Scope;
  pluginLifecycle?: boolean;
};

const hotApplyCases: HotApplyCase[] = [
  {
    kind: "mcp",
    change: "add server",
    next: edit((c) => {
      c.mcp!.servers!.search = { url: "https://mcp.example.invalid/sse" };
    }),
    scope: "none",
  },
  {
    kind: "mcp",
    change: "remove server",
    next: edit((c) => {
      delete c.mcp!.servers!.docs;
    }),
    scope: "none",
  },
  {
    kind: "mcp",
    change: "turn server off",
    next: edit((c) => {
      c.mcp!.servers!.docs!.enabled = false;
    }),
    scope: "none",
  },
  {
    kind: "mcp",
    change: "limit which Trunks may use it",
    next: edit((c) => {
      c.tools!.deny = ["mcp__docs"];
    }),
    scope: "none",
  },
  {
    kind: "mcp",
    change: "turn MCP Apps on",
    next: edit((c) => {
      c.mcp!.apps = { enabled: true };
    }),
    scope: "none",
  },
  {
    kind: "skill",
    change: "turn skill off",
    next: edit((c) => {
      c.skills!.entries!.summarize!.enabled = false;
    }),
    scope: "none",
  },
  {
    kind: "skill",
    change: "add skill entry",
    next: edit((c) => {
      c.skills!.entries!.translate = { enabled: true };
    }),
    scope: "none",
  },
  {
    kind: "plugin",
    change: "install",
    next: edit((c) => {
      c.plugins!.entries!.github = { enabled: true };
      c.plugins!.load = { paths: ["/tmp/plugins/github"] };
    }),
    scope: "all",
    pluginLifecycle: true,
  },
  {
    kind: "plugin",
    change: "turn off from the plugins page",
    next: edit((c) => {
      c.plugins!.entries!["voice-call"]!.enabled = false;
    }),
    scope: "all",
    pluginLifecycle: true,
  },
  {
    kind: "plugin",
    change: "turn off from a settings row",
    next: edit((c) => {
      c.plugins!.entries!["voice-call"]!.enabled = false;
    }),
    scope: "all",
  },
  {
    kind: "plugin",
    change: "uninstall",
    next: edit((c) => {
      delete c.plugins!.entries!["voice-call"];
    }),
    scope: "all",
    pluginLifecycle: true,
  },
  {
    kind: "account",
    change: "add API key",
    next: edit((c) => {
      c.auth = {
        profiles: { "openai:work": { provider: "openai", mode: "api_key" } },
        order: { openai: ["openai:work"] },
      };
    }),
    scope: "all",
  },
  {
    kind: "account",
    change: "sign out",
    next: edit((c) => {
      c.auth = { profiles: {} };
    }),
    scope: "all",
  },
  {
    kind: "trunk",
    change: "add",
    next: edit((c) => {
      c.agents!.entries!.birch = {
        name: "Birch",
        workspace: "/tmp/birch",
        agentDir: "/tmp/agents/birch",
        model: "openai/gpt-5.5",
        identity: { name: "Birch" },
      };
    }),
    scope: ["birch"],
  },
  {
    kind: "trunk",
    change: "remove",
    next: edit((c) => {
      delete c.agents!.entries!.oak;
      c.bindings = [];
      c.tools!.agentToAgent = { allow: ["elm"] };
    }),
    scope: ["oak"],
  },
  {
    kind: "trunk",
    change: "change its model",
    next: edit((c) => {
      c.agents!.entries!.oak!.model = "openai/gpt-5.5";
    }),
    scope: ["oak"],
  },
  {
    kind: "trunk",
    change: "rename and restrict tools",
    next: edit((c) => {
      c.agents!.entries!.oak!.name = "Oak Two";
      c.agents!.entries!.oak!.tools = { deny: ["exec"] };
    }),
    scope: "none",
  },
  {
    kind: "setting",
    change: "logging level",
    next: edit((c) => {
      c.logging = { level: "debug" };
    }),
    scope: "none",
  },
  {
    kind: "setting",
    change: "heartbeat interval",
    next: edit((c) => {
      c.agents!.defaults!.heartbeat!.every = "45m";
    }),
    scope: "none",
  },
  {
    kind: "setting",
    change: "terminal and node pairing",
    next: edit((c) => {
      c.gateway = { ...c.gateway, terminal: { enabled: true }, nodes: { pairing: {} } };
    }),
    scope: "none",
  },
  {
    kind: "setting",
    change: "public origin",
    next: edit((c) => {
      c.gateway = { ...c.gateway, publicOrigin: "https://branch.example.invalid" };
    }),
    scope: "none",
  },
  {
    kind: "setting",
    change: "control UI allowed origins",
    next: edit((c) => {
      c.gateway = {
        ...c.gateway,
        controlUi: { allowedOrigins: ["https://branch.example.invalid"] },
      };
    }),
    scope: "none",
  },
  {
    kind: "setting",
    change: "local discovery mode",
    next: edit((c) => {
      c.discovery = { mdns: { mode: "off" } };
    }),
    scope: "none",
  },
  {
    kind: "setting",
    change: "default model",
    next: edit((c) => {
      c.agents!.defaults!.model = "anthropic/claude-sonnet-5";
    }),
    scope: "all",
  },
];

function planFor(next: BranchConfig, pluginLifecycle = false) {
  const changedPaths = diffGatewayReloadPaths(base, next, listConfigReloadRefinementPrefixes());
  const plan = buildGatewayReloadPlan(changedPaths, {
    previousConfig: base,
    candidateConfig: next,
    ...(pluginLifecycle
      ? {
          pluginLifecycle: {
            pluginIds: ["voice-call"],
            reason: "reload" as const,
            operationId: "hot-apply-kinds",
          },
        }
      : {}),
  });
  return { changedPaths, plan };
}

function refreshScopeFor(next: BranchConfig, pluginLifecycle = false): Scope {
  const { changedPaths, plan } = planFor(next, pluginLifecycle);
  if (!doesReloadAffectProviderAuth(plan, base, next)) {
    return "none";
  }
  const agentIds = resolveModelRuntimeRefreshAgentIds({
    changedPaths,
    reloadPlugins: plan.reloadPlugins,
    previousConfig: base,
    nextConfig: next,
  });
  return agentIds ? [...agentIds].toSorted() : "all";
}

describe("hot-apply config kinds", () => {
  beforeEach(() => setActivePluginRegistry(createEmptyPluginRegistry()));
  afterEach(() => resetPluginRuntimeStateForTest());

  it.each(hotApplyCases)(
    "hot-applies $kind: $change without a gateway restart",
    ({ next, pluginLifecycle }) => {
      const { changedPaths, plan } = planFor(next, pluginLifecycle);
      expect(changedPaths.length).toBeGreaterThan(0);
      expect(plan.restartGateway).toBe(false);
      expect(plan.restartReasons).toEqual([]);
      for (const path of changedPaths) {
        expect(resolveConfigReloadMetadata(path).kind, path).not.toBe("restart");
      }
    },
  );

  it.each(hotApplyCases)(
    "refreshes only the affected Trunks for $kind: $change",
    ({ next, pluginLifecycle, scope }) => {
      expect(refreshScopeFor(next, pluginLifecycle)).toEqual(scope);
    },
  );

  it("disposes only MCP runtimes for an MCP server change", () => {
    const { plan } = planFor(hotApplyCases[0]!.next);
    expect(plan.disposeMcpRuntimes).toBe(true);
    expect(plan.reloadPlugins).toBe(false);
  });

  it("widens a Trunk refresh when a model ref outside that Trunk changes", () => {
    const next = edit((c) => {
      delete c.agents!.entries!.oak;
      c.agents!.entries!.elm!.model = "anthropic/claude-sonnet-5";
    });
    expect(refreshScopeFor(next)).toEqual(["elm", "oak"]);
    const withHookModel = edit((c) => {
      delete c.agents!.entries!.oak;
      c.hooks = { gmail: { model: "openai/gpt-5.5" } };
    });
    expect(refreshScopeFor(withHookModel)).toBe("all");
  });

  // Listener and process-start owners: these settings cannot change without a rebind.
  it.each([
    "gateway.port",
    "gateway.bind",
    "gateway.customBindHost",
    "gateway.tls.enabled",
    "gateway.tailscale.mode",
    "gateway.auth.mode",
    "gateway.controlUi.basePath",
    "mcp.apps.sandboxPort",
    "secrets.egressProxy.enabled",
    "discovery.wideArea.domain",
  ])("keeps %s as a restart-only setting", (path) => {
    expect(resolveConfigReloadMetadata(path).kind).toBe("restart");
  });
});

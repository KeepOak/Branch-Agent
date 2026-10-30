import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  tryResolveContactDefaultAgentId,
  tryResolveDisplayedDefaultAgentId,
  tryResolveLegacyCompatibilityAgentId,
} from "../agents/agent-scope-config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveGatewayAgentSelectionState } from "../gateway/agent-list.js";
import { resolveHealthAgentOrder } from "../gateway/health/collector.js";
import type { OutputRuntimeEnv } from "../runtime.js";
import { buildAgentSummaries } from "./agents.config.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const { requireValidConfigMock } = vi.hoisted(() => ({
  requireValidConfigMock: vi.fn(),
}));

vi.mock("./config-validation.js", () => ({
  requireValidConfig: requireValidConfigMock,
}));

vi.mock("./agents.providers.js", () => ({
  buildProviderStatusIndex: vi.fn(async () => new Map()),
  buildProviderSummaryMetadataIndex: vi.fn(() => new Map()),
  listProvidersForAgent: vi.fn(() => []),
  summarizeBindings: vi.fn(() => []),
}));

vi.mock("../state/agent-provenance.js", () => ({
  listAgentProvenance: vi.fn(async () => []),
  readAgentProvenanceForDisplay: vi.fn(async () => []),
}));

const { agentsListCommand } = await import("./agents.commands.list.js");

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
  buildGatewayConnectionDetails: () => ({ message: "Gateway mode: local", url: "ws://127.0.0.1:9" }),
  buildGatewayProbeConnectionDetails: () => ({
    message: "Gateway mode: local",
    url: "ws://127.0.0.1:9",
  }),
  formatGatewayAuthErrorJson: () => null,
  formatGatewayClientRequestErrorJson: () => null,
  formatGatewayTransportErrorJson: () => null,
  isGatewayCredentialsRequiredError: () => false,
}));

vi.mock("../cli/daemon-cli/diagnostic-readiness.js", () => ({
  waitForGatewayDiagnosticReadiness: vi.fn(async () => undefined),
}));

vi.mock("../gateway/credentials.js", () => ({
  isGatewaySecretRefUnavailableError: () => false,
}));

vi.mock("../channels/plugins/read-only.js", () => ({
  listReadOnlyChannelPluginsForConfig: () => [],
}));

const { healthCommand } = await import("./health.js");

/** The install that produced #1772: contact default `tk`, migrated owner `dev`. */
function disagreeingFleet(): BranchConfig {
  return {
    agents: {
      ownership: "explicit",
      defaultId: "tk",
      defaults: { systemAgent: { agentId: "dev" } },
      entries: { tk: { name: "TK" }, dev: { name: "Dev" }, extra: { name: "Extra" } },
    },
  };
}

function severalAgentsWithContact(): BranchConfig {
  return {
    agents: {
      ownership: "explicit",
      defaultId: "fern",
      entries: { oak: {}, fern: {}, willow: {} },
    },
  };
}

function severalAgentsWithMigratedOwner(): BranchConfig {
  return {
    agents: {
      ownership: "explicit",
      defaults: { systemAgent: { agentId: "research" } },
      entries: { ops: {}, research: {}, first: {} },
    },
  };
}

/** Old `branch agents list` path: contact, then migrated owner. */
function oldAgentsListDefault(cfg: BranchConfig): string | undefined {
  return tryResolveContactDefaultAgentId(cfg) ?? tryResolveLegacyCompatibilityAgentId(cfg);
}

/** Old `branch health` path: migrated owner only. */
function oldHealthDefault(cfg: BranchConfig): string | undefined {
  return tryResolveLegacyCompatibilityAgentId(cfg);
}

async function displayedDefaults(cfg: BranchConfig) {
  const summaries = await buildAgentSummaries(cfg);
  const health = resolveHealthAgentOrder(cfg);
  return {
    shared: tryResolveDisplayedDefaultAgentId(cfg),
    agentsList: summaries.find((summary) => summary.isDefault)?.id,
    health: health.defaultAgentId,
    app: resolveGatewayAgentSelectionState(cfg).defaultId,
  };
}

function createRuntime() {
  return {
    ...createTestRuntime(),
    writeStdout: vi.fn<OutputRuntimeEnv["writeStdout"]>(),
    writeJson: vi.fn<OutputRuntimeEnv["writeJson"]>(),
  };
}

describe("displayed default agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireValidConfigMock.mockReset();
    callGatewayMock.mockReset();
  });

  it("keeps agents list, health, and the app on the contact default the old paths split", async () => {
    const cfg = disagreeingFleet();
    expect(oldAgentsListDefault(cfg)).toBe("tk");
    expect(oldHealthDefault(cfg)).toBe("dev");
    expect(oldAgentsListDefault(cfg)).not.toBe(oldHealthDefault(cfg));

    const reported = await displayedDefaults(cfg);
    expect(reported).toEqual({
      shared: "tk",
      agentsList: "tk",
      health: "tk",
      app: "tk",
    });
  });

  it("reports the same default from both commands when several agents exist", async () => {
    for (const cfg of [
      disagreeingFleet(),
      severalAgentsWithContact(),
      severalAgentsWithMigratedOwner(),
    ]) {
      const reported = await displayedDefaults(cfg);
      expect(reported.agentsList).toBe(reported.health);
      expect(reported.health).toBe(reported.app);
      expect(reported.shared).toBe(reported.app);
    }
  });

  it("prints the same default from agents list and health on the split fleet", async () => {
    const cfg = disagreeingFleet();
    requireValidConfigMock.mockResolvedValue(cfg);
    const listRuntime = createRuntime();
    await agentsListCommand({ json: true }, listRuntime);
    const listed = listRuntime.writeJson.mock.calls[0]?.[0] as Array<{
      id: string;
      isDefault: boolean;
    }>;
    expect(listed.find((agent) => agent.isDefault)?.id).toBe("tk");
    expect(listed.filter((agent) => agent.isDefault)).toHaveLength(1);

    const health = resolveHealthAgentOrder(cfg);
    callGatewayMock.mockResolvedValueOnce({
      ok: true,
      ts: Date.now(),
      durationMs: 1,
      channels: {},
      channelOrder: [],
      channelLabels: {},
      heartbeatSeconds: 0,
      defaultAgentId: health.defaultAgentId,
      agents: health.ordered.map((entry) => ({
        agentId: entry.id,
        isDefault: entry.id === health.defaultAgentId,
        heartbeat: { enabled: false, every: "0m", everyMs: 0 },
        sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
      })),
      sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
    });
    const healthRuntime = createRuntime();
    await healthCommand({ json: false, timeoutMs: 1_000, config: cfg }, healthRuntime);
    const output = healthRuntime.log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("tk (default)");
    expect(output).not.toContain("dev (default)");
  });
});

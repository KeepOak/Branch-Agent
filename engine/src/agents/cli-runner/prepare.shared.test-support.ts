// Shared setup for the prepareCliRunContext part files (prepare.*.test.ts).
import { vi } from "vitest";
import { getRuntimeConfig } from "../../config/config.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { registerContextEngineForOwner } from "../../context-engine/registry.js";
import type { resolveMcpLoopbackScopedTools as resolveLoopbackTools } from "../../gateway/mcp-http.runtime.js";
import { setActiveNodeContexts } from "../../infra/active-node-context.js";
import type { CliBackendPlugin } from "../../plugins/cli-backend.types.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { clearMemoryPluginState } from "../../plugins/memory-state.test-fixtures.js";
import { createPluginRegistry } from "../../plugins/registry.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import type { PluginRuntime } from "../../plugins/runtime/types.js";
import { setActiveDegradedSecretOwners } from "../../secrets/runtime-degraded-state.js";
import { createTestRegistry } from "../../test-utils/channel-plugins.js";
import { resolveApiKeyForProfile as resolveApiKeyForProfileImpl } from "../auth-profiles/oauth.js";
import { testing as cliBackendsTesting } from "../cli-backends.test-support.js";
import {
  buildDefaultTestCliBackend,
  createTestMcpLoopbackClientGrant,
  createTestMcpLoopbackServer,
  createTestMcpLoopbackServerConfig,
  type TestCliBackendParams,
} from "../cli-runner.test-helpers.js";
import { resetContextWindowCacheForTest } from "../context.test-support.js";
import { buildMediaTaskRuntimeContext } from "../media-generation-task-status.js";
import { ensureSandboxWorkspaceForSession } from "../sandbox.js";
import {
  resetCliRunnerPrepareTestDeps,
  setCliRunnerPrepareTestDeps,
} from "./prepare.test-support.js";

export function registerTestContextEngine(
  id: string,
  factory: Parameters<typeof registerContextEngineForOwner>[1],
) {
  return registerContextEngineForOwner(id, factory, `test:${id}`, {
    allowSameOwnerRefresh: true,
  });
}

export function installTestPluginRegistry() {
  const builder = createPluginRegistry({
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    runtime: {} as PluginRuntime,
    activateGlobalSideEffects: true,
  });
  setActivePluginRegistry(builder.registry);
  return builder;
}

export type McpProjectionParams = Parameters<typeof resolveLoopbackTools>[0];

export let defaultTestCliBackend = buildDefaultTestCliBackend();

export function createCliBackendConfig(params: TestCliBackendParams = {}): BranchConfig {
  defaultTestCliBackend = buildDefaultTestCliBackend(params);
  return {};
}

export const SHARED_CHAT_MESSAGE_TOOL_ETIQUETTE =
  "- Group/channel: stale/joke/light ack/low-value chatter => reaction or silence. Needed text reply => `message(action=send)`; final text private.";

export function createLoopbackRuntime() {
  return {
    port: 31783,
    ownerToken: "loopback-owner-token",
    nonOwnerToken: "loopback-non-owner-token",
  };
}

export function createBundledMessageToolConfig(): BranchConfig {
  setCliRunnerPrepareTestDeps({
    getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
    resolveMcpLoopbackScopedTools: vi.fn(() => ({
      agentId: "main",
      tools: [
        {
          name: "message",
          label: "Message",
          description: "Send a message",
          parameters: { type: "object", properties: {} },
          execute: vi.fn(),
        },
      ],
    })),
  });
  return createCliBackendConfig({ bundleMcp: true });
}

export function setCliBackendForPrepareTest(
  params: {
    authEpochMode?: CliBackendPlugin["authEpochMode"];
    autoSelectAuthProfile?: boolean;
    bundleMcp?: boolean;
    command?: string;
    id?: string;
    liveSession?: boolean;
    modelAliases?: Record<string, string>;
    modelProvider?: string;
    pluginId?: string;
    prepareExecution?: CliBackendPlugin["prepareExecution"];
    sessionMode?: "always" | "existing" | "none";
    reseedFromRawTranscriptWhenUncompacted?: boolean;
  } = {},
) {
  const id = params.id ?? "claude-cli";
  // Keep preparation behind the same runtime resolver seam that production
  // uses; direct backend constants would bypass provider ownership.
  cliBackendsTesting.setDepsForTest({
    resolvePluginSetupCliBackend: () => undefined,
    resolveRuntimeCliBackends: () => [
      {
        id,
        pluginId: params.pluginId ?? "anthropic",
        modelProvider: params.modelProvider ?? "anthropic",
        bundleMcp: params.bundleMcp ?? false,
        ...(params.authEpochMode ? { authEpochMode: params.authEpochMode } : {}),
        ...(params.bundleMcp ? { bundleMcpMode: "claude-config-file" as const } : {}),
        ...(params.autoSelectAuthProfile !== undefined
          ? { autoSelectAuthProfile: params.autoSelectAuthProfile }
          : {}),
        ...(params.prepareExecution ? { prepareExecution: params.prepareExecution } : {}),
        config: {
          ...createJsonlStdinBackendConfig(params.command ?? "claude"),
          systemPromptFileArg: "--append-system-prompt-file",
          systemPromptWhen: "always",
          resumeArgs: ["--resume", "{sessionId}"],
          sessionMode: params.sessionMode ?? "existing",
          ...(params.modelAliases ? { modelAliases: params.modelAliases } : {}),
          ...(params.liveSession ? { liveSession: "claude-stdio" as const } : {}),
          ...(params.reseedFromRawTranscriptWhenUncompacted
            ? { reseedFromRawTranscriptWhenUncompacted: true }
            : {}),
        },
      },
    ],
  });
}

export function createArgBackendConfig(
  command: string,
  args = ["--print"],
  output: "text" | "json" = "text",
): CliBackendPlugin["config"] {
  return { command, args, output, input: "arg", sessionMode: "existing" };
}

export function createJsonlStdinBackendConfig(command: string): CliBackendPlugin["config"] {
  return {
    command,
    args: ["--print"],
    output: "jsonl",
    input: "stdin",
    sessionMode: "existing",
  };
}

export type CliContextBudgetTestCase = {
  name: string;
  provider: string;
  expectedContextTokens: number;
  model: string;
  modelAliases?: Record<string, string>;
};

const mockGetRuntimeConfig = vi.mocked(getRuntimeConfig);
const mockEnsureSandboxWorkspaceForSession = vi.mocked(ensureSandboxWorkspaceForSession);
const mockGetGlobalHookRunner = vi.mocked(getGlobalHookRunner);
const mockBuildMediaTaskRuntimeContext = vi.mocked(buildMediaTaskRuntimeContext);

/** Install narrow test doubles; each part file mocks the modules these handles come from. */
export function installCliRunnerPrepareTestDoubles() {
  // Install narrow test doubles for external runtime seams so preparation
  // remains about data flow, not bundled plugin or loopback startup cost.
  defaultTestCliBackend = buildDefaultTestCliBackend();
  cliBackendsTesting.setDepsForTest({
    resolvePluginSetupCliBackend: () => undefined,
    resolveRuntimeCliBackends: () => [defaultTestCliBackend],
  });
  setCliRunnerPrepareTestDeps({
    isWorkspaceBootstrapPending: vi.fn(async () => false),
    makeBootstrapWarn: vi.fn(() => () => undefined),
    resolveBootstrapContextForRun: vi.fn(async () => ({
      bootstrapFiles: [],
      contextFiles: [],
    })),
    getActiveMcpLoopbackRuntime: vi.fn(() => undefined),
    ensureMcpLoopbackServer: vi.fn(createTestMcpLoopbackServer),
    createMcpLoopbackServerConfig: vi.fn(createTestMcpLoopbackServerConfig),
    mintMcpLoopbackClientGrant: vi.fn(createTestMcpLoopbackClientGrant),
    bindMcpLoopbackClientGrantAdmission: vi.fn(() => true),
    revokeMcpLoopbackClientGrant: vi.fn(() => true),
    resolveMcpLoopbackPolicyTools: vi.fn(() => ({ agentId: "main", tools: [] })),
    resolveMcpLoopbackScopedTools: vi.fn(() => ({ agentId: "main", tools: [] })),
    resolveBranchReferencePaths: vi.fn(async () => ({ docsPath: null, sourcePath: null })),
    prepareClaudeCliSkillsPlugin: vi.fn(async () => ({
      args: [],
      cleanup: vi.fn(async () => undefined),
    })),
    getCliLiveSessionGeneration: vi.fn(() => undefined),
    resolveApiKeyForProfile: resolveApiKeyForProfileImpl,
    // Keep preparation off the real plugin-metadata snapshot; catalog-driven
    // cases inject their own rows.
    loadManifestModelCatalog: vi.fn(() => []),
  });
  mockGetGlobalHookRunner.mockReturnValue(null);
  mockGetRuntimeConfig.mockReturnValue({});
  mockBuildMediaTaskRuntimeContext.mockResolvedValue(undefined);
  mockEnsureSandboxWorkspaceForSession.mockReset();
  mockEnsureSandboxWorkspaceForSession.mockResolvedValue(null);
}

export function resetCliRunnerPrepareTestDoubles() {
  setActiveNodeContexts([]);
  cliBackendsTesting.resetDepsForTest();
  resetCliRunnerPrepareTestDeps();
  mockGetRuntimeConfig.mockReset();
  mockGetGlobalHookRunner.mockReset();
  mockBuildMediaTaskRuntimeContext.mockReset();
  mockEnsureSandboxWorkspaceForSession.mockReset();
  resetContextWindowCacheForTest();
  clearMemoryPluginState();
  setActivePluginRegistry(createTestRegistry());
  setActiveDegradedSecretOwners([]);
  vi.unstubAllEnvs();
}

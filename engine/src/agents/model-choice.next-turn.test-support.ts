// Real Gateway path for a Trunk switching its own model, shared by the model-choice runtime proofs.
// Keep cold handler imports outside the in-process request deadline.
import "../gateway/server-methods/sessions-mutations.js";
import { expectDefined } from "@branch/normalization-core";
import { vi } from "vitest";
import * as configRuntime from "../config/config.js";
import { loadSessionEntry, upsertSessionEntryCore } from "../config/sessions/session-accessor.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import { createRequestGatewayMethodRegistry } from "../gateway/server-methods.js";
import { flushPendingSessionsChangedEvents } from "../gateway/server-methods/session-change-event.js";
import {
  disposeSessionReadContexts,
  initializeSessionReadContext,
} from "../gateway/server-methods/sessions-read-cache.test-support.js";
import { withOperatorToolGatewayAuthority } from "../gateway/server-plugin-in-process-dispatch.js";
import { createGatewayRequestContext } from "../gateway/server-request-context.js";
import { makeContextParams } from "../gateway/server-request-context.test-support.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import {
  getActivePluginRegistry,
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "../plugins/runtime.js";
import { withPluginRuntimeGatewayRequestScope } from "../plugins/runtime/gateway-request-scope.js";
import { resolveStoredModelOverride } from "../sessions/stored-model-overrides.js";
import { createBranchTestState, type BranchTestState } from "../test-utils/branch-test-state.js";
import { registerAgentHarness } from "./harness/registry.js";
import type { AgentHarness } from "./harness/types.js";
import { shouldSwitchToLiveModel } from "./live-model-switch.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import * as preparedCatalog from "./prepared-model-catalog.js";
import { withGatewayToolCallerIdentity } from "./tools/gateway-caller-context.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsTool } from "./tools/sessions-tool.js";

export const MODEL_CHOICE_PROVIDER = "fixture";

/** Model ids a Codex Trunk and a Claude Trunk start on and switch to. */
export const TRUNK_MODELS = {
  codex: { from: "gpt-5.4", to: "gpt-5.5" },
  claude: { from: "claude-opus-4-7", to: "claude-sonnet-4-6" },
} as const;

export const MODEL_CHOICE_HARNESS_ID = "model-choice-native";

/** The ready runtime the mocked model-runtime-choice returns; model selection never starts a turn. */
export function createModelChoiceHarness(): AgentHarness {
  return {
    id: MODEL_CHOICE_HARNESS_ID,
    label: "Model choice fixture",
    executionEnvironment: "host-only",
    supports: () => ({ supported: true }),
    async runAttempt() {
      throw new Error("Model selection must not start a turn");
    },
  };
}

export const MODEL_CHOICE_CATALOG: ModelCatalogEntry[] = [
  TRUNK_MODELS.codex.from,
  TRUNK_MODELS.codex.to,
  TRUNK_MODELS.claude.from,
  TRUNK_MODELS.claude.to,
].map((id) => ({ provider: MODEL_CHOICE_PROVIDER, id, name: id, reasoning: false }));

export const FULL_ACCESS_EXEC = { security: "full", ask: "off", host: "gateway" } as const;
export const ASKING_EXEC = { security: "full", ask: "always", host: "gateway" } as const;

/** Config with the Trunk's posture: modelChoice and exec decide whether a change applies, asks, or is refused. */
export function trunkModelChoiceConfig(tools: NonNullable<BranchConfig["tools"]>): BranchConfig {
  return {
    tools,
    agents: {
      entries: { main: {} },
      defaults: {
        model: { primary: `${MODEL_CHOICE_PROVIDER}/${TRUNK_MODELS.codex.from}` },
        models: Object.fromEntries(
          MODEL_CHOICE_CATALOG.map((entry) => [`${MODEL_CHOICE_PROVIDER}/${entry.id}`, {}]),
        ),
        modelSelectionScope: "global",
        sandbox: { mode: "off", sessionToolsVisibility: "all" },
      },
    },
    models: {
      providers: {
        [MODEL_CHOICE_PROVIDER]: {
          api: "openai-completions",
          baseUrl: "https://fixture.invalid/v1",
          agentRuntime: { id: "branch" },
          models: MODEL_CHOICE_CATALOG.map<ModelDefinitionConfig>((entry) => ({
            id: entry.id,
            name: entry.name,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            maxTokens: 1024,
          })),
        },
      },
    },
  };
}

/** Starts one Branch state for a suite; call the returned stop after it. */
export async function startModelChoiceGateway(): Promise<{
  state: BranchTestState;
  stop: () => Promise<void>;
}> {
  const state = await createBranchTestState({ scenario: "minimal" });
  return { state, stop: async () => await state.cleanup() };
}

/** Per-test plugin runtime with the fixture harness; returns the restore step. */
export function useModelChoiceRuntime(cfg: BranchConfig): () => Promise<void> {
  const originalRegistry = getActivePluginRegistry();
  configRuntime.setRuntimeConfigSnapshot(cfg);
  setActivePluginRegistry(createEmptyPluginRegistry(), "model-choice-test", "default");
  registerAgentHarness(createModelChoiceHarness());
  vi.spyOn(preparedCatalog, "loadPublishedPreparedModelCatalog").mockResolvedValue(
    MODEL_CHOICE_CATALOG,
  );
  return async () => {
    await flushPendingSessionsChangedEvents();
    await disposeSessionReadContexts();
    vi.restoreAllMocks();
    if (originalRegistry) {
      setActivePluginRegistry(originalRegistry, "model-choice-test-restore", "default");
    } else {
      resetPluginRuntimeStateForTest();
    }
  };
}

let nextTrunk = 0;

/**
 * A Trunk session already running a task on `model`. Its own tools reach the real
 * Gateway sessions.patch and session store; nothing in the mutation path is mocked.
 */
export async function createTrunkSession(params: {
  state: BranchTestState;
  cfg: BranchConfig;
  model: string;
}) {
  const agentId = "main";
  const id = `model-choice-trunk-${++nextTrunk}`;
  const sessionKey = `agent:${agentId}:${id}`;
  const scope = { agentId, sessionKey };
  await upsertSessionEntryCore(scope, {
    sessionId: id,
    lifecycleRevision: `${id}-generation`,
    updatedAt: 1,
    sandboxMode: "off",
    providerOverride: MODEL_CHOICE_PROVIDER,
    modelOverride: params.model,
  } satisfies SessionEntry);
  const context = createGatewayRequestContext(
    makeContextParams({
      getAttachedGatewayMethodRegistry: createRequestGatewayMethodRegistry,
      loadGatewayModelCatalogSnapshot: async (request) => ({
        agentId: request?.agentId ?? agentId,
        agentDir: params.state.agentDir(request?.agentId ?? agentId),
        workspaceDir: params.state.workspaceDir,
        config: params.cfg,
        catalogComplete: true,
        entries: MODEL_CHOICE_CATALOG,
        routeVariants: MODEL_CHOICE_CATALOG,
      }),
    }),
  );
  const resolveGatewayContext = () => context;
  context.resolveGatewayContext = resolveGatewayContext;
  context.getSessionEventSubscriberConnIds = () => new Set();
  await initializeSessionReadContext(context);
  const gatewayScope = { context, resolveGatewayContext, isWebchatConnect: () => false };
  const asTrunk = <T>(run: () => Promise<T>) =>
    withPluginRuntimeGatewayRequestScope(gatewayScope, () =>
      withOperatorToolGatewayAuthority(
        { scopes: ["operator.admin"], operatorRoleActor: { kind: "system" } },
        () =>
          withGatewayToolCallerIdentity(
            {
              agentId,
              sessionKey,
              operationalRunInstance: { instanceId: `${id}-instance`, runId: `${id}-run` },
              receiptAuthority: () => true,
              gatewayContextResolver: resolveGatewayContext,
            },
            run,
          ),
      ),
    );
  const read = () => expectDefined(loadSessionEntry(scope), "Trunk session");
  return {
    sessionKey,
    read,
    /** The Trunk changes its own model with session_status, mid-task. */
    switchWithSessionStatus: (model: string) =>
      asTrunk(() =>
        createSessionStatusTool({
          config: params.cfg,
          agentSessionKey: sessionKey,
          requesterAgentIdOverride: agentId,
        }).execute("trunk-switch-model", { model }),
      ),
    /** The Trunk changes its own model with the sessions tool's patch. */
    switchWithSessionsTool: (model: string) =>
      asTrunk(() =>
        createSessionsTool({
          agentSessionKey: sessionKey,
          agentSessionId: id,
          config: params.cfg,
        }).execute("trunk-patch-model", { action: "patch", targets: [{ sessionKey }], model }),
      ),
    /**
     * What the active run checks before its next turn (attempt-recovery): the
     * persisted selection when a switch is pending, in this same process.
     */
    liveSwitchFrom: async (currentModel: string) =>
      await shouldSwitchToLiveModel({
        cfg: params.cfg,
        sessionKey,
        agentId,
        defaultProvider: MODEL_CHOICE_PROVIDER,
        defaultModel: TRUNK_MODELS.codex.from,
        currentProvider: MODEL_CHOICE_PROVIDER,
        currentModel,
      }),
    /** The stored model a fresh next turn starts on (get-reply's stored override). */
    nextTurnModel: () =>
      resolveStoredModelOverride({
        sessionEntry: read(),
        sessionKey,
        defaultProvider: MODEL_CHOICE_PROVIDER,
      })?.model,
  };
}

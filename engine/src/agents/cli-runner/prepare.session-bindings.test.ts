// Exercises CLI preparation, auth, prompt hooks, MCP setup, and session reuse.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SYSTEM_PROMPT_CACHE_BOUNDARY } from "@branch/ai/internal/shared";
import { expectDefined } from "@branch/normalization-core";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { LegacyContextEngine } from "../../context-engine/legacy.js";
import { registerContextEngineInRegistry } from "../../context-engine/registry.js";
import type { ContextEngine } from "../../context-engine/types.js";
import { labelRuntimeContextText } from "../../llm/types.js";
import type { CliBackendExecute } from "../../plugins/cli-backend.types.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { createHookRunner } from "../../plugins/hooks.js";
import { registerTestMemoryPromptBuilder } from "../../plugins/memory-state.test-fixtures.js";
import { withPluginRuntimeRegistryScope } from "../../plugins/runtime/gateway-request-scope.js";
import { AsyncWorkScope } from "../../shared/async-work-scope.js";
import type { SkillLibraryAuthoringCapability } from "../../skills/library/authoring.js";
import { wrapRunWithTestPreparedAdmission } from "../admitted-run-context.test-support.js";
import {
  createCliRunnerPrepareFixture,
  createContextEngineCustodyFixture,
  createCliRepositorySkillFixture,
  createTestMcpLoopbackClientGrant,
  createTestMcpLoopbackServer,
  createTestMcpLoopbackServerConfig,
  wrappedPluginSystemContext,
  buildDefaultTestCliBackend,
} from "../cli-runner.test-helpers.js";
import { hashCliSessionText } from "../cli-session.js";
import { waitForDeferredTurnMaintenanceForSession } from "../embedded-agent-runner/context-engine-maintenance.js";
import { createContextEngineLogicalTurnLease } from "../harness/context-engine-logical-turn.js";
import { buildMediaTaskRuntimeContext } from "../media-generation-task-status.js";
import type { SandboxWorkspaceInfo } from "../sandbox/types.js";
import { beginForegroundSessionMaintenance } from "../session-maintenance/coordinator.js";
import { finalizeCliContextEngineTurn } from "./cli-run-transcript.js";
import {
  registerCliMcpPreparationTests,
  setRawCliBackendForPrepareTest,
} from "./prepare-mcp.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  createBundledMessageToolConfig,
  createCliBackendConfig,
  createLoopbackRuntime,
  type McpProjectionParams,
  registerTestContextEngine,
  setCliBackendForPrepareTest,
  SHARED_CHAT_MESSAGE_TOOL_ETIQUETTE,
  installCliRunnerPrepareTestDoubles,
  resetCliRunnerPrepareTestDoubles,
  createArgBackendConfig,
} from "./prepare.shared.test-support.js";
import { setCliRunnerPrepareTestDeps } from "./prepare.test-support.js";

const getRuntimeConfigMock = vi.hoisted(() => vi.fn(() => ({})));
const ensureSandboxWorkspaceForSessionMock = vi.hoisted(() =>
  vi.fn<() => Promise<SandboxWorkspaceInfo | null>>(async () => null),
);
// mock-isolation: Preparation reads a per-case runtime config instead of host Branch config.
vi.mock("../../config/config.js", async () => ({
  getRuntimeConfig: getRuntimeConfigMock,
  resolveGatewayPort: (await import("../../config/paths.js")).resolveGatewayPort,
}));

// mock-isolation: Sandbox workspace setup is a per-case double; preparation only consumes its result.
vi.mock("../sandbox.js", () => ({
  ensureSandboxWorkspaceForSession: ensureSandboxWorkspaceForSessionMock,
}));

// mock-isolation: Prompt-build hooks are injected per case through the global hook runner seam.
vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: vi.fn(() => null),
}));

// mock-isolation: TTS prompt hints stay inert so preparation never reads host speech preferences.
vi.mock("../../tts/tts-settings.js", () => ({
  buildTtsSystemPromptHint: vi.fn(() => undefined),
  resolveModelOverridePolicy: vi.fn(),
  setTtsMachinePrefsPathResolver: vi.fn(),
}));

// mock-isolation: Media task context is injected per case without the shared task registry.
vi.mock("../media-generation-task-status.js", () => ({
  buildMediaTaskRuntimeContext: vi.fn(() => undefined),
  VIDEO_GENERATION_TASK_KIND: "video_generation",
  buildVideoGenerationTaskStatusDetails: vi.fn(() => ({})),
  buildVideoGenerationTaskStatusText: vi.fn(() => ""),
  findActiveVideoGenerationTaskForSession: vi.fn(() => undefined),
  IMAGE_GENERATION_TASK_KIND: "image_generation",
  buildImageGenerationTaskStatusDetails: vi.fn(() => ({})),
  buildImageGenerationTaskStatusText: vi.fn(() => ""),
  MUSIC_GENERATION_TASK_KIND: "music_generation",
  buildMusicGenerationTaskStatusDetails: vi.fn(() => ({})),
  buildMusicGenerationTaskStatusText: vi.fn(() => ""),
  findActiveMusicGenerationTaskForSession: vi.fn(() => undefined),
}));

const mockGetGlobalHookRunner = vi.mocked(getGlobalHookRunner);
const mockBuildMediaTaskRuntimeContext = vi.mocked(buildMediaTaskRuntimeContext);

describe("prepareCliRunContext", () => {
  let fixture: ReturnType<typeof createCliRunnerPrepareFixture>;

  beforeEach(() => {
    installCliRunnerPrepareTestDoubles();
    // Discovery cases explicitly opt out of the prepared empty catalog.
    fixture = createCliRunnerPrepareFixture((params) =>
      prepareCliRunContext({ skillsSnapshot: { prompt: "", skills: [] }, ...params }),
    );
  });

  afterEach(async () => {
    await fixture.settle();
    resetCliRunnerPrepareTestDoubles();
    await fixture.cleanup();
  });

  it.each(["legacy", "incompatible-cleanup-failed", "cleanup-failed", "retired"] as const)(
    "settles directly resolved CLI context-engine custody (%s)",
    async (scenario) => {
      const custody = createContextEngineCustodyFixture();
      const engineId = `cli-custody-${scenario}`;
      const incompatible = scenario.startsWith("incompatible");
      const cleanupFailure = new Error("CLI engine cleanup failed");
      const backendCleanup = vi.fn(async () => {});
      setRawCliBackendForPrepareTest({
        ...buildDefaultTestCliBackend(),
        prepareExecution: async () => ({ cleanup: backendCleanup }),
      });
      let current = true;
      class Engine extends LegacyContextEngine {
        override readonly info: ContextEngine["info"] = {
          id: scenario === "legacy" ? "legacy" : engineId,
          name: "CLI custody fixture",
          ...(incompatible
            ? {
                hostRequirements: {
                  "agent-run": {
                    requiredCapabilities: ["assemble-before-prompt"],
                    unsupportedMessage: "CLI engine host unsupported",
                  },
                },
              }
            : {}),
        };
        async dispose() {
          expect(custody.read()).toBe(42);
          if (scenario.endsWith("cleanup-failed")) {
            throw cleanupFailure;
          }
        }
      }
      registerContextEngineInRegistry(
        custody.registry,
        engineId,
        async () => {
          current = scenario !== "retired";
          return new Engine();
        },
        "plugin:fixture",
      );
      try {
        const preparation = withPluginRuntimeRegistryScope(custody.registry, () =>
          fixture.prepare({
            config: { plugins: { slots: { contextEngine: engineId } } },
            assertCurrent: () => {
              if (!current) {
                throw new Error("CLI owner retired after engine acquisition");
              }
            },
          }),
        );
        if (incompatible || scenario === "retired") {
          await expect(preparation).rejects.toThrow(
            incompatible
              ? "CLI engine host unsupported"
              : "CLI owner retired after engine acquisition",
          );
          await custody.resources.release();
        } else {
          const context = await preparation;
          expect(context.contextEngine?.info.id).toBe(scenario === "legacy" ? undefined : engineId);
          await custody.resources.release();
          expect(custody.retired).not.toHaveBeenCalled();
          if (scenario === "cleanup-failed") {
            await expect(context.preparedBackend.cleanup?.()).rejects.toBe(cleanupFailure);
          } else {
            await context.preparedBackend.cleanup?.();
          }
        }
        expect(backendCleanup).toHaveBeenCalledOnce();
        expect(custody.retired).toHaveBeenCalledOnce();
        expect(() => custody.read()).toThrow();
      } finally {
        await custody.cleanup();
      }
    },
  );

  it("releases prepared CLI context-engine custody when hook history cannot be read", async () => {
    const custody = createContextEngineCustodyFixture();
    const engineId = "cli-custody-history-failure";
    const historyFailure = new Error("synthetic hook-history read failed");
    const backendCleanup = vi.fn(async () => {});
    const execute = vi.fn<CliBackendExecute>(async function* () {
      yield { type: "result", subtype: "success", result: "unexpected answer" };
    });
    setRawCliBackendForPrepareTest({
      ...buildDefaultTestCliBackend(),
      prepareExecution: async () => ({ cleanup: backendCleanup, execute }),
    });
    let engineAcquired = false;
    class Engine extends LegacyContextEngine {
      override readonly info = { id: engineId, name: "CLI failed-history custody fixture" };
      async dispose() {
        expect(custody.read()).toBe(42);
      }
    }
    const factory = vi.fn(() => {
      engineAcquired = true;
      return new Engine();
    });
    registerContextEngineInRegistry(custody.registry, engineId, factory, "plugin:fixture");
    custody.registry.typedHooks.push({
      pluginId: "fixture",
      hookName: "llm_input",
      handler: () => {},
      source: "test",
    });
    mockGetGlobalHookRunner.mockReturnValue(createHookRunner(custody.registry));
    const history = await import("./session-history.js");
    const readHistory = history.loadCliSessionHistoryMessages;
    const historyRead = vi
      .spyOn(history, "loadCliSessionHistoryMessages")
      .mockImplementation(async (params) => {
        if (engineAcquired) {
          throw historyFailure;
        }
        return await readHistory(params);
      });
    try {
      const { runCliAgent } = await import("../cli-runner.js");
      const { dir, sessionTarget } = fixture.session;
      await expect(
        withPluginRuntimeRegistryScope(custody.registry, () =>
          wrapRunWithTestPreparedAdmission(runCliAgent)({
            sessionId: sessionTarget.sessionId,
            sessionKey: sessionTarget.sessionKey,
            sessionTarget,
            sessionFile: sessionTarget.sessionKey,
            workspaceDir: dir,
            prompt: "synthetic question",
            provider: "test-cli",
            model: "test-model",
            runId: "cli-custody-history-failure",
            timeoutMs: 1_000,
            config: { plugins: { slots: { contextEngine: engineId } } },
          }),
        ),
      ).rejects.toBe(historyFailure);
      expect(factory).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
      expect(backendCleanup).toHaveBeenCalledOnce();
      await custody.resources.release();
      expect(custody.retired).toHaveBeenCalledOnce();
    } finally {
      historyRead.mockRestore();
      await custody.cleanup();
    }
  });

  it.each(["direct", "borrowed"] as const)(
    "retains %s CLI context-engine custody through queued turn maintenance",
    async (ownership) => {
      const custody = createContextEngineCustodyFixture();
      const engineId = `cli-maintenance-custody-${ownership}`;
      const maintenanceStarted = createDeferred();
      const maintenanceGate = createDeferred();
      const work = new AsyncWorkScope();
      const { sessionTarget } = fixture.session;
      const sessionKey = sessionTarget.sessionKey;
      const releaseForeground = await beginForegroundSessionMaintenance(sessionKey);
      let lease: Awaited<ReturnType<typeof createContextEngineLogicalTurnLease>> | undefined;
      class Engine extends LegacyContextEngine {
        override readonly info: ContextEngine["info"] = {
          id: engineId,
          name: "CLI maintenance custody fixture",
          turnMaintenanceMode: "background",
        };
        async maintain() {
          maintenanceStarted.resolve();
          await maintenanceGate.promise;
          expect(custody.read()).toBe(42);
          return { changed: false, bytesFreed: 0, rewrittenEntries: 0 };
        }
        async dispose() {
          expect(custody.read()).toBe(42);
        }
      }
      registerContextEngineInRegistry(
        custody.registry,
        engineId,
        () => new Engine(),
        "plugin:fixture",
      );
      try {
        const config = { plugins: { slots: { contextEngine: engineId } } };
        const context = await work.run(() =>
          withPluginRuntimeRegistryScope(custody.registry, async () => {
            if (ownership === "borrowed") {
              lease = await createContextEngineLogicalTurnLease({
                identity: { runId: "run-test", sessionId: sessionTarget.sessionId },
                config,
              });
            }
            return await fixture.prepare({
              config,
              sessionKey,
              contextEngineLogicalTurnLease: lease,
            });
          }),
        );
        await custody.resources.release();
        await finalizeCliContextEngineTurn({
          context,
          historyMessages: [],
          assistantText: "synthetic answer",
          output: { text: "synthetic answer" },
        });
        await context.preparedBackend.cleanup?.();
        expect(custody.retired).not.toHaveBeenCalled();
        await lease?.dispose();
        expect(custody.retired).not.toHaveBeenCalled();
        releaseForeground();
        await maintenanceStarted.promise;
        expect(custody.read()).toBe(42);
        maintenanceGate.resolve();
        await waitForDeferredTurnMaintenanceForSession(sessionKey);
        if (lease) {
          await custody.retirement;
        }
        await work.drain();
        expect(custody.retired).toHaveBeenCalledOnce();
        expect(() => custody.read()).toThrow();
      } finally {
        releaseForeground();
        maintenanceGate.resolve();
        await waitForDeferredTurnMaintenanceForSession(sessionKey);
        await lease?.dispose();
        if (lease) {
          await custody.retirement;
        }
        await work.drain();
        await custody.cleanup();
      }
    },
  );

  it.each(["cancelled", "retired", "lookup-failed"] as const)(
    "rechecks CLI ownership after a delayed media lookup is %s",
    async (scenario) => {
      const lookupStarted = createDeferred();
      const lookup = createDeferred<string | undefined>();
      const abort = new AbortController();
      let current = true;
      const engineId = `cli-media-lookup-${scenario}`;
      const factory = vi.fn((): ContextEngine => ({
        info: { id: engineId, name: "CLI media lookup" },
        ingest: async () => ({ ingested: true }),
        assemble: async ({ messages }) => ({ messages, estimatedTokens: 0 }),
        compact: async () => ({ ok: true, compacted: false }),
      }));
      await registerTestContextEngine(engineId, factory);
      const config = createCliBackendConfig({ bundleMcp: true });
      setCliRunnerPrepareTestDeps({
        getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
        resolveMcpLoopbackScopedTools: vi.fn(() => ({
          agentId: "main",
          tools: [
            {
              name: "image_generate",
              label: "image_generate",
              description: "image_generate",
              parameters: Type.Object({}),
              execute: vi.fn(),
            },
          ],
        })),
      });
      mockBuildMediaTaskRuntimeContext.mockImplementation(() => {
        lookupStarted.resolve();
        return lookup.promise;
      });
      const preparation = fixture.prepare({
        config: { ...config, plugins: { slots: { contextEngine: engineId } } },
        sessionKey: "agent:main:test",
        abortSignal: abort.signal,
        sourceReplyDeliveryMode: "message_tool_only",
        assertCurrent: () => {
          if (!current) {
            throw new Error("CLI owner retired");
          }
        },
      });
      const outcome = preparation.then(
        (context) => ({
          prompt: context.params.prompt,
          transcriptPrompt: context.params.transcriptPrompt,
        }),
        (error: unknown) => ({ error: String(error) }),
      );
      await lookupStarted.promise;
      expect(factory).not.toHaveBeenCalled();
      if (scenario === "cancelled") {
        abort.abort(new Error("CLI lookup cancelled"));
      } else if (scenario === "retired") {
        current = false;
      }
      if (scenario === "lookup-failed") {
        lookup.reject(new Error("optional media lookup failed"));
        expect(await outcome).toEqual({
          prompt: expect.stringMatching(
            /^latest ask\n\nNo source-conversation reply can be sent from this turn\./,
          ),
          transcriptPrompt: "latest ask",
        });
        expect(factory).toHaveBeenCalledOnce();
      } else {
        lookup.resolve("active image task");
        expect(await outcome).toEqual({
          error: `Error: ${scenario === "cancelled" ? "CLI lookup cancelled" : "CLI owner retired"}`,
        });
        expect(factory).not.toHaveBeenCalled();
      }
    },
  );

  it("invalidates a stable CLI binding when explicit message-target policy changes", async () => {
    const context = await fixture.prepare({
      sourceReplyDeliveryMode: "message_tool_only",
      requireExplicitMessageTarget: true,
      cliSessionBindingFacts: {
        sourceReplyDeliveryMode: "message_tool_only" as const,
        requireExplicitMessageTarget: true,
      },
      cliSessionBinding: {
        sessionId: "cli-session",
        messageToolPolicyHash: hashCliSessionText(
          JSON.stringify({
            sourceReplyDeliveryMode: "message_tool_only",
            requireExplicitMessageTarget: false,
          }),
        ),
      },
    });

    expect(context.messageToolPolicyHash).toBeDefined();
    expect(context.reusableCliSession).toEqual({
      mode: "invalidate",
      invalidatedReason: "message-policy",
    });
  });

  it("reuses normal/heartbeat/normal CLI bindings for a subagent", async () => {
    const trigger = "heartbeat";
    const sessionKey = "agent:main:subagent:child";
    const cliSessionBindingFacts = { extraSystemPromptStatic: "" };
    const first = await fixture.prepare({ sessionKey, cliSessionBindingFacts });
    expect(first.params.requireExplicitMessageTarget).toBe(true);
    const binding = {
      sessionId: "cli-session",
      extraSystemPromptHash: first.extraSystemPromptHash,
      messageToolPolicyHash: first.messageToolPolicyHash,
      promptToolNamesHash: first.promptToolNamesHash,
      cwdHash: first.cwdHash,
      mcpConfigHash: first.preparedBackend.mcpConfigHash,
      mcpResumeHash: first.preparedBackend.mcpResumeHash,
    };
    const background = await fixture.prepare({
      sessionKey,
      cliSessionBindingFacts,
      trigger,
      requireExplicitMessageTarget: true,
      cliSessionBinding: binding,
    });
    const normal = await fixture.prepare({
      sessionKey,
      cliSessionBindingFacts,
      cliSessionBinding: binding,
    });
    expect(background.params.requireExplicitMessageTarget).toBe(true);
    expect(background.messageToolPolicyHash).toBe(first.messageToolPolicyHash);
    expect(background.reusableCliSession).toEqual({ mode: "reuse", sessionId: "cli-session" });
    expect(normal.reusableCliSession).toEqual({ mode: "reuse", sessionId: "cli-session" });
  });

  it("uses canonical repository skills for a managed worktree", async () => {
    const { dir } = fixture.session;
    const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-cli-task-"));
    const { canonicalDir, skillDir } = createCliRepositorySkillFixture(dir, taskDir, true);
    try {
      const context = await fixture.prepare({
        config: { agents: { defaults: { workspace: dir } } },
        workspaceDir: taskDir,
        cwd: taskDir,
        skillsSnapshot: undefined,
        sessionEntry: {
          sessionId: fixture.session.sessionTarget.sessionId,
          updatedAt: Date.now(),
          worktree: {
            id: "task",
            branch: "task",
            repoRoot: path.join(dir, "canonical"),
            canonicalWorkspaceDir: canonicalDir,
          },
        },
      });

      expect(context.cwd).toBe(taskDir);
      expect(context.systemPrompt).toContain(`Working directory: ${taskDir}`);
      expect(context.systemPrompt).not.toContain(`Working directory: ${dir}`);
      expect(context.systemPrompt).toContain("<name>task-proof</name>");
      expect(context.systemPrompt).toContain(path.join(skillDir, "SKILL.md"));
      expect(context.systemPrompt).not.toContain("Worktree copy");
    } finally {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("keeps per-run helper session identities out of the reusable system prompt", async () => {
    const prepareRun = (runId: string, runtimeFactsInTurn?: true) =>
      fixture.prepare({
        runId,
        sessionId: runId,
        sessionKey: `agent:main:main:active-memory:${runId}`,
        messageChannel: "webchat",
        ...(runtimeFactsInTurn ? { runtimeFactsInTurn } : {}),
      });

    const first = await prepareRun("recall-a", true);
    const second = await prepareRun("recall-b", true);

    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(first.systemPrompt).not.toContain("Runtime: ");
    expect(first.params.prompt).toContain("session=agent:main:main:active-memory:recall-a");
    expect(second.params.prompt).toContain("session=agent:main:main:active-memory:recall-b");
    expect(second.params.prompt).toContain("channel=webchat");

    // Resumable turns keep Runtime facts in the prompt they share across turns.
    const resumable = await prepareRun("turn-c");
    expect(resumable.systemPrompt).toContain("session=agent:main:main:active-memory:turn-c");
    expect(resumable.params.prompt).not.toContain("Runtime: ");
  });

  it.each([
    {
      name: "prefers current-turn metadata",
      chatType: "group" as const,
      sessionEntryChatType: "direct" as const,
      expectedChatType: "group" as const,
    },
    {
      name: "falls back to stored session metadata",
      chatType: undefined,
      sessionEntryChatType: "channel" as const,
      expectedChatType: "channel" as const,
    },
  ])("$name for bootstrap and prompt preparation", async (testCase) => {
    const resolveBootstrapContextForRun = vi.fn(async () => ({
      bootstrapFiles: [],
      contextFiles: [],
    }));
    setCliRunnerPrepareTestDeps({ resolveBootstrapContextForRun });

    const context = await fixture.prepare({
      config: createBundledMessageToolConfig(),
      sessionKey: "agent:main:opaque:binding",
      chatType: testCase.chatType,
      sessionEntry: {
        sessionId: "stored-session",
        updatedAt: 0,
        chatType: testCase.sessionEntryChatType,
      },
      sourceReplyDeliveryMode: "message_tool_only",
    });

    expect(resolveBootstrapContextForRun).toHaveBeenCalledWith(
      expect.objectContaining({ chatType: testCase.expectedChatType }),
    );
    expect(context.systemPrompt).toContain(SHARED_CHAT_MESSAGE_TOOL_ETIQUETTE);
  });

  it("soft-resumes content drift and surfaces a per-turn drift note", async () => {
    const { dir } = fixture.session;
    const context = await fixture.prepare({
      sessionKey: "agent:main:test",
      currentInboundContext: {
        text: "Conversation info: ⟦branch:ctx⟧\nchannel=telegram",
      },
      extraSystemPrompt: "new stable prompt",
      extraSystemPromptStatic: "new stable prompt",
      cliSessionBinding: {
        sessionId: "cli-session",
        extraSystemPromptHash: hashCliSessionText("old stable prompt"),
        cwdHash: hashCliSessionText(dir),
      },
    });

    expect(context.reusableCliSession).toEqual({
      mode: "reuse-with-drift",
      sessionId: "cli-session",
      drift: { reasons: ["system-prompt"] },
    });
    expect(context.branchHistoryPrompt).toBeUndefined();
    expect(context.params.prompt).toContain(
      "Branch Agent resumed this CLI session after prompt content changed.",
    );
    expect(context.params.prompt).toContain("changed=system-prompt");
    expect(context.params.prompt).toContain("latest ask");
  });

  it("invalidates content drift when the backend cannot receive a resumed system prompt", async () => {
    const { dir } = fixture.session;
    const context = await fixture.prepare({
      extraSystemPrompt: "new stable prompt",
      extraSystemPromptStatic: "new stable prompt",
      cliSessionBinding: {
        sessionId: "cli-session",
        extraSystemPromptHash: hashCliSessionText("old stable prompt"),
        cwdHash: hashCliSessionText(dir),
      },
      config: createCliBackendConfig({ systemPromptWhen: "never" }),
    });

    expect(context.reusableCliSession).toEqual({
      mode: "invalidate",
      invalidatedReason: "system-prompt",
    });
    expect(context.params.prompt).not.toContain(
      "Branch Agent resumed this CLI session after prompt content changed.",
    );
  });

  it("invalidates CLI session bindings when owner policy changes prompt tool scope", async () => {
    const { dir } = fixture.session;
    const getActiveMcpLoopbackRuntime = vi.fn(createLoopbackRuntime);
    const resolveMcpLoopbackScopedTools = vi.fn((scope: McpProjectionParams) => ({
      agentId: "main",
      tools: [
        {
          name: "message",
          label: "Message",
          description: "Send a message",
          parameters: { type: "object", properties: {} },
          execute: vi.fn(),
        },
        ...(scope.context.senderIsOwner === false
          ? []
          : [
              {
                name: "gateway",
                label: "Gateway",
                description: "Manage the gateway",
                parameters: { type: "object", properties: {} },
                execute: vi.fn(),
              },
            ]),
      ],
    }));
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
      resolveMcpLoopbackScopedTools,
    });
    setRawCliBackendForPrepareTest({
      id: "native-cli",
      pluginId: "native-plugin",
      bundleMcp: true,
      bundleMcpMode: "claude-config-file",
      config: {
        ...createArgBackendConfig("native-cli"),
        systemPromptArg: "--system-prompt",
        systemPromptWhen: "first",
      },
    });
    const cliSessionBindingFacts = {
      extraSystemPromptStatic: "group:telegram:group:message_tool_only",
      sourceReplyDeliveryMode: "message_tool_only" as const,
    };
    const first = await fixture.prepare({
      sessionKey: "agent:main:telegram:group:chat123",
      prompt: "first ask",
      provider: "native-cli",
      extraSystemPrompt: "volatile owner turn",
      currentMessageId: "owner-message",
      senderIsOwner: true,
      cliSessionBindingFacts,
      config: createCliBackendConfig({ bundleMcp: true }),
    });
    const second = await fixture.prepare({
      sessionKey: "agent:main:telegram:group:chat123",
      prompt: "second ask",
      provider: "native-cli",
      extraSystemPrompt: "volatile non-owner turn",
      currentMessageId: "non-owner-message",
      senderIsOwner: false,
      cliSessionBindingFacts,
      cliSessionBinding: {
        sessionId: "cli-session",
        extraSystemPromptHash: first.extraSystemPromptHash,
        messageToolPolicyHash: first.messageToolPolicyHash,
        promptToolNamesHash: first.promptToolNamesHash,
        cwdHash: hashCliSessionText(dir),
        mcpConfigHash: first.preparedBackend.mcpConfigHash,
        mcpResumeHash: first.preparedBackend.mcpResumeHash,
      },
      config: createCliBackendConfig({ bundleMcp: true }),
    });

    expect(resolveMcpLoopbackScopedTools).toHaveBeenCalledTimes(2);
    expect(resolveMcpLoopbackScopedTools).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: expect.objectContaining({
          senderIsOwner: true,
          currentMessageId: "owner-message",
          sourceReplyDeliveryMode: undefined,
        }),
      }),
    );
    expect(resolveMcpLoopbackScopedTools).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        context: expect.objectContaining({
          senderIsOwner: false,
          currentMessageId: "non-owner-message",
          sourceReplyDeliveryMode: undefined,
        }),
      }),
    );
    expect(second.promptToolNamesHash).not.toBe(first.promptToolNamesHash);
    expect(second.reusableCliSession).toEqual({
      mode: "reuse-with-drift",
      sessionId: "cli-session",
      drift: { reasons: ["prompt-tools"] },
    });
  });

  it("keeps media progress in private plugin turn context", async () => {
    const config = createCliBackendConfig({ bundleMcp: true });
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
      resolveMcpLoopbackScopedTools: vi.fn(() => ({
        agentId: "main",
        tools: ["image_generate", "video_generate"].map((name) => ({
          name,
          label: name,
          description: name,
          parameters: Type.Object({}),
          execute: vi.fn(),
        })),
      })),
    });

    setCliBackendForPrepareTest({
      id: "test-cli",
      bundleMcp: true,
      prepareExecution: () => ({
        async *execute() {
          yield { type: "result" };
        },
      }),
    });

    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "before_prompt_build"),
      runBeforePromptBuild: vi.fn(async () => ({
        systemPrompt: "hook system",
        prependSystemContext: "hook prepend system",
      })),
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as never);

    const prepareTurn = () =>
      fixture.prepare({
        sessionKey: "agent:main:test",
        trigger: "user",
        config,
        prompt: "latest ask",
        transcriptPrompt: "latest ask",
      });
    mockBuildMediaTaskRuntimeContext.mockResolvedValue(
      "## Media Generation Tasks\nimage task queued\nactive video task",
    );
    const first = await prepareTurn();
    mockBuildMediaTaskRuntimeContext.mockResolvedValue(
      "## Media Generation Tasks\nimage task running\nactive video task",
    );
    const second = await prepareTurn();

    expect(second.systemPrompt).toBe(first.systemPrompt);
    expect(second.systemPrompt).toBe(
      `${wrappedPluginSystemContext("hook prepend system")}\n\nhook system${SYSTEM_PROMPT_CACHE_BOUNDARY}\nCurrent model identity: test-cli/test-model. If asked what model you are, answer with this value for the current run.`,
    );
    const carrier = ["## Media Generation Tasks", "image task running", "active video task"].join(
      "\n",
    );
    expect(second.params.prompt).toBe("latest ask");
    expect(second.promptContext).toEqual({
      appendContext: expect.stringMatching(/^For the current source conversation,/),
    });
    expect(
      second.promptContext?.appendContext?.endsWith(`\n\n${labelRuntimeContextText(carrier)}`),
    ).toBe(true);
    expect(second.params.transcriptPrompt).toBe("latest ask");
    expect(second.contextEngineTurnPrompt).toBe("latest ask");
    expect(mockBuildMediaTaskRuntimeContext).toHaveBeenCalledWith({
      sessionKey: "agent:main:test",
      agentId: "main",
      capabilityToolNames: new Set(["image_generate", "video_generate"]),
      includeEmptySnapshots: true,
    });
  });

  registerCliMcpPreparationTests({
    getFixture: () => fixture,
    createConfig: () => createCliBackendConfig({ bundleMcp: true }),
  });

  it("uses loopback-scoped tools when building bundled MCP CLI prompts", async () => {
    const skillLibraryAuthoring: SkillLibraryAuthoringCapability = {
      target: "personal",
      defaultTarget: "workspace",
      multipleProfiles: true,
      bind: vi.fn(),
      invoke: vi.fn(),
    };
    registerTestMemoryPromptBuilder(({ availableTools }) =>
      availableTools.has("memory_search")
        ? ["## Memory Recall", `tools=${[...availableTools].toSorted().join(",")}`, ""]
        : [],
    );
    const getActiveMcpLoopbackRuntime = vi.fn(createLoopbackRuntime);
    const ensureMcpLoopbackServer = vi.fn(createTestMcpLoopbackServer);
    const createMcpLoopbackServerConfig = vi.fn(createTestMcpLoopbackServerConfig);
    const activateMcpLoopbackClientGrantCapture = vi.fn(() => ({
      captureNativeToolAuthority: vi.fn((_names: readonly string[] | null) => true),
    }));
    const deactivateMcpLoopbackClientGrantCapture = vi.fn(() => true);
    const mintMcpLoopbackClientGrant = vi.fn(createTestMcpLoopbackClientGrant);
    const revokeMcpLoopbackClientGrant = vi.fn(() => true);
    const resolveMcpLoopbackScopedTools = vi.fn((_scope: McpProjectionParams) => ({
      agentId: "main",
      tools: [
        {
          name: "memory_search",
          label: "Memory Search",
          description: "Search memory",
          parameters: { type: "object", properties: {} },
          execute: vi.fn(),
        },
        {
          name: "fake_web_tool",
          label: "Fake web tool",
          description: "Test network content capability",
          parameters: Type.Object({}, { additionalProperties: false }),
          resultContentSource: "network" as const,
          execute: vi.fn(async () => ({ content: [] })),
        },
      ],
    }));
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
      ensureMcpLoopbackServer,
      createMcpLoopbackServerConfig,
      activateMcpLoopbackClientGrantCapture,
      deactivateMcpLoopbackClientGrantCapture,
      mintMcpLoopbackClientGrant,
      revokeMcpLoopbackClientGrant,
      resolveMcpLoopbackScopedTools,
    });
    setRawCliBackendForPrepareTest({
      id: "native-cli",
      pluginId: "native-plugin",
      bundleMcp: true,
      bundleMcpMode: "claude-config-file",
      config: {
        ...createArgBackendConfig("native-cli"),
        systemPromptArg: "--system-prompt",
        systemPromptWhen: "first",
      },
    });
    const baselineContext = await fixture.prepare({
      sessionKey: "main",
      agentId: "worker",
      provider: "native-cli",
      config: createCliBackendConfig({ bundleMcp: true }),
    });
    const context = await fixture.prepare({
      sessionKey: "main",
      agentId: "worker",
      provider: "native-cli",
      runId: "run-test-loopback-prompt-tools",
      skillLibraryAuthoring,
      config: createCliBackendConfig({ bundleMcp: true }),
      scheduledToolPolicy: {
        version: 1,
        mode: "account",
        ownerSessionKey: "agent:worker:discord:group:ops",
        ownerAccountId: "default",
      },
      cliSessionBinding: {
        sessionId: "cli-session",
        promptToolNamesHash: "old-tool-surface",
        ...(baselineContext.preparedBackend.mcpConfigHash
          ? { mcpConfigHash: baselineContext.preparedBackend.mcpConfigHash }
          : {}),
        ...(baselineContext.preparedBackend.mcpResumeHash
          ? { mcpResumeHash: baselineContext.preparedBackend.mcpResumeHash }
          : {}),
      },
    });

    const projected = resolveMcpLoopbackScopedTools.mock.calls.at(-1)?.[0];
    const grantContext = mintMcpLoopbackClientGrant.mock.calls.at(-1)?.[0]?.context;
    expect(projected).toBeDefined();
    expect(grantContext).toBeDefined();
    const {
      cfg: projectedConfig,
      authProfileStore,
      authProfileStoreAgentDir,
      skillLibraryAuthoring: projectedAuthoring,
      context: projectedContext,
    } = expectDefined(projected, "projected tool context");
    expect(projectedConfig).toEqual(expect.any(Object));
    expect(authProfileStore).toMatchObject({ version: 1, profiles: {} });
    expect(authProfileStoreAgentDir).toEqual(expect.any(String));
    expect(projectedContext).toEqual(grantContext);
    expect(projectedAuthoring).toBe(skillLibraryAuthoring);
    expect(mintMcpLoopbackClientGrant).toHaveBeenLastCalledWith(
      expect.objectContaining({ skillLibraryAuthoring }),
    );
    expect(grantContext).not.toHaveProperty("skillWorkshop.libraryAuthoring");
    expect(projectedContext).toMatchObject({
      sessionKey: "agent:worker:main",
      sessionId: expect.any(String),
      runId: "run-test-loopback-prompt-tools",
      workspaceDir: expect.any(String),
      modelProvider: "native-cli",
      modelId: "test-model",
      scheduledToolPolicy: {
        version: 1,
        mode: "account",
        ownerSessionKey: "agent:worker:discord:group:ops",
        ownerAccountId: "default",
      },
    });
    expect(context.resultContentSourceByToolName?.get("fake_web_tool")).toBe("network");
    expect(context.resultContentSourceByToolName?.get("memory_search")).toBeUndefined();
    expect(context.systemPrompt).toContain("## Memory Recall");
    expect(context.systemPrompt).toContain("tools=fake_web_tool,memory_search");
    expect(context.systemPromptReport.tools.entries.map((entry) => entry.name)).toEqual([
      "memory_search",
      "fake_web_tool",
    ]);
    expect(context.promptToolNamesHash).toBe(
      hashCliSessionText(JSON.stringify(["fake_web_tool", "memory_search"])),
    );
    expect(context.reusableCliSession).toEqual({
      mode: "reuse-with-drift",
      sessionId: "cli-session",
      drift: { reasons: ["prompt-tools"] },
    });
  });
});

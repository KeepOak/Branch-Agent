// Exercises CLI preparation, auth, prompt hooks, MCP setup, and session reuse.
import { expectDefined } from "@branch/normalization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import {
  createReplyOperation,
  replyRunRegistry,
  type ReplyOperation,
} from "../../auto-reply/reply/reply-run-registry.js";
import { prepareReplyToolAuthority } from "../../auto-reply/reply/reply-tool-authority.js";
import { getRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import type { BranchConfig } from "../../config/types.branch.js";
import type {
  CliBackendExecute,
  CliBackendExecuteContext,
} from "../../plugins/cli-backend.types.js";
import { registerTestMemoryPromptBuilder } from "../../plugins/memory-state.test-fixtures.js";
import {
  getAdmittedRunDelegatedAuthority,
  prepareSystemAgentRunAdmission,
} from "../admitted-run-context.js";
import {
  createCliRunnerPrepareFixture,
  createTestMcpLoopbackClientGrant,
  createTestMcpLoopbackServerConfig,
} from "../cli-runner.test-helpers.js";
import { claimPendingAgentQuestionAnswerFromCaller } from "../harness/gateway-question.js";
import { withQuestionGateway } from "../harness/gateway-question.test-support.js";
import { createAgentCleanupScope } from "../run-cleanup-timeout.js";
import type { SandboxWorkspaceInfo } from "../sandbox/types.js";
import { executePluginOwnedProcess } from "./execute-plugin.js";
import { setRawCliBackendForPrepareTest } from "./prepare-mcp.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  createCliBackendConfig,
  createJsonlStdinBackendConfig,
  createLoopbackRuntime,
  type McpProjectionParams,
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

describe("prepareCliRunContext", () => {
  let fixture: ReturnType<typeof createCliRunnerPrepareFixture>;

  async function prepareNativeAuthority(
    capabilities: readonly string[],
    overrides: Parameters<typeof fixture.prepare>[0] = {},
  ) {
    const mintMcpLoopbackClientGrant = vi.fn(createTestMcpLoopbackClientGrant);
    const projectNativeToolAuthority = vi.fn((_tools: readonly string[]) => capabilities);
    const captureNativeToolAuthority = vi.fn((_names: readonly string[] | null) => true);
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
      mintMcpLoopbackClientGrant,
      activateMcpLoopbackClientGrantCapture: vi.fn(() => ({ captureNativeToolAuthority })),
    });
    setRawCliBackendForPrepareTest({
      id: "native-cli",
      pluginId: "native-plugin",
      bundleMcp: true,
      bundleMcpMode: "claude-config-file",
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "execution-args",
      resolveExecutionArgs: ({ baseArgs }) => baseArgs,
      projectNativeToolAuthority,
      config: createJsonlStdinBackendConfig("native-cli"),
    });
    const context = await fixture.prepare({ provider: "native-cli", ...overrides });
    const capture = expectDefined(context.preparedBackend.mcpClientGrantCapture, "native capture");
    const observe = expectDefined(capture.captureNativeTools, "native tools observer");
    return {
      capture,
      observe,
      mintMcpLoopbackClientGrant,
      projectNativeToolAuthority,
      captureNativeToolAuthority,
    };
  }

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

  it("fails bundled MCP preparation when the loopback runtime is unavailable", async () => {
    registerTestMemoryPromptBuilder(({ availableTools }) =>
      availableTools.has("memory_search")
        ? ["## Memory Recall", `tools=${[...availableTools].toSorted().join(",")}`, ""]
        : [],
    );
    const getActiveMcpLoopbackRuntime = vi.fn(() => undefined);
    const ensureMcpLoopbackServer = vi.fn(async () => {
      throw new Error("loopback unavailable");
    });
    const createMcpLoopbackServerConfig = vi.fn(createTestMcpLoopbackServerConfig);
    const resolveMcpLoopbackScopedTools = vi.fn(() => ({
      agentId: "main",
      tools: [
        {
          name: "memory_search",
          label: "Memory Search",
          description: "Search memory",
          parameters: { type: "object", properties: {} },
          execute: vi.fn(),
        },
      ],
    }));
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
      ensureMcpLoopbackServer,
      createMcpLoopbackServerConfig,
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
    await expect(
      fixture.prepare({
        sessionKey: "agent:main:test",
        provider: "native-cli",
        config: createCliBackendConfig({ bundleMcp: true }),
      }),
    ).rejects.toThrow(/loopback unavailable/);

    expect(ensureMcpLoopbackServer).toHaveBeenCalledTimes(1);
    expect(getActiveMcpLoopbackRuntime).toHaveBeenCalledTimes(1);
    expect(createMcpLoopbackServerConfig).not.toHaveBeenCalled();
    expect(resolveMcpLoopbackScopedTools).not.toHaveBeenCalled();
  });

  it("preserves already-admitted authority through MCP grant transfer", async () => {
    const explicitAgentId = "worker";
    const messageActionTurnCapability = "test-current-message-authority";
    const getActiveMcpLoopbackRuntime = vi.fn(createLoopbackRuntime);
    const activateMcpLoopbackClientGrantCapture = vi.fn(() => ({
      captureNativeToolAuthority: vi.fn((_names: readonly string[] | null) => true),
    }));
    const deactivateMcpLoopbackClientGrantCapture = vi.fn(() => true);
    const transferMcpLoopbackClientGrant = vi.fn(() => true);
    const mintMcpLoopbackClientGrant = vi.fn(createTestMcpLoopbackClientGrant);
    const revokeMcpLoopbackClientGrant = vi.fn(() => true);
    const resolveMcpLoopbackScopedTools = vi.fn(() => ({
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
    }));
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
      activateMcpLoopbackClientGrantCapture,
      deactivateMcpLoopbackClientGrantCapture,
      transferMcpLoopbackClientGrant,
      mintMcpLoopbackClientGrant,
      revokeMcpLoopbackClientGrant,
      resolveMcpLoopbackScopedTools,
    });
    setRawCliBackendForPrepareTest({
      id: "native-cli",
      pluginId: "native-plugin",
      bundleMcp: true,
      bundleMcpMode: "codex-config-overrides",
      config: {
        command: "native-cli",
        args: ["--print"],
        input: "arg",
        sessionMode: "existing",
      },
    });
    const context = await fixture.prepare({
      sessionKey: "agent:main:telegram:group:chat123",
      runtimePolicySessionKey: "agent:worker:discord:default:direct:canonical-sender",
      agentId: explicitAgentId,
      provider: "native-cli",
      modelProvider: "anthropic",
      runId: "run-test-room-event-tools",
      messageActionTurnCapability,
      sessionEntry: {
        execHost: "node",
        execNode: "mac-a",
      } as never,
      execOverrides: {
        host: "node",
        security: "allowlist",
        ask: "always",
        node: "mac-b",
      },
      bashElevated: {
        enabled: true,
        allowed: true,
        defaultLevel: "full",
        fullAccessAvailable: false,
        fullAccessBlockedReason: "runtime",
      },
      trigger: "user",
      currentInboundEventKind: "room_event",
      messageChannel: "telegram",
      messageProvider: "discord",
      clientCaps: ["tool-events", "inline-widgets"],
      pinnedWidgetAuthoring: true,
      currentChannelId: "telegram:-100123:topic:42",
      currentThreadTs: "42",
      currentMessageId: "reply-message-1",
      currentInboundAudio: true,
      sourceReplyDeliveryMode: "message_tool_only",
      taskSuggestionDeliveryMode: "gateway",
      requireExplicitMessageTarget: true,
      approvalReviewerDeviceId: "reviewer-device",
      senderId: "canonical-sender",
      senderName: "Canonical Name",
      senderUsername: "canonical-user",
      senderE164: "+15551234567",
      groupId: "chat123",
      groupChannel: "ops",
      groupSpace: "workspace-a",
      spawnedBy: "agent:main:telegram:group:parent",
      channelContext: {
        sender: { id: "sender-1", displayName: "not-forwarded" },
        chat: { id: "chat-1", title: "not-forwarded" },
      },
    });

    expect(context.preparedBackend.env).toMatchObject({
      BRANCH_MCP_TOKEN: "loopback-token",
      BRANCH_MCP_CLI_CAPTURE_KEY: "",
    });
    expect(JSON.stringify(context.preparedBackend.env)).not.toContain(messageActionTurnCapability);
    expect(mintMcpLoopbackClientGrant).toHaveBeenCalledWith({
      context: {
        sessionKey: "agent:main:telegram:group:chat123",
        runtimePolicySessionKey: "agent:worker:discord:default:direct:canonical-sender",
        runtimePolicyAgentId: "worker",
        agentId: "main",
        sessionId: "session-test",
        runId: "run-test-room-event-tools",
        workspaceDir: context.workspaceDir,
        modelProvider: "anthropic",
        modelId: "test-model",
        messageProvider: "telegram",
        clientCaps: ["tool-events", "inline-widgets"],
        pinnedWidgetAuthoring: true,
        currentChannelId: "telegram:-100123:topic:42",
        currentThreadTs: "42",
        currentMessageId: "reply-message-1",
        currentInboundAudio: true,
        accountId: undefined,
        inboundEventKind: "room_event",
        sourceReplyDeliveryMode: "message_tool_only",
        taskSuggestionDeliveryMode: "gateway",
        requireExplicitMessageTarget: true,
        senderIsOwner: false,
        nodeExecAllowed: true,
        execSession: {
          execHost: "node",
          execNode: "mac-a",
        },
        execOverrides: {
          host: "node",
          security: "allowlist",
          ask: "always",
          node: "mac-b",
        },
        bashElevated: {
          enabled: true,
          allowed: true,
          defaultLevel: "full",
          fullAccessAvailable: false,
          fullAccessBlockedReason: "runtime",
        },
        trigger: "user",
        approvalReviewerDeviceId: "reviewer-device",
        channelContext: {
          sender: { id: "canonical-sender" },
          chat: { id: "chat-1" },
        },
        senderName: "Canonical Name",
        senderUsername: "canonical-user",
        senderE164: "+15551234567",
        groupId: "chat123",
        groupChannel: "ops",
        groupSpace: "workspace-a",
        spawnedBy: "agent:main:telegram:group:parent",
      },
      runtimeOwnerToken: "loopback-owner-token",
      admittedRunContext: context.params.admittedRunContext,
      messageActionTurnCapability,
      bindQuestionAnswerAuthority: expect.any(Function),
      toolAuth: {
        agentDir: expect.any(String),
        store: expect.objectContaining({ version: 1, profiles: {} }),
      },
    });
    expect(context.preparedBackend.mcpClientGrantCapture?.transportToken).toBe("loopback-token");
    context.preparedBackend.mcpClientGrantCapture?.adoptProcessToken("stable-loopback-token");
    const assertCaptureCurrent = () => {};
    context.preparedBackend.mcpClientGrantCapture?.activate("capture-test", assertCaptureCurrent);
    context.preparedBackend.mcpClientGrantCapture?.deactivate("capture-test");
    expect(transferMcpLoopbackClientGrant).toHaveBeenCalledExactlyOnceWith({
      sourceToken: "loopback-token",
      targetToken: "stable-loopback-token",
      runtimeOwnerToken: "loopback-owner-token",
    });
    expect(activateMcpLoopbackClientGrantCapture).toHaveBeenCalledExactlyOnceWith({
      token: "stable-loopback-token",
      runtimeOwnerToken: "loopback-owner-token",
      captureKey: "capture-test",
      assertCurrent: assertCaptureCurrent,
    });
    expect(deactivateMcpLoopbackClientGrantCapture).toHaveBeenCalledExactlyOnceWith({
      token: "stable-loopback-token",
      runtimeOwnerToken: "loopback-owner-token",
      captureKey: "capture-test",
    });
    context.preparedBackend.mcpClientGrantCapture?.revokeProcessToken();
    expect(revokeMcpLoopbackClientGrant).toHaveBeenCalledExactlyOnceWith("stable-loopback-token");
    expect(context.mcpDeliveryCapture).toBe(true);
    expect(context.systemPrompt).toContain(
      "`send`: `target` + `message`; target required this turn",
    );
    expect(context.systemPrompt).not.toContain("current source is default target");
    await context.preparedBackend.cleanup?.();
    expect(revokeMcpLoopbackClientGrant).toHaveBeenCalledTimes(2);
    expect(revokeMcpLoopbackClientGrant).toHaveBeenLastCalledWith("loopback-token");
  });

  it.each([
    {
      name: "host selection",
      observed: ["Read", "Bash", "Write"],
      selected: ["Read"],
      projected: ["Read"],
      capabilities: ["read"],
    },
    {
      name: "observed empty surface",
      observed: [],
      selected: undefined,
      projected: [],
      capabilities: [],
    },
  ])(
    "bounds native authority by $name",
    async ({ observed, selected, projected, capabilities }) => {
      const { capture, observe, projectNativeToolAuthority, captureNativeToolAuthority } =
        await prepareNativeAuthority(
          capabilities,
          selected === undefined
            ? {}
            : { cliToolAvailability: { native: selected, branch: ["message"] } },
        );
      capture.activate("native-capture", () => {});
      observe(observed);

      expect(projectNativeToolAuthority).toHaveBeenCalledExactlyOnceWith(projected);
      expect(captureNativeToolAuthority).toHaveBeenLastCalledWith(capabilities);
    },
  );

  it.each([
    { name: "missing", tools: undefined },
    { name: "mixed", tools: ["Read", 7] },
  ])("clears native authority before rejecting a $name runtime snapshot", async ({ tools }) => {
    const {
      capture,
      observe,
      mintMcpLoopbackClientGrant,
      projectNativeToolAuthority,
      captureNativeToolAuthority,
    } = await prepareNativeAuthority(["read"]);
    expect(
      mintMcpLoopbackClientGrant.mock.calls[0]?.[0]?.context.nativeCronCreatorToolAllowlist,
    ).toBeNull();
    expect(projectNativeToolAuthority).not.toHaveBeenCalled();
    expect(captureNativeToolAuthority).not.toHaveBeenCalled();
    capture.activate("native-capture", () => {});
    observe(["Read"]);
    expect(projectNativeToolAuthority).toHaveBeenCalledExactlyOnceWith(["Read"]);
    expect(captureNativeToolAuthority.mock.calls).toEqual([[null], [["read"]]]);
    projectNativeToolAuthority.mockClear();

    expect(() => observe(tools)).toThrow("invalid tool list");
    expect(captureNativeToolAuthority).toHaveBeenLastCalledWith(null);
    expect(projectNativeToolAuthority).not.toHaveBeenCalled();
  });

  it("clears native authority before rejecting a non-canonical backend projection", async () => {
    const { capture, observe, projectNativeToolAuthority, captureNativeToolAuthority } =
      await prepareNativeAuthority(["read"]);
    capture.activate("native-capture", () => {});
    observe(["Read"]);
    projectNativeToolAuthority.mockReturnValue(["Bash"]);

    expect(() => observe(["Read", "Bash"])).toThrow('non-canonical native capability "Bash"');
    expect(captureNativeToolAuthority).toHaveBeenLastCalledWith(null);
  });

  it.each(["unactivated", "stale"] as const)(
    "rejects native authority updates while capture is %s",
    async (state) => {
      const { capture, observe, projectNativeToolAuthority, captureNativeToolAuthority } =
        await prepareNativeAuthority(["read"]);
      if (state === "stale") {
        capture.activate("native-capture", () => {});
        observe(["Read"]);
        captureNativeToolAuthority.mockReturnValue(false);
        projectNativeToolAuthority.mockClear();
      }

      expect(() => observe(["Read", "Bash"])).toThrow("capture is no longer active");
      expect(projectNativeToolAuthority).not.toHaveBeenCalled();
    },
  );

  it("fails closed with upgrade guidance when a backend cannot enforce a runtime toolsAllow", async () => {
    const getActiveMcpLoopbackRuntime = vi.fn(createLoopbackRuntime);
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
    });

    const run = fixture.prepare({
      config: createCliBackendConfig({ bundleMcp: true }),
      toolsAllow: ["read", "web_search"],
    });
    await expect(run).rejects.toThrow(
      `CLI backend "test-cli" cannot enforce this run's tool cap. Upgrade its plugin and retry; if current, ask its maintainer to add exact-cap support. Branch Agent did not start the run.`,
    );

    expect(getActiveMcpLoopbackRuntime).not.toHaveBeenCalled();
  });

  it("materializes runtime toolsAllow for selectable backends without bundle MCP", async () => {
    const resolveExecutionArgs = vi.fn((context: { baseArgs: readonly string[] }) => [
      ...context.baseArgs,
    ]);
    const resolveMcpLoopbackPolicyTools = vi.fn((_scope: McpProjectionParams) => ({
      agentId: "main",
      tools: ["write", "apply_patch"].map((name) => ({ name })),
    }));
    setRawCliBackendForPrepareTest({
      id: "selectable-cli",
      pluginId: "selectable-plugin",
      bundleMcp: false,
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "execution-args",
      resolveExecutionArgs,
      config: createJsonlStdinBackendConfig("selectable-cli"),
    });
    setCliRunnerPrepareTestDeps({ resolveMcpLoopbackPolicyTools });

    const originalToolsAllow = ["write"];
    const context = await fixture.prepare({
      provider: "selectable-cli",
      sessionKey: "agent:main:main",
      modelProvider: "policy-provider",
      model: "policy-model",
      senderIsOwner: false,
      clientCaps: ["original-client"],
      toolsAllow: originalToolsAllow,
    });
    const bindQuestionAuthority = expectDefined(
      context.bindQuestionAnswerAuthority,
      "question authority",
    );
    const questionAuthority = bindQuestionAuthority(() => {});
    originalToolsAllow.push("exec");
    const caller = {
      senderIsOwner: false,
      disableTools: false,
      clientCaps: ["original-client"],
      toolsAllow: ["write"],
      traceAuthorized: false,
    };
    expect(context.params.toolsAllow).toBeUndefined();
    expect(() => questionAuthority.assertCaller(caller)).not.toThrow();
    expect(() => questionAuthority.assertCaller({ ...caller, toolsAllow: undefined })).toThrow(
      "caller policy",
    );
    expect(() => questionAuthority.assertCaller({ ...caller, clientCaps: [] })).toThrow(
      "caller policy",
    );

    expect(context.params.cliToolAvailability).toEqual({
      native: [],
      branch: ["write", "apply_patch"],
    });
    expect(resolveMcpLoopbackPolicyTools).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ toolsAllow: ["write"] }) }),
    );
  });

  it.each([
    "direct-with-placeholder",
    "reply-owned",
    "creator-closed",
    "caller-retired",
    "request-cancelled",
    "retained-after-exit",
  ] as const)("binds prepared %s native questions to the actual CLI creator", async (mode) => {
    const config = { tools: { exec: { security: "full", ask: "off" } } } satisfies BranchConfig;
    const runId = `native-question-${mode}`;
    const admission = prepareSystemAgentRunAdmission(
      config,
      runId,
      "main",
      "native-question-proof",
    );
    const sourceAbort = new AbortController();
    const requestAbort = new AbortController();
    let callerCurrent = true;
    const promptDelivered = createDeferred();
    const nativeToolCallId = `native-input-${mode}`;
    const questionId = `${nativeToolCallId}:0`;
    const request = {
      toolName: "AskUserQuestion",
      toolCallId: nativeToolCallId,
      abortSignal: requestAbort.signal,
      questions: [
        {
          id: "choice",
          header: "Choice",
          question: "Continue?",
          isOther: true,
          options: [{ label: "Continue" }, { label: "Stop" }],
        },
      ],
    };
    let retainedRequest: CliBackendExecuteContext["requestUserInput"] | undefined;
    let nativeAnswer: Awaited<ReturnType<CliBackendExecuteContext["requestUserInput"]>> | undefined;
    const execute: CliBackendExecute = async function* (execution) {
      retainedRequest = execution.requestUserInput;
      expect(execution.modelId).toBe("creator-model");
      if (mode !== "retained-after-exit") {
        nativeAnswer = await execution.requestUserInput(request);
      }
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "completed",
        session_id: "native-session",
      };
    };
    setRawCliBackendForPrepareTest({
      id: "native-question-cli",
      pluginId: "native-question-plugin",
      bundleMcp: false,
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "execution-args",
      resolveExecutionArgs: ({ baseArgs }) => [...baseArgs],
      prepareExecution: async () => ({ execute }),
      config: {
        // Any executable that resolves on every OS; the fake execute never spawns it.
        command: process.execPath,
        args: [],
        input: "stdin",
        output: "jsonl",
        sessionMode: "existing",
      },
    });
    const session = fixture.session;
    const original = {
      sessionId: session.sessionTarget.sessionId,
      sessionKey: session.sessionTarget.sessionKey,
      sessionFile: session.sessionFile,
      workspaceDir: session.dir,
      cwd: session.dir,
      agentId: "main",
      provider: "native-question-cli",
      modelProvider: "question-policy",
      model: "creator-model",
      config,
      messageProvider: "webchat",
      senderIsOwner: false,
      clientCaps: ["creator-client"],
      approvalReviewerDeviceId: "creator-reviewer",
      cliToolAvailability: { native: ["AskUserQuestion"], branch: [] },
    };
    const sourceRoute = { provider: original.modelProvider, model: original.model };
    const caller = {
      senderIsOwner: false,
      disableTools: false,
      messageProvider: "webchat",
      clientCaps: ["creator-client"],
      approvalReviewerDeviceId: "creator-reviewer",
      traceAuthorized: mode === "reply-owned",
    };
    let sourceOperation: ReplyOperation | undefined;
    let answeringPlaceholder: ReplyOperation | undefined;
    let cleanup: (() => Promise<void>) | undefined;
    try {
      if (mode === "reply-owned") {
        sourceOperation = createReplyOperation({
          sessionId: original.sessionId,
          sessionKey: original.sessionKey,
          resetTriggered: false,
        });
        sourceOperation.bindToolAuthoritySnapshot(
          prepareReplyToolAuthority({
            run: { ...original, provider: sourceRoute.provider, traceAuthorized: true },
          }),
        );
      }
      const toolAuthorityFingerprint = sourceOperation?.bindToolAuthorityRoute(sourceRoute);
      const context = await fixture.prepare({
        ...original,
        runId,
        timeoutMs: 10_000,
        preparedRunAdmission: admission,
        abortSignal: sourceAbort.signal,
        assertCurrent: () => {
          if (!callerCurrent) {
            throw new Error("original CLI caller retired");
          }
        },
        replyOperation: sourceOperation,
        toolAuthorityFingerprint,
        onPartialReply: async () => promptDelivered.resolve(),
      });
      cleanup = context.preparedBackend.cleanup;
      sourceOperation?.setPhase("running");
      const target = context.executionTarget;
      if (target.kind !== "plugin") {
        throw new Error("Expected the prepared native plugin execution target");
      }
      await withQuestionGateway(async (gateway) => {
        // This suite normally stubs runtime config; the shared peer owns the exact test port.
        getRuntimeConfigMock.mockImplementation(() =>
          expectDefined(getRuntimeConfigSnapshot(), "isolated question Gateway config"),
        );
        const processRun = executePluginOwnedProcess({
          context,
          execute: target.execute,
          executionCommand: process.execPath,
          executionArgs: [],
          env: { PATH: "/bin:/usr/bin" },
          prompt: context.params.prompt,
          useResume: false,
          noOutputTimeoutMs: 5_000,
          consumeStdout: () => {},
        });
        void processRun.catch(() => undefined);
        try {
          if (mode === "retained-after-exit") {
            await processRun;
            const invoke = expectDefined(retainedRequest, "retained native input callback");
            await expect(invoke(request)).resolves.toMatchObject({ status: "cancelled" });
            expect(gateway.requests).toHaveLength(0);
            return;
          }
          await Promise.race([
            promptDelivered.promise,
            processRun.then(() => {
              throw new Error("Native process ended before its question was presented");
            }),
          ]);
          if (mode === "direct-with-placeholder") {
            // A later answer can own a different next-turn model; it is not this question's creator.
            answeringPlaceholder = createReplyOperation({
              sessionId: original.sessionId,
              sessionKey: original.sessionKey,
              resetTriggered: false,
            });
            const nextRoute = { provider: "next-policy", model: "next-model" };
            answeringPlaceholder.bindToolAuthoritySnapshot(
              prepareReplyToolAuthority({
                run: { ...original, ...nextRoute, clientCaps: [] },
              }),
            );
            answeringPlaceholder.bindToolAuthorityRoute(nextRoute);
            expect(replyRunRegistry.get(original.sessionKey)).toBe(answeringPlaceholder);
          }
          const answer = () =>
            claimPendingAgentQuestionAnswerFromCaller({
              sessionKey: original.sessionKey,
              text: "Continue",
              caller,
              assertSourceCurrent: () => {},
            });
          if (mode === "creator-closed") {
            admission.close();
            await expect(answer()).rejects.toThrow("no longer active");
            expect(
              gateway.requests.filter((frame) => frame.method === "question.resolve"),
            ).toHaveLength(0);
            requestAbort.abort();
            await processRun;
            expect(nativeAnswer).toMatchObject({ status: "cancelled" });
          } else if (mode === "caller-retired") {
            callerCurrent = false;
            await expect(answer()).rejects.toThrow("original CLI caller retired");
            expect(
              gateway.requests.filter((frame) => frame.method === "question.resolve"),
            ).toHaveLength(0);
            // A late Gateway answer cannot revive the retired native caller.
            gateway.manager.resolve(questionId, { answers: { choice: ["Continue"] } });
            await processRun;
            expect(nativeAnswer).toMatchObject({ status: "cancelled" });
            expect(sourceAbort.signal.aborted).toBe(false);
            expect(requestAbort.signal.aborted).toBe(false);
            expect(
              getAdmittedRunDelegatedAuthority(context.params.admittedRunContext),
            ).toBeDefined();
          } else if (mode === "request-cancelled") {
            requestAbort.abort();
            await processRun;
            expect(nativeAnswer).toMatchObject({ status: "cancelled" });
            await expect(answer()).resolves.toBe(false);
            await expect(gateway.manager.waitAnswer(questionId)).resolves.toMatchObject({
              status: "cancelled",
            });
          } else {
            await expect(
              claimPendingAgentQuestionAnswerFromCaller({
                sessionKey: original.sessionKey,
                text: "Continue",
                caller: { ...caller, clientCaps: [] },
                assertSourceCurrent: () => {},
              }),
            ).rejects.toThrow("caller policy");
            expect(
              gateway.requests.filter((frame) => frame.method === "question.resolve"),
            ).toHaveLength(0);
            await expect(answer()).resolves.toBe(true);
            await processRun;
            expect(nativeAnswer).toEqual({ status: "answered", answers: { choice: ["Continue"] } });
            if (sourceOperation) {
              expect(sourceOperation.toolAuthorityRoute).toEqual(sourceRoute);
            }
          }
        } finally {
          requestAbort.abort();
          sourceAbort.abort();
          await processRun.catch(() => undefined);
        }
      });
    } finally {
      requestAbort.abort();
      sourceAbort.abort();
      answeringPlaceholder?.complete();
      sourceOperation?.complete();
      admission.close();
      await cleanup?.();
    }
  });

  it("lets disableTools override a selectable backend toolsAllow projection", async () => {
    const resolveExecutionArgs = vi.fn((context: { baseArgs: readonly string[] }) => [
      ...context.baseArgs,
    ]);
    setRawCliBackendForPrepareTest({
      id: "selectable-cli",
      pluginId: "selectable-plugin",
      bundleMcp: false,
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "execution-args",
      resolveExecutionArgs,
      config: createJsonlStdinBackendConfig("selectable-cli"),
    });

    const context = await fixture.prepare({
      provider: "selectable-cli",
      disableTools: true,
      toolsAllow: ["write"],
    });

    expect(context.params.cliToolAvailability).toEqual({ native: [], branch: [] });
  });

  it("preserves preparation refusal when cleanup fails", async () => {
    const cleanup = vi.fn(async () => {
      throw new Error("preparation cleanup failed");
    });
    const prepareExecution = vi.fn(async () => ({ cleanup }));
    setRawCliBackendForPrepareTest({
      id: "settings-cli",
      pluginId: "settings-plugin",
      bundleMcp: false,
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "prepare-execution",
      prepareExecution,
      config: createJsonlStdinBackendConfig("settings-cli"),
    });

    const cleanupScope = createAgentCleanupScope();
    await expect(
      cleanupScope.run(() =>
        fixture.prepare({
          provider: "settings-cli",
          disableTools: true,
          oneShotCliRun: true,
        }),
      ),
    ).rejects.toThrow(
      "did not enforce exact per-run tool availability during execution preparation",
    );
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({ toolAvailability: { native: [], branch: [] } }),
    );
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanupScope.outcome).toBe("uncertain");
  });

  it.each(["selectable", "always-on"] as const)(
    "rejects disableTools before initializing MCP when a %s backend cannot disable native tools",
    async (nativeToolMode) => {
      const getActiveMcpLoopbackRuntime = vi.fn(() => ({
        port: 31783,
        ownerToken: "synthetic-loopback-owner",
        nonOwnerToken: "synthetic-loopback-non-owner",
      }));
      setCliRunnerPrepareTestDeps({ getActiveMcpLoopbackRuntime });
      setRawCliBackendForPrepareTest({
        id: "native-cli",
        pluginId: "native-plugin",
        bundleMcp: true,
        bundleMcpMode: "codex-config-overrides",
        nativeToolMode,
        config: createJsonlStdinBackendConfig("native-cli"),
      });

      await expect(
        fixture.prepare({
          provider: "native-cli",
          disableTools: true,
        }),
      ).rejects.toThrow(
        "CLI backend native-cli cannot run with tools disabled because it exposes native tools",
      );
      expect(getActiveMcpLoopbackRuntime).not.toHaveBeenCalled();
    },
  );

  it("privately forwards isolated-completion system prompts to bundled preparation", async () => {
    const { dir } = fixture.session;
    const prepareExecution = vi.fn(async () => ({
      isolatedCompletionEnforced: true as const,
      toolAvailabilityEnforced: true as const,
    }));
    setRawCliBackendForPrepareTest({
      id: "google-gemini-cli",
      pluginId: "google",
      bundleMcp: false,
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "prepare-execution",
      prepareExecution,
      config: {
        command: "gemini",
        args: ["--prompt", "{prompt}"],
        output: "jsonl",
        input: "arg",
        sessionMode: "existing",
      },
    });

    await fixture.prepare({
      provider: "google-gemini-cli",
      executionMode: "side-question",
      isolatedCompletion: true,
      extraSystemPrompt: "Return only valid JSON.",
      cliToolAvailability: { native: [], branch: [] },
    });

    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        isolatedCompletionCwd: dir,
        isolatedCompletionModelId: "test-model",
        isolatedCompletionPrompt: "latest ask",
        isolatedCompletionSystemPrompt: "Return only valid JSON.",
      }),
    );
  });

  it("rejects a CLI backend that does not adopt isolated completion", async () => {
    const cleanup = vi.fn(async () => {});
    const prepareExecution = vi.fn(async () => ({
      cleanup,
      toolAvailabilityEnforced: true as const,
    }));
    setRawCliBackendForPrepareTest({
      id: "external-cli",
      pluginId: "external",
      bundleMcp: false,
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "prepare-execution",
      prepareExecution,
      config: {
        command: "external-cli",
        args: ["--print"],
        output: "jsonl",
        input: "stdin",
        sessionMode: "none",
      },
    });

    await expect(
      fixture.prepare({
        provider: "external-cli",
        executionMode: "side-question",
        isolatedCompletion: true,
        cliToolAvailability: { native: [], branch: [] },
      }),
    ).rejects.toMatchObject({
      code: "unsupported",
      message:
        'CLI backend "external-cli" does not support isolated completion; Branch Agent did not start the run.',
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

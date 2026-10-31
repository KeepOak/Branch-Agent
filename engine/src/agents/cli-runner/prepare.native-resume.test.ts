// Exercises CLI preparation, auth, prompt hooks, MCP setup, and session reuse.
import fs from "node:fs";
import path from "node:path";
import { expectDefined } from "@branch/normalization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserMessage } from "../../../test/helpers/user-message.js";
import { runWithCliHistoryWriter } from "../../config/sessions/cli-history-boundary.js";
import {
  loadSessionEntryReadOnly,
  replaceSessionEntrySync,
  patchSessionEntryCore,
} from "../../config/sessions/session-accessor.js";
import { setActiveNodeContexts } from "../../infra/active-node-context.js";
import type { CliBackendExecute } from "../../plugins/cli-backend.types.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { createUserTurnTranscriptRecorder } from "../../sessions/user-turn-transcript.js";
import type { SkillLibraryAuthoringCapability } from "../../skills/library/authoring.js";
import { prepareSystemAgentRunAdmission } from "../admitted-run-context.js";
import { createAuthProfileStoreFixture } from "../auth-profiles/credential-fixtures.test-support.js";
import { saveAuthProfileStore } from "../auth-profiles/store-runtime.js";
import { CLI_AUTH_EPOCH_VERSION, resolveCliAuthEpoch } from "../cli-auth-epoch.js";
import {
  createCliRunnerPrepareFixture,
  createTestMcpLoopbackClientGrant,
  createTestMcpLoopbackServer,
} from "../cli-runner.test-helpers.js";
import {
  applyCliSessionBindingResult,
  clearCliSession,
  getCliSessionBinding,
  hashCliSessionText,
} from "../cli-session.js";
import type { SandboxWorkspaceInfo } from "../sandbox/types.js";
import type { SystemAgentToolOptions } from "../tools/system-agent-tool.js";
import { prepareCliBundleMcpCaptureAttempt, prepareCliBundleMcpConfig } from "./bundle-mcp.js";
import { prepareCliHistoryBoundary } from "./history-boundary.js";
import { setRawCliBackendForPrepareTest } from "./prepare-mcp.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  createArgBackendConfig,
  createCliBackendConfig,
  createJsonlStdinBackendConfig,
  createLoopbackRuntime,
  setCliBackendForPrepareTest,
  installCliRunnerPrepareTestDoubles,
  resetCliRunnerPrepareTestDoubles,
} from "./prepare.shared.test-support.js";
import { setCliRunnerPrepareTestDeps } from "./prepare.test-support.js";
import type { RunCliAgentParams } from "./types.js";

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

describe("prepareCliRunContext", () => {
  let fixture: ReturnType<typeof createCliRunnerPrepareFixture>;

  async function withAuthenticatedHistory(
    provider: string,
    run: (
      prepare: (
        overrides: NonNullable<Parameters<typeof fixture.prepare>[0]>,
      ) => ReturnType<typeof fixture.prepare>,
    ) => Promise<void>,
  ) {
    const { dir, sessionTarget } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "history-test:account";
    const credential = {
      type: "token" as const,
      provider: provider === "claude-cli" ? "anthropic" : provider,
      token: "synthetic-history-account",
    };
    saveAuthProfileStore({ version: 1, profiles: { [authProfileId]: credential } }, agentDir);
    const authEpoch = await resolveCliAuthEpoch({ provider, agentDir, authProfileId });
    const runId = "authenticated-history-fixture";
    await patchSessionEntryCore(sessionTarget, (entry) => ({ ...entry, activeWriterRunId: runId }));
    const admission = prepareSystemAgentRunAdmission({}, runId, "main", "history-fixture");
    try {
      const admittedRunContext = await admission.admit("embedded");
      const writer = await prepareCliHistoryBoundary(
        {
          admittedRunContext,
          runId,
          agentDir,
          provider,
          model: "test-model",
          prompt: "seed",
          workspaceDir: dir,
          timeoutMs: 1000,
          sessionId: sessionTarget.sessionId,
          sessionKey: sessionTarget.sessionKey,
          sessionFile: sessionTarget.sessionKey,
          sessionTarget,
        },
        { credential },
      );
      expect(writer).toBeDefined();
      await runWithCliHistoryWriter(writer, () =>
        run((overrides) =>
          fixture.prepare({
            ...overrides,
            provider,
            agentDir,
            authProfileId,
            runId,
            preparedRunAdmission: admission,
            sessionKey: sessionTarget.sessionKey,
            ...(overrides.cliSessionBinding
              ? {
                  cliSessionBinding: {
                    ...overrides.cliSessionBinding,
                    authProfileId,
                    authEpoch,
                    authEpochVersion: CLI_AUTH_EPOCH_VERSION,
                  },
                }
              : {}),
          }),
        ),
      );
    } finally {
      admission.close();
    }
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

  it("projects only the personal Workshop for node-placed Claude", async () => {
    const skillLibraryAuthoring: SkillLibraryAuthoringCapability = {
      target: "personal",
      defaultTarget: "workspace",
      multipleProfiles: true,
      bind: vi.fn(),
      invoke: vi.fn(),
    };
    const resolveMcpLoopbackScopedTools = vi.fn(() => ({
      agentId: "main",
      tools: [
        {
          name: "skill_workshop",
          label: "Skill Workshop",
          description: "Manage skills",
          parameters: { type: "object", properties: {} },
          execute: vi.fn(),
        },
      ],
    }));
    setCliRunnerPrepareTestDeps({ resolveMcpLoopbackScopedTools });
    const prepareExecution = vi.fn(async () => ({ toolAvailabilityEnforced: true as const }));
    setRawCliBackendForPrepareTest({
      id: "claude-cli",
      pluginId: "anthropic",
      bundleMcp: false,
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "prepare-execution",
      prepareExecution,
      config: createJsonlStdinBackendConfig("claude"),
    });

    const context = await fixture.prepare({
      provider: "claude-cli",
      sessionEntry: { execHost: "node", execNode: "node-a" } as never,
      cliToolAvailability: { native: ["Read"], branch: ["message", "skill_workshop"] },
      skillLibraryAuthoring,
    });

    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        toolAvailability: { native: ["Read"], branch: ["skill_workshop"] },
      }),
    );
    expect(context.params.cliToolAvailability).toEqual({
      native: ["Read"],
      branch: ["skill_workshop"],
    });

    expect(resolveMcpLoopbackScopedTools).toHaveBeenCalledWith(
      expect.objectContaining({
        skillLibraryAuthoring: { ...skillLibraryAuthoring, defaultTarget: "personal" },
      }),
    );
    expect(context.nodeSkillWorkshop?.name).toBe("skill_workshop");
    expect(context.systemPromptReport.tools.entries.map((tool) => tool.name)).toContain(
      "skill_workshop",
    );

    await context.preparedBackend.cleanup?.();
  });

  it.each([
    {
      name: "materializes exact availability when the caller did not provide it",
      cliToolAvailability: undefined,
      hookToolsAllow: ["read"],
      projectedToolNames: ["read", "message"],
    },
    {
      name: "keeps existing CLI availability as the upper bound",
      cliToolAvailability: { native: [], branch: ["read", "message"] },
      hookToolsAllow: ["read", "write"],
      projectedToolNames: ["read", "message", "write"],
    },
  ])(
    "applies before_prompt_build tool filtering before CLI guidance and submission: $name",
    async ({ cliToolAvailability, hookToolsAllow, projectedToolNames }) => {
      const prepareExecution = vi.fn(async () => ({ toolAvailabilityEnforced: true as const }));
      const mintMcpLoopbackClientGrant = vi.fn(createTestMcpLoopbackClientGrant);
      const hookRunner = {
        hasHooks: vi.fn((hookName: string) => hookName === "before_prompt_build"),
        runBeforePromptBuild: vi.fn(async () => ({ toolsAllow: hookToolsAllow })),
      };
      mockGetGlobalHookRunner.mockReturnValue(hookRunner as never);
      setRawCliBackendForPrepareTest({
        id: "claude-cli",
        pluginId: "anthropic",
        bundleMcp: true,
        bundleMcpMode: "claude-config-file",
        nativeToolMode: "selectable",
        toolAvailabilityEnforcement: "prepare-execution",
        prepareExecution,
        config: createJsonlStdinBackendConfig("claude"),
      });
      setCliRunnerPrepareTestDeps({
        getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
        mintMcpLoopbackClientGrant,
        resolveMcpLoopbackScopedTools: vi.fn(() => ({
          agentId: "main",
          tools: projectedToolNames.map((name) => ({ name })),
        })),
      });
      const finalizePromptForResolvedTools = vi.fn(
        ({ prompt, messageToolAvailable }: { prompt: string; messageToolAvailable: boolean }) =>
          `${prompt}\nmessage-tool-available:${messageToolAvailable}`,
      );

      const context = await fixture.prepare({
        provider: "claude-cli",
        ...(cliToolAvailability ? { cliToolAvailability } : {}),
        finalizePromptForResolvedTools,
      });

      expect(hookRunner.runBeforePromptBuild).toHaveBeenCalledTimes(1);
      expect(hookRunner.runBeforePromptBuild.mock.invocationCallOrder[0]).toBeLessThan(
        prepareExecution.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
      expect(context.params.cliToolAvailability).toEqual({
        native: [],
        branch: ["read"],
      });
      expect(prepareExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          toolAvailability: { native: [], branch: ["read"] },
        }),
      );
      expect(mintMcpLoopbackClientGrant.mock.calls[0]?.[0]?.context.toolsAllow).toEqual(["read"]);
      expect(context.systemPromptReport.tools.entries.map((entry) => entry.name)).toEqual(["read"]);
      expect(finalizePromptForResolvedTools).toHaveBeenCalledWith({
        prompt: "latest ask",
        messageToolAvailable: false,
      });
      expect(context.params.prompt).toContain("message-tool-available:false");
      expect(context.params.prompt).toContain(
        "For the current source conversation, reply normally in your final assistant message",
      );
      expect(context.params.prompt).not.toContain("message(action=send)");
      expect(context.params.prompt).not.toContain("target required this turn");
      expect(context.params.transcriptPrompt).toBe("latest ask");
      await context.preparedBackend.cleanup?.();
    },
  );

  it("fails closed when a prompt hook restricts an always-on CLI backend", async () => {
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "before_prompt_build"),
      runBeforePromptBuild: vi.fn(async () => ({ toolsAllow: ["read"] })),
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as never);
    setRawCliBackendForPrepareTest({
      id: "test-cli",
      pluginId: "test-plugin",
      bundleMcp: false,
      nativeToolMode: "always-on",
      config: createArgBackendConfig("test-cli"),
    });

    await expect(fixture.prepare({ provider: "test-cli" })).rejects.toThrow(
      'CLI backend "test-cli" cannot enforce before_prompt_build tool restrictions',
    );
  });

  it("bounds the loopback grant to the selectable MCP tool allowlist", async () => {
    const resolveExecutionArgs = vi.fn((context: { baseArgs: readonly string[] }) => [
      ...context.baseArgs,
    ]);
    const mintMcpLoopbackClientGrant = vi.fn(createTestMcpLoopbackClientGrant);
    setRawCliBackendForPrepareTest({
      id: "claude-cli",
      pluginId: "anthropic",
      bundleMcp: true,
      bundleMcpMode: "claude-config-file",
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "execution-args",
      resolveExecutionArgs,
      config: {
        command: "claude",
        args: ["--print"],
        output: "jsonl",
        jsonlDialect: "claude-stream-json",
        input: "stdin",
        sessionMode: "existing",
      },
    });
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
      mintMcpLoopbackClientGrant,
    });

    let cleanup: (() => Promise<void>) | undefined;
    try {
      const context = await fixture.prepare({
        sessionKey: "agent:main:main",
        provider: "claude-cli",
        config: {
          ...createCliBackendConfig(),
          mcp: {
            servers: {
              userProbe: { command: "node", args: ["user-probe.mjs"] },
            },
          },
        },
        cliToolAvailability: {
          native: [],
          branch: ["memory_search", "memory_get"],
        },
      });
      cleanup = context.preparedBackend.cleanup;

      // The grant carries exactly the canonical gateway tool names.
      const grantContext = mintMcpLoopbackClientGrant.mock.calls[0]?.[0]?.context;
      expect(grantContext?.toolsAllow).toEqual(["memory_search", "memory_get"]);

      // Restricted runs must not see user/plugin MCP servers: the generated
      // bundle serves only the grant-scoped loopback server.
      const args = context.preparedBackend.backend.args ?? [];
      const mcpConfigPath = args[args.indexOf("--mcp-config") + 1];
      const rawBundle = JSON.parse(fs.readFileSync(mcpConfigPath ?? "", "utf-8")) as {
        mcpServers?: Record<string, { timeout?: number }>;
      };
      expect(Object.keys(rawBundle.mcpServers ?? {})).toEqual(["branch"]);
      expect(rawBundle.mcpServers?.branch?.timeout).toBe(3_610_000);
    } finally {
      await cleanup?.();
    }
  });

  it("preserves an existing user MCP timeout beside the generated Claude loopback", async () => {
    const userMcpConfigPath = path.join(fixture.session.dir, "user-mcp.json");
    fs.writeFileSync(
      userMcpConfigPath,
      JSON.stringify({
        mcpServers: {
          localUser: {
            type: "http",
            url: "http://127.0.0.1:43119/mcp",
            timeout: 12_345,
          },
        },
      }),
    );
    setRawCliBackendForPrepareTest({
      id: "claude-cli",
      pluginId: "anthropic",
      bundleMcp: true,
      bundleMcpMode: "claude-config-file",
      config: {
        command: "claude",
        args: ["--print"],
        resumeArgs: ["--resume", "{sessionId}"],
        output: "jsonl",
        jsonlDialect: "claude-stream-json",
        input: "stdin",
        sessionMode: "existing",
      },
    });
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime: vi.fn(createLoopbackRuntime),
    });

    let cleanup: (() => Promise<void>) | undefined;
    let mergedCleanup: (() => Promise<void>) | undefined;
    try {
      const context = await fixture.prepare({
        sessionKey: "agent:main:main",
        provider: "claude-cli",
        config: createCliBackendConfig(),
      });
      cleanup = context.preparedBackend.cleanup;
      expect(context.managedMcpToolTimeoutMs).toBe(3_610_000);
      const args = context.preparedBackend.backend.args ?? [];
      const generatedConfigPath = expectDefined(
        args[args.indexOf("--mcp-config") + 1],
        "generated Claude MCP config path",
      );
      const generatedConfig = JSON.parse(
        fs.readFileSync(generatedConfigPath, "utf-8"),
      ) as NonNullable<Parameters<typeof prepareCliBundleMcpConfig>[0]["additionalConfig"]>;
      expect(generatedConfig.mcpServers.branch?.timeout).toBe(3_610_000);

      const merged = await prepareCliBundleMcpConfig({
        enabled: true,
        mode: "claude-config-file",
        backend: {
          command: "claude",
          args: ["--print", "--mcp-config", userMcpConfigPath],
          resumeArgs: ["--resume", "{sessionId}", "--mcp-config", userMcpConfigPath],
        },
        workspaceDir: fixture.session.dir,
        additionalConfig: generatedConfig,
      });
      mergedCleanup = merged.cleanup;
      const mergedArgs = merged.backend.args ?? [];
      const mcpConfigPath = expectDefined(
        mergedArgs[mergedArgs.indexOf("--mcp-config") + 1],
        "merged Claude MCP config path",
      );
      const readConfig = () =>
        JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8")) as {
          mcpServers?: Record<string, { headers?: Record<string, string>; timeout?: number }>;
        };

      expect(readConfig().mcpServers).toMatchObject({
        branch: { timeout: 3_610_000 },
        localUser: { timeout: 12_345 },
      });

      await prepareCliBundleMcpCaptureAttempt({
        mode: "claude-config-file",
        backend: merged.backend,
        env: merged.env,
        captureKey: "attempt-timeout-proof",
      });

      expect(readConfig().mcpServers).toMatchObject({
        branch: {
          timeout: 3_610_000,
          headers: { "x-branch-cli-capture-key": "attempt-timeout-proof" },
        },
        localUser: { timeout: 12_345 },
      });
    } finally {
      await mergedCleanup?.();
      await cleanup?.();
    }
  });

  it("serves only the branch MCP server for ring-zero runs", async () => {
    const { dir, sessionFile, sessionTarget } = fixture.session;
    const getActiveMcpLoopbackRuntime = vi.fn(() => undefined);
    const resolveExecutionArgs = vi.fn(
      (context: {
        baseArgs: readonly string[];
        toolAvailability?: { native: readonly string[]; branch: readonly string[] };
      }) => [
        ...context.baseArgs,
        "--tools",
        context.toolAvailability?.native.join(",") ?? "default",
        "--allowedTools",
        context.toolAvailability?.branch.join(",") ?? "",
      ],
    );
    setCliRunnerPrepareTestDeps({ getActiveMcpLoopbackRuntime });
    setRawCliBackendForPrepareTest({
      id: "claude-cli",
      pluginId: "anthropic",
      bundleMcp: true,
      bundleMcpMode: "claude-config-file",
      nativeToolMode: "selectable",
      toolAvailabilityEnforcement: "execution-args",
      resolveExecutionArgs,
      config: {
        command: "claude",
        args: ["--print"],
        resumeArgs: ["--print", "--resume", "{sessionId}"],
        output: "jsonl",
        jsonlDialect: "claude-stream-json",
        input: "stdin",
        sessionMode: "existing",
      },
    });

    const config = createCliBackendConfig();
    const runId = "run-test-branch-mcp";
    const admission = prepareSystemAgentRunAdmission(config, runId, "main", "cli-ring-zero-test");
    const params: RunCliAgentParams & { systemAgentTool: SystemAgentToolOptions } = {
      preparedRunAdmission: admission,
      sessionId: "session-test",
      sessionFile,
      sessionTarget,
      workspaceDir: dir,
      prompt: "latest ask",
      provider: "claude-cli",
      model: "test-model",
      timeoutMs: 1_000,
      runId,
      config,
      systemAgentTool: { surface: "cli" },
      cliToolAvailability: {
        native: [],
        branch: ["branch"],
      },
    };
    try {
      const context = await prepareCliRunContext(params);
      try {
        // Ring-zero runs never touch the loopback surface (no message tools).
        expect(getActiveMcpLoopbackRuntime).not.toHaveBeenCalled();
        expect(context.mcpDeliveryCapture).toBeUndefined();
        const args = context.preparedBackend.backend.args ?? [];
        expect(args).toContain("--strict-mcp-config");
        expect(args).not.toContain("--tools");
        expect(args).not.toContain("--allowedTools");
        expect(context.preparedBackend.backend.resumeArgs).toEqual(
          expect.arrayContaining(["--strict-mcp-config"]),
        );
        expect(resolveExecutionArgs).not.toHaveBeenCalled();
        expect(context.params.cliToolAvailability).toEqual({
          native: [],
          branch: ["branch"],
        });
        const mcpConfigPath = expectDefined(
          args[args.indexOf("--mcp-config") + 1],
          'args[args.indexOf("--mcp-config") + 1] test invariant',
        );
        const raw = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8")) as {
          mcpServers?: Record<string, { env?: Record<string, string> }>;
        };
        expect(Object.keys(raw.mcpServers ?? {})).toEqual(["branch"]);
        expect(raw.mcpServers?.branch?.env).toMatchObject({
          BRANCH_TOOLS_MCP_TOOLS: "branch",
          BRANCH_TOOLS_MCP_SYSTEM_AGENT_SURFACE: "cli",
        });
      } finally {
        await context.preparedBackend.cleanup?.();
      }
    } finally {
      admission.close();
    }
  });

  it.each([
    {
      name: "invalidates orphaned claude-cli transcripts during run preparation",
      sessionId: "orphaned-claude-sid",
      hasContent: true,
      hasOrphan: true,
      withCwdHash: true,
      checksTranscript: true,
      checksOrphan: true,
      expected: { mode: "invalidate", invalidatedReason: "orphaned-tool-use" },
    },
    {
      name: "keeps auth-boundary invalidation ahead of orphaned transcript checks",
      sessionId: "orphaned-claude-sid",
      authProfileId: "anthropic:old-profile",
      hasContent: true,
      hasOrphan: true,
      withCwdHash: true,
      checksTranscript: false,
      checksOrphan: false,
      expected: { mode: "invalidate", invalidatedReason: "auth-profile" },
    },
  ])("$name", async (testCase) => {
    const { dir } = fixture.session;
    setCliBackendForPrepareTest();
    const transcriptCheck = vi.fn(async () => testCase.hasContent);
    const orphanCheck = vi.fn(async () => testCase.hasOrphan);
    setCliRunnerPrepareTestDeps({
      claudeCliSessionTranscriptHasContent: transcriptCheck,
      claudeCliSessionTranscriptHasOrphanedToolUse: orphanCheck,
    });
    const cliSessionBinding = {
      sessionId: testCase.sessionId,
      ...(testCase.withCwdHash ? { cwdHash: hashCliSessionText(dir) } : {}),
      ...(testCase.authProfileId ? { authProfileId: testCase.authProfileId } : {}),
    };

    const context = await fixture.prepare({
      sessionKey: "agent:main:telegram:direct:peer",
      prompt: "follow-up",
      provider: "claude-cli",
      model: "opus",
      cliSessionBinding,
      cliSessionId: testCase.sessionId,
    });

    const transcriptArgs = { sessionId: testCase.sessionId, workspaceDir: dir };
    if (testCase.checksTranscript) {
      expect(transcriptCheck).toHaveBeenCalledWith(transcriptArgs);
    } else {
      expect(transcriptCheck).not.toHaveBeenCalled();
    }
    if (testCase.checksOrphan) {
      expect(orphanCheck).toHaveBeenCalledWith(transcriptArgs);
    } else {
      expect(orphanCheck).not.toHaveBeenCalled();
    }
    expect(context.reusableCliSession).toEqual(testCase.expected);
  });

  it("preserves a Claude native-control resume when the local transcript is absent", async () => {
    setActiveNodeContexts([{ nodeId: "active-mac" }]);
    setCliBackendForPrepareTest();
    const transcriptCheck = vi.fn(async () => false);
    const orphanCheck = vi.fn(async () => true);
    setCliRunnerPrepareTestDeps({
      claudeCliSessionTranscriptHasContent: transcriptCheck,
      claudeCliSessionTranscriptHasOrphanedToolUse: orphanCheck,
    });

    const context = await fixture.prepare({
      sessionKey: "agent:main:telegram:direct:peer",
      prompt: "/compact",
      provider: "claude-cli",
      model: "opus",
      cliSessionBinding: { sessionId: "native-claude-session" },
      cliSessionId: "native-claude-session",
      controlOperation: "compact",
    });

    expect(transcriptCheck).not.toHaveBeenCalled();
    expect(orphanCheck).not.toHaveBeenCalled();
    expect(context.params.prompt).toBe("/compact");
    expect(context.systemPrompt).toBe("");
    expect(context.reusableCliSession).toEqual({
      mode: "reuse",
      sessionId: "native-claude-session",
    });
  });

  it("keeps old-account history private after replacement and native-session clear", async () => {
    const account = "test:b";
    const { dir, sessionTarget } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        "test:a": { type: "token", provider: "test-cli", token: "synthetic-account-a" },
        "test:b": { type: "token", provider: "test-cli", token: "synthetic-account-b" },
      }),
      agentDir,
    );
    const inputs: string[] = [];
    let turn = 0;
    const execute: CliBackendExecute = async function* (execution) {
      inputs.push(execution.prompt);
      const sessionId = "native-" + ++turn;
      yield { type: "system", subtype: "init", session_id: sessionId };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "completed",
        session_id: sessionId,
      };
    };
    setRawCliBackendForPrepareTest({
      id: "test-cli",
      pluginId: "test-plugin",
      authEpochMode: "profile-only",
      autoSelectAuthProfile: false,
      prepareExecution: async () => ({ execute }),
      parseJsonlEvent: (line) => {
        const event = JSON.parse(line);
        return event.type === "result"
          ? { kind: "result", text: event.result, sessionId: event.session_id }
          : null;
      },
      config: {
        command: process.execPath,
        args: [],
        resumeArgs: ["--resume", "{sessionId}"],
        input: "stdin",
        output: "jsonl",
        sessionMode: "existing",
        sessionIdFields: ["session_id"],
        reseedFromRawTranscriptWhenUncompacted: true,
      },
    });
    const runTurn = async (authProfileId: string, prompt: string) => {
      const entry = expectDefined(loadSessionEntryReadOnly(sessionTarget), "session");
      const binding = getCliSessionBinding(entry, "test-cli");
      const runId = "history-proof-" + turn;
      await patchSessionEntryCore(sessionTarget, (current) => ({
        ...current,
        activeWriterRunId: runId,
      }));
      const admission = prepareSystemAgentRunAdmission({}, runId, "main", "history-proof");
      try {
        const recorder = createUserTurnTranscriptRecorder({
          input: { text: prompt, idempotencyKey: runId },
          target: { ...sessionTarget, sessionEntry: loadSessionEntryReadOnly(sessionTarget) },
        });
        const context = await fixture.prepare({
          agentDir,
          authProfileId,
          prompt,
          runId,
          preparedRunAdmission: admission,
          userTurnTranscriptRecorder: recorder,
          persistAssistantTranscript: true,
          storePath: sessionTarget.storePath,
          expectedWriterRunId: runId,
          sessionKey: sessionTarget.sessionKey,
          cliSessionBinding: binding,
        });
        const { runPreparedCliAgent } = await import("../cli-runner.js");
        const result = await runPreparedCliAgent(context);
        expect(result.meta.agentMeta?.cliSessionBinding?.sessionId).toBeDefined();
        expect(context.effectiveAuthProfileId).toBe(authProfileId);
        expect(recorder.hasPersisted()).toBe(true);
        await patchSessionEntryCore(sessionTarget, (current) => {
          applyCliSessionBindingResult(current, "test-cli", result.meta.agentMeta);
          return current;
        });
      } finally {
        admission.close();
      }
    };
    await runTurn("test:a", "account A private history");
    await runTurn(account, "replacement turn");
    expect(inputs.at(-1)).not.toContain("account A private history");
    const entry = expectDefined(loadSessionEntryReadOnly(sessionTarget), "replacement");
    expect(getCliSessionBinding(entry, "test-cli")?.authProfileId).toBe(account);
    clearCliSession(entry, "test-cli");
    replaceSessionEntrySync(sessionTarget, entry);
    await runTurn(account, "recovery");
    expect(inputs.at(-1)).toContain("recovery");

    expect(inputs.at(-1)).not.toContain("account A private history");
  });

  it("does not replay the already-admitted current user turn during fresh CLI recovery", async () => {
    await withAuthenticatedHistory("claude-cli", async (prepare) => {
      fixture.appendTranscript({
        id: "prior",
        parentId: null,
        timestamp: "2020-01-01T00:00:00.000Z",
        message: { role: "user", content: "prior task", timestamp: 1 },
      });
      const { sessionTarget } = fixture.session;
      const recorder = createUserTurnTranscriptRecorder({
        input: { text: "latest ask", idempotencyKey: "recovery-current-turn" },
        target: {
          ...sessionTarget,
          sessionEntry: { sessionId: sessionTarget.sessionId, updatedAt: 1 },
        },
      });
      await recorder.persistApproved();
      expect(recorder.getAdmissionReceipt()).toBeDefined();
      setCliBackendForPrepareTest({ reseedFromRawTranscriptWhenUncompacted: true });
      const context = await prepare({
        provider: "claude-cli",
        model: "opus",
        userTurnTranscriptRecorder: recorder,
      });
      expect(context.branchHistoryPrompt).toContain("User: prior task");
      expect(context.branchHistoryPrompt?.split("latest ask")).toHaveLength(2);
    });
  });

  it("redelivers conversation and tool results after a native transcript disappears", async () => {
    await withAuthenticatedHistory("claude-cli", async (prepare) => {
      const recoveredAt = "2020-01-02T03:04:05.000Z";
      fixture.appendTranscript({
        id: "msg-1",
        parentId: null,
        timestamp: recoveredAt,
        message: makeUserMessage("prior claude-cli ask", 1),
      });
      fixture.appendTranscript({
        id: "result-1",
        parentId: "msg-1",
        timestamp: "2020-01-02T03:04:06.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "exec",
          isError: false,
          content: [{ type: "text", text: "Archive created at /tmp/example-backup.tar" }],
          timestamp: 2,
        },
      });
      fixture.appendTranscript({
        id: "result-2",
        parentId: "result-1",
        timestamp: "2020-01-02T03:04:07.000Z",
        message: {
          role: "toolResult",
          toolCallId: "call-2",
          toolName: "exec",
          isError: true,
          content: [{ type: "text", text: "Upload failed: destination unavailable" }],
          timestamp: 3,
        },
      });
      setCliBackendForPrepareTest({
        reseedFromRawTranscriptWhenUncompacted: true,
      });
      const transcriptCheck = vi.fn(async () => false);
      const orphanCheck = vi.fn(async () => false);
      setCliRunnerPrepareTestDeps({
        claudeCliSessionTranscriptHasContent: transcriptCheck,
        claudeCliSessionTranscriptHasOrphanedToolUse: orphanCheck,
      });

      const context = await prepare({
        sessionKey: "agent:main:telegram:direct:peer",
        provider: "claude-cli",
        model: "opus",
        cliSessionBinding: { sessionId: "stale-claude-sid" },
        cliSessionId: "stale-claude-sid",
      });

      // Candidate is invalidated (no native --resume) yet reseed still fires:
      // prepare hands the prior Branch Agent conversation forward as history.
      expect(context.reusableCliSession).toEqual({
        mode: "invalidate",
        invalidatedReason: "missing-transcript",
      });
      expect(context.branchHistoryPrompt).toContain(`[${recoveredAt}] User: prior claude-cli ask`);
      expect(context.branchHistoryPrompt).toContain(
        "Tool result (exec): Archive created at /tmp/example-backup.tar",
      );
      expect(context.branchHistoryPrompt).toContain(
        "Tool result (exec) [error]: Upload failed: destination unavailable",
      );
      expect(context.branchHistoryPrompt).not.toContain(
        "[1970-01-01T00:00:00.001Z] User: prior claude-cli ask",
      );
      expect(context.branchHistoryPrompt).toContain(
        "Recovered history may be stale; verify current and time-sensitive facts before acting.",
      );
      expect(context.branchHistoryPrompt).toMatch(
        /<next_user_message>\nlatest ask\n\nFor the current source conversation,[\s\S]*\n<\/next_user_message>$/,
      );
      expect(context.params.transcriptPrompt).toBe("latest ask");
    });
  });

  it("prepares node-placed Claude resumes without Gateway MCP, skills, or transcript checks", async () => {
    fixture.appendTranscript({
      id: "msg-node-1",
      parentId: null,
      timestamp: new Date(1).toISOString(),
      message: { role: "user", content: "gateway-only history", timestamp: 1 },
    });
    const prepareExecution = vi.fn(async () => ({
      env: { CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3" },
      secretInput: {
        fd: 3,
        fingerprint: "selected-node-token-fingerprint",
        createData: () => Buffer.from("selected-node-token"),
      },
      clearEnv: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
    }));
    setCliBackendForPrepareTest({
      bundleMcp: true,
      liveSession: true,
      prepareExecution,
      reseedFromRawTranscriptWhenUncompacted: true,
    });
    const ensureMcpLoopbackServer = vi.fn(createTestMcpLoopbackServer);
    const prepareClaudeCliSkillsPluginMock = vi.fn(async () => ({
      args: ["--plugin-dir", "/tmp/gateway-skills"],
      cleanup: vi.fn(async () => undefined),
    }));
    const transcriptCheck = vi.fn(async () => false);
    const orphanCheck = vi.fn(async () => false);
    setCliRunnerPrepareTestDeps({
      ensureMcpLoopbackServer,
      prepareClaudeCliSkillsPlugin: prepareClaudeCliSkillsPluginMock,
      claudeCliSessionTranscriptHasContent: transcriptCheck,
      claudeCliSessionTranscriptHasOrphanedToolUse: orphanCheck,
    });

    await expect(
      fixture.prepare({
        provider: "claude-cli",
        model: "opus",
        sessionEntry: { execHost: "node" } as never,
      }),
    ).rejects.toThrow("node-placed Claude CLI session is missing execNode");
    expect(ensureMcpLoopbackServer).not.toHaveBeenCalled();

    const context = await fixture.prepare({
      sessionKey: "agent:main:catalog-adopt:claude:node",
      provider: "claude-cli",
      model: "opus",
      cliSessionBinding: {
        sessionId: "node-source-session",
        forceReuse: true,
        forkNextResume: true,
      },
      cliSessionId: "node-source-session",
      sessionEntry: {
        execHost: "node",
        execNode: "node-a",
        execCwd: "/work/on-node",
      } as never,
      skillsSnapshot: {
        prompt: "GATEWAY_ONLY_SKILL_PATH=/tmp/gateway-skill/SKILL.md",
        skills: [],
        resolvedSkills: [],
      },
    });

    expect(context.reusableCliSession).toEqual({
      mode: "reuse",
      sessionId: "node-source-session",
    });
    // The reseed prompt is gateway-built text, so node placement keeps the
    // backend's raw-transcript reseed semantics for fresh-retry paths.
    // A borrowed native handle cannot authorize unverified durable history.
    expect(context.branchHistoryPrompt).toBeUndefined();
    expect(context.claudeSkillsPluginArgs).toEqual([]);
    expect(context.systemPrompt).not.toContain("GATEWAY_ONLY_SKILL_PATH");
    expect(context.mcpDeliveryCapture).toBeUndefined();
    expect(ensureMcpLoopbackServer).not.toHaveBeenCalled();
    expect(prepareClaudeCliSkillsPluginMock).not.toHaveBeenCalled();
    expect(transcriptCheck).not.toHaveBeenCalled();
    expect(orphanCheck).not.toHaveBeenCalled();
    expect(prepareExecution).toHaveBeenCalledOnce();
    expect(context.preparedBackend.env).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "3",
    });
    expect(context.preparedBackend.secretInput?.fingerprint).toBe(
      "selected-node-token-fingerprint",
    );
    expect(context.preparedBackend.backend.clearEnv).toEqual(
      expect.arrayContaining(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
    );
  });
});

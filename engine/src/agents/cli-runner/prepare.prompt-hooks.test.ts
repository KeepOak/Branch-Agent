// Exercises CLI preparation, auth, prompt hooks, MCP setup, and session reuse.
import fs from "node:fs";
import path from "node:path";
import { SYSTEM_PROMPT_CACHE_BOUNDARY } from "@branch/ai/internal/shared";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserMessage } from "../../../test/helpers/user-message.js";
import { runWithCliHistoryWriter } from "../../config/sessions/cli-history-boundary.js";
import { patchSessionEntryCore } from "../../config/sessions/session-accessor.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { setActiveNodeContexts } from "../../infra/active-node-context.js";
import { getGlobalHookRunner } from "../../plugins/hook-runner-global.js";
import { captureEnv, setTestEnvValue } from "../../test-utils/env.js";
import {
  createOperationalRunInstanceRef,
  prepareAgentRunAdmission,
  prepareSystemAgentRunAdmission,
} from "../admitted-run-context.js";
import {
  createApiKeyCredential,
  createAuthProfileStoreFixture,
  oauthCred,
} from "../auth-profiles/credential-fixtures.test-support.js";
import { saveAuthProfileStore } from "../auth-profiles/store-runtime.js";
import { CLI_AUTH_EPOCH_VERSION, resolveCliAuthEpoch } from "../cli-auth-epoch.js";
import {
  createCliRunnerPrepareFixture,
  createTestMcpLoopbackServer,
  wrappedPluginSystemContext,
} from "../cli-runner.test-helpers.js";
import { hashCliSessionText } from "../cli-session.js";
import type { SandboxWorkspaceInfo } from "../sandbox/types.js";
import { createZeroUsageFixture } from "../test-helpers/usage-fixtures.js";
import { prepareCliHistoryBoundary } from "./history-boundary.js";
import { setRawCliBackendForPrepareTest } from "./prepare-mcp.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  createArgBackendConfig,
  createCliBackendConfig,
  createLoopbackRuntime,
  setCliBackendForPrepareTest,
  installCliRunnerPrepareTestDoubles,
  resetCliRunnerPrepareTestDoubles,
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

  it("does not replace an explicit Claude CLI profile with a resolver fallback", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "anthropic:account-a";
    const fallbackProfileId = "anthropic:account-b";
    const prepareExecution = vi.fn(async () => undefined);
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: {
          type: "oauth",
          provider: "anthropic",
          access: "expired-account-a-access",
          refresh: "account-a-refresh",
          expires: Date.now() - 60_000,
        },
        [fallbackProfileId]: {
          type: "oauth",
          provider: "anthropic",
          access: "account-b-access",
          refresh: "account-b-refresh",
          expires: Date.now() + 60 * 60_000,
        },
      }),
      agentDir,
    );
    setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });
    setCliRunnerPrepareTestDeps({
      resolveApiKeyForProfile: vi.fn(async () => ({
        apiKey: "account-b-access",
        provider: "anthropic",
        profileId: fallbackProfileId,
        profileType: "oauth",
        credential: {
          type: "oauth",
          provider: "anthropic",
          access: "account-b-access",
          refresh: "account-b-refresh",
          expires: Date.now() + 60 * 60_000,
        },
      })),
    });

    await expect(
      fixture.prepare({
        sessionKey: "agent:main:main",
        agentDir,
        provider: "claude-cli",
        model: "sonnet",
        authProfileId,
        config: {},
      }),
    ).rejects.toThrow(`resolved as "${fallbackProfileId}"`);
    expect(prepareExecution).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "keeps implicit profile selection for auth bridges",
      autoSelectAuthProfile: undefined,
      expectedAuthProfileId: "claude-cli:stored",
    },
    {
      name: "lets environment-only hooks opt out of profile selection",
      autoSelectAuthProfile: false,
      expectedAuthProfileId: undefined,
    },
  ])("$name", async (testCase) => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "claude-cli:stored";
    const prepareExecution = vi.fn(async () => ({ env: { TEST_PREPARED_ENV: "1" } }));
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: {
          type: "token",
          provider: "claude-cli",
          token: "stored-token",
        },
      }),
      agentDir,
    );

    setCliBackendForPrepareTest({
      prepareExecution,
      authEpochMode: "profile-only",
      autoSelectAuthProfile: testCase.autoSelectAuthProfile,
    });
    const context = await fixture.prepare({
      sessionKey: "agent:main:main",
      agentDir,
      provider: "claude-cli",
      model: "sonnet",
      config: {
        auth: {
          profiles: {
            [authProfileId]: { provider: "claude-cli", mode: "token" },
          },
        },
      },
    });

    expect(context.effectiveAuthProfileId).toBe(testCase.expectedAuthProfileId);
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({ authProfileId: testCase.expectedAuthProfileId }),
    );
  });

  describe("unpinned Trunk sign-in pick", () => {
    const apiKeyProfileId = "claude-cli:fixture-key";
    const planProfileId = "claude-cli:fixture-plan";

    function saveClaudeSignIns(profiles: Parameters<typeof createAuthProfileStoreFixture>[0]) {
      const agentDir = path.join(fixture.session.dir, "agents", "main", "agent");
      fs.mkdirSync(agentDir, { recursive: true });
      saveAuthProfileStore(
        {
          ...createAuthProfileStoreFixture(profiles),
          order: { "claude-cli": Object.keys(profiles as Record<string, unknown>) },
        },
        agentDir,
      );
      return agentDir;
    }

    it("runs on the subscription sign-in when an API key is first in order and subscriptionsOnly is set", async () => {
      const prepareExecution = vi.fn(async () => ({ env: { TEST_PREPARED_ENV: "1" } }));
      const agentDir = saveClaudeSignIns({
        [apiKeyProfileId]: createApiKeyCredential("claude-cli", "fixture-key"),
        [planProfileId]: oauthCred({
          provider: "claude-cli",
          access: "fixture-access",
          refresh: "fixture-refresh",
          expires: 4_102_444_800_000,
        }),
      });
      setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });

      const context = await fixture.prepare({
        sessionKey: "agent:main:main",
        agentDir,
        provider: "claude-cli",
        model: "sonnet",
        config: { agents: { defaults: { subscriptionsOnly: true } } },
      });

      expect(context.effectiveAuthProfileId).toBe(planProfileId);
      expect(prepareExecution).toHaveBeenCalledWith(
        expect.objectContaining({ authProfileId: planProfileId }),
      );
    });

    it("fails with a plain message when only API-key sign-ins exist and subscriptionsOnly is set", async () => {
      const prepareExecution = vi.fn(async () => ({ env: { TEST_PREPARED_ENV: "1" } }));
      const agentDir = saveClaudeSignIns({
        [apiKeyProfileId]: createApiKeyCredential("claude-cli", "fixture-key"),
      });
      setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });

      await expect(
        fixture.prepare({
          sessionKey: "agent:main:main",
          agentDir,
          provider: "claude-cli",
          model: "sonnet",
          config: { agents: { defaults: { subscriptionsOnly: true } } },
        }),
      ).rejects.toThrow("Trunks only use subscription sign-ins.");
      expect(prepareExecution).not.toHaveBeenCalled();
    });

    it("runs on an API-key sign-in when it is the only one and subscriptionsOnly is off", async () => {
      const prepareExecution = vi.fn(async () => ({ env: { TEST_PREPARED_ENV: "1" } }));
      const agentDir = saveClaudeSignIns({
        [apiKeyProfileId]: createApiKeyCredential("claude-cli", "fixture-key"),
      });
      setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });

      const context = await fixture.prepare({
        sessionKey: "agent:main:main",
        agentDir,
        provider: "claude-cli",
        model: "sonnet",
        config: {},
      });

      expect(context.effectiveAuthProfileId).toBe(apiKeyProfileId);
      expect(prepareExecution).toHaveBeenCalledWith(
        expect.objectContaining({ authProfileId: apiKeyProfileId }),
      );
    });

    it("keeps the first API-key sign-in in order when subscriptionsOnly is off", async () => {
      const prepareExecution = vi.fn(async () => ({ env: { TEST_PREPARED_ENV: "1" } }));
      const agentDir = saveClaudeSignIns({
        [apiKeyProfileId]: createApiKeyCredential("claude-cli", "fixture-key"),
        [planProfileId]: oauthCred({
          provider: "claude-cli",
          access: "fixture-access",
          refresh: "fixture-refresh",
          expires: 4_102_444_800_000,
        }),
      });
      setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });

      const context = await fixture.prepare({
        sessionKey: "agent:main:main",
        agentDir,
        provider: "claude-cli",
        model: "sonnet",
        config: { agents: { defaults: { subscriptionsOnly: false } } },
      });

      expect(context.effectiveAuthProfileId).toBe(apiKeyProfileId);
    });
  });

  it("lets Gemini CLI preparation override generated MCP system settings auth", async () => {
    const { dir } = fixture.session;
    const profileSystemSettingsPath = path.join(dir, "profile-system-settings.json");
    const getActiveMcpLoopbackRuntime = vi.fn(createLoopbackRuntime);
    const prepareExecution = vi.fn(async (_ctx: unknown) => ({
      env: {
        GEMINI_CLI_SYSTEM_SETTINGS_PATH: profileSystemSettingsPath,
      },
    }));
    setRawCliBackendForPrepareTest({
      id: "google-gemini-cli",
      pluginId: "google",
      bundleMcp: true,
      bundleMcpMode: "gemini-system-settings",
      prepareExecution,
      config: createArgBackendConfig("gemini", ["--prompt", "{prompt}"], "json"),
    });
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
    });

    let cleanup: (() => Promise<void>) | undefined;
    try {
      const context = await fixture.prepare({
        sessionKey: "agent:main:main",
        provider: "google-gemini-cli",
        model: "gemini-3.1-pro-preview",
        config: {},
      });
      cleanup = context.preparedBackend.cleanup;

      const prepareExecutionArg = prepareExecution.mock.calls[0]?.[0] as
        | { env?: Record<string, string> }
        | undefined;
      const generatedSystemSettingsPath = prepareExecutionArg?.env?.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      expect(typeof generatedSystemSettingsPath).toBe("string");
      expect(generatedSystemSettingsPath).not.toBe(profileSystemSettingsPath);
      const generatedSettings = JSON.parse(
        fs.readFileSync(generatedSystemSettingsPath ?? "", "utf8"),
      ) as {
        mcp?: { allowed?: string[] };
        mcpServers?: Record<string, { url?: string }>;
      };
      expect(generatedSettings.mcp?.allowed).toEqual(["branch"]);
      expect(generatedSettings.mcpServers?.branch?.url).toBe("http://127.0.0.1:31783/mcp");
      expect(context.preparedBackend.env?.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toBe(
        profileSystemSettingsPath,
      );
    } finally {
      await cleanup?.();
    }
  });

  it("cleans generated Gemini MCP settings when auth preparation fails", async () => {
    let generatedSystemSettingsPath: string | undefined;
    const getActiveMcpLoopbackRuntime = vi.fn(createLoopbackRuntime);
    const prepareExecution = vi.fn(async (ctx: unknown) => {
      generatedSystemSettingsPath = (ctx as { env?: Record<string, string> }).env
        ?.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
      throw new Error("Gemini auth profile was selected but no credential material was found");
    });
    const revokeMcpLoopbackClientGrant = vi.fn(() => true);
    setRawCliBackendForPrepareTest({
      id: "google-gemini-cli",
      pluginId: "google",
      bundleMcp: true,
      bundleMcpMode: "gemini-system-settings",
      prepareExecution,
      config: createArgBackendConfig("gemini", ["--prompt", "{prompt}"], "json"),
    });
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
      revokeMcpLoopbackClientGrant,
    });

    await expect(
      fixture.prepare({
        sessionKey: "agent:main:main",
        provider: "google-gemini-cli",
        model: "gemini-3.1-pro-preview",
        config: {},
      }),
    ).rejects.toThrow(/no credential material/);

    expect(generatedSystemSettingsPath).toBeTruthy();
    expect(fs.existsSync(generatedSystemSettingsPath ?? "")).toBe(false);
    expect(revokeMcpLoopbackClientGrant).toHaveBeenCalledExactlyOnceWith("loopback-token");
  });

  it("cleans prepared MCP and skills plugin dirs when mid-prepare reference lookup fails", async () => {
    const { dir } = fixture.session;
    const tempEnvSnapshot = captureEnv(["TMPDIR", "TMP", "TEMP"]);
    const tempRoot = path.join(dir, "tmp");
    const skillsPluginDir = path.join(dir, "claude-skills-plugin");
    const skillsCleanup = vi.fn(async () => {
      fs.rmSync(skillsPluginDir, { recursive: true, force: true });
    });
    const revokeMcpLoopbackClientGrant = vi.fn(() => true);
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.mkdirSync(skillsPluginDir, { recursive: true });
    setTestEnvValue("TMPDIR", tempRoot);
    setTestEnvValue("TMP", tempRoot);
    setTestEnvValue("TEMP", tempRoot);
    const getActiveMcpLoopbackRuntime = vi.fn(createLoopbackRuntime);
    setCliRunnerPrepareTestDeps({
      getActiveMcpLoopbackRuntime,
      revokeMcpLoopbackClientGrant,
      prepareClaudeCliSkillsPlugin: vi.fn(async () => ({
        args: ["--plugin-dir", skillsPluginDir],
        cleanup: skillsCleanup,
      })),
      resolveBranchReferencePaths: vi.fn(async () => {
        throw new Error("reference path lookup failed");
      }),
    });

    try {
      await expect(
        fixture.prepare({
          sessionKey: "agent:main:main",
          config: createCliBackendConfig({ bundleMcp: true }),
        }),
      ).rejects.toThrow("reference path lookup failed");

      expect(skillsCleanup).toHaveBeenCalledOnce();
      expect(revokeMcpLoopbackClientGrant).toHaveBeenCalledExactlyOnceWith("loopback-token");
      expect(fs.existsSync(skillsPluginDir)).toBe(false);
      expect(
        fs.readdirSync(tempRoot).filter((entry) => entry.startsWith("branch-cli-mcp-")),
      ).toEqual([]);
    } finally {
      tempEnvSnapshot.restore();
    }
  });

  it("prepares side questions without agent-turn context, tools, hooks, or reusable sessions", async () => {
    setActiveNodeContexts([{ nodeId: "active-mac" }]);
    fixture.appendTranscript({
      id: "msg-1",
      parentId: null,
      timestamp: new Date(1).toISOString(),
      message: { role: "user", content: "prior user text", timestamp: 1 },
    });
    const resolveBootstrapContextForRun = vi.fn(async () => ({
      bootstrapFiles: [
        { name: "AGENTS.md" as const, path: "AGENTS.md", content: "bootstrap", missing: false },
      ],
      contextFiles: [{ path: "context.md", content: "context" }],
    }));
    const ensureMcpLoopbackServer = vi.fn(createTestMcpLoopbackServer);
    const prepareClaudeCliSkillsPluginMock = vi.fn(async () => ({
      args: ["--plugin-dir", "/tmp/claude-skills"],
      cleanup: vi.fn(async () => undefined),
    }));
    const prepareExecution = vi.fn(async () => undefined);
    setRawCliBackendForPrepareTest({
      id: "test-cli",
      pluginId: "test",
      bundleMcp: true,
      bundleMcpMode: "claude-config-file",
      nativeToolMode: "always-on",
      sideQuestionToolMode: "disabled",
      prepareExecution,
      config: {
        command: "test-cli",
        args: ["--print"],
        liveSession: "claude-stdio",
        sessionMode: "always",
        output: "jsonl",
        input: "stdin",
      },
    });
    setCliRunnerPrepareTestDeps({
      resolveBootstrapContextForRun,
      ensureMcpLoopbackServer,
      prepareClaudeCliSkillsPlugin: prepareClaudeCliSkillsPluginMock,
      makeBootstrapWarn: vi.fn(() => () => undefined),
      getActiveMcpLoopbackRuntime: vi.fn(() => undefined),
      resolveMcpLoopbackScopedTools: vi.fn(() => ({
        agentId: "main",
        tools: [
          {
            name: "exec",
            label: "exec",
            description: "test exec tool",
            parameters: Type.Object({}, { additionalProperties: false }),
            execute: vi.fn(async () => ({ content: [], details: { ok: true } })),
          },
        ],
      })),
      resolveBranchReferencePaths: vi.fn(async () => ({ docsPath: "docs", sourcePath: "src" })),
    });

    const context = await fixture.prepare({
      sessionKey: "agent:main:main",
      config: createCliBackendConfig({ bundleMcp: true }),
      prompt: "side question prompt",
      executionMode: "side-question",
      timeoutMs: 120_000,
      extraSystemPrompt: "BTW system prompt",
      disableTools: true,
      cliSessionId: "existing-cli-session",
    });

    expect(resolveBootstrapContextForRun).not.toHaveBeenCalled();
    expect(ensureMcpLoopbackServer).not.toHaveBeenCalled();
    expect(prepareClaudeCliSkillsPluginMock).not.toHaveBeenCalled();
    expect(mockGetGlobalHookRunner).not.toHaveBeenCalled();
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({ executionMode: "side-question" }),
    );
    expect(context.systemPrompt).toBe("BTW system prompt");
    expect(context.params.prompt).toBe("side question prompt");
    expect(context.branchHistoryPrompt).toBeUndefined();
    expect(context.contextEngine).toBeUndefined();
    expect(context.contextEngineTurnPrompt).toBeUndefined();
    expect(context.hadSessionFile).toBe(false);
    expect(context.claudeSkillsPluginArgs).toEqual([]);
    expect(context.preparedBackend.backend.sessionMode).toBe("none");
    expect(context.preparedBackend.backend.liveSession).toBeUndefined();
    expect(context.systemPromptReport.injectedWorkspaceFiles).toEqual([]);
    expect(context.systemPromptReport.tools.entries).toEqual([]);
  });

  it.each([
    {
      name: "full guidance for a backend with native file tools",
      nativeToolMode: "always-on" as const,
      transportsSystemPrompt: true,
      expectedText: "BOOTSTRAP.md below; follow before normal reply.",
    },
    {
      name: "limited guidance for a backend without native file tools",
      nativeToolMode: undefined,
      transportsSystemPrompt: true,
      expectedText: "this run cannot safely finish full BOOTSTRAP.md",
    },
  ])("renders $name", async ({ nativeToolMode, transportsSystemPrompt, expectedText }) => {
    const { dir } = fixture.session;
    const bootstrapPath = path.join(dir, "BOOTSTRAP.md");
    const config = {
      agents: { defaults: { workspace: dir } },
    } satisfies BranchConfig;
    setRawCliBackendForPrepareTest({
      id: "test-cli",
      pluginId: "test",
      bundleMcp: false,
      nativeToolMode,
      config: {
        command: "test-cli",
        args: ["--print"],
        ...(transportsSystemPrompt ? { systemPromptArg: "--system-prompt" } : {}),
        systemPromptWhen: "first",
        sessionMode: "existing",
        output: "text",
        input: "arg",
      },
    });
    setCliRunnerPrepareTestDeps({
      isWorkspaceBootstrapPending: vi.fn(async () => true),
      resolveBootstrapContextForRun: vi.fn(async () => ({
        bootstrapFiles: [
          {
            name: "BOOTSTRAP.md" as const,
            path: bootstrapPath,
            content: "Complete the first-run ritual, then delete this file.",
            missing: false,
          },
        ],
        contextFiles: [
          {
            path: bootstrapPath,
            content: "Complete the first-run ritual, then delete this file.",
          },
        ],
      })),
    });

    const context = await fixture.prepare({
      sessionKey: "agent:main:main",
      config,
      prompt: "Hello",
      runId: `run-bootstrap-${nativeToolMode ?? "limited"}`,
      trigger: "user",
      extraSystemPrompt: "stable prompt",
      cliSessionBinding: {
        sessionId: "cli-session",
        extraSystemPromptHash: hashCliSessionText("stable prompt"),
        cwdHash: hashCliSessionText(dir),
      },
    });

    expect(context.systemPrompt).toContain("## Bootstrap Pending");
    expect(context.systemPrompt).toContain(expectedText);
    if (nativeToolMode === "always-on") {
      expect(context.systemPrompt).toContain("## " + bootstrapPath);
      expect(context.systemPrompt).toContain("Complete the first-run ritual");
      expect(context.systemPromptReport.injectedWorkspaceFiles).toEqual([
        expect.objectContaining({
          name: "BOOTSTRAP.md",
          injectedChars: expect.any(Number),
          truncated: false,
        }),
      ]);
    } else {
      expect(context.systemPrompt).not.toContain("## " + bootstrapPath);
      expect(context.systemPrompt).not.toContain("Complete the first-run ritual");
      expect(context.systemPromptReport.injectedWorkspaceFiles).toEqual([]);
    }
    expect(context.reusableCliSession).toEqual({
      mode: "reuse-with-drift",
      sessionId: "cli-session",
      drift: { reasons: ["system-prompt"] },
    });
  });

  it("drifts a resumed first-only session when truncation starts mid-session", async () => {
    const { dir } = fixture.session;
    const agentsPath = path.join(dir, "AGENTS.md");
    const bootstrapContextFor = (injected: string) => ({
      bootstrapFiles: [
        {
          name: "AGENTS.md" as const,
          path: agentsPath,
          content: "policy ".repeat(100),
          missing: false,
        },
      ],
      contextFiles: [{ path: agentsPath, content: injected }],
    });
    setRawCliBackendForPrepareTest({
      id: "test-cli",
      pluginId: "test",
      bundleMcp: false,
      nativeToolMode: "always-on",
      config: {
        ...createArgBackendConfig("test-cli"),
        systemPromptArg: "--system-prompt",
        systemPromptWhen: "first",
      },
    });
    setCliRunnerPrepareTestDeps({
      resolveBootstrapContextForRun: vi.fn(async () => bootstrapContextFor("policy ".repeat(100))),
    });
    const firstTurn = await fixture.prepare({
      sessionKey: "agent:main:main",
      config: createCliBackendConfig(),
      prompt: "turn one",
      runId: "run-truncation-drift-1",
      trigger: "user",
      extraSystemPrompt: "stable prompt",
    });
    expect(firstTurn.systemPrompt).not.toContain("[Bootstrap truncation warning]");
    const untruncatedBinding = {
      sessionId: "cli-session",
      extraSystemPromptHash: firstTurn.extraSystemPromptHash,
      cwdHash: hashCliSessionText(dir),
    };

    // AGENTS.md grows past the bootstrap cap between turns of the same session.
    setCliRunnerPrepareTestDeps({
      resolveBootstrapContextForRun: vi.fn(async () => bootstrapContextFor("policy ".repeat(10))),
    });
    const secondTurn = await fixture.prepare({
      sessionKey: "agent:main:main",
      config: createCliBackendConfig(),
      prompt: "turn two",
      runId: "run-truncation-drift-2",
      trigger: "user",
      extraSystemPrompt: "stable prompt",
      cliSessionBinding: untruncatedBinding,
    });

    expect(secondTurn.systemPrompt).toContain("[Bootstrap truncation warning]");
    expect(secondTurn.reusableCliSession).toEqual({
      mode: "reuse-with-drift",
      sessionId: "cli-session",
      drift: { reasons: ["system-prompt"] },
    });
  });

  it("applies prompt-build hook context to Claude-style CLI preparation", async () => {
    const { dir } = fixture.session;
    fixture.appendTranscript({
      id: "msg-1",
      parentId: null,
      timestamp: new Date(1).toISOString(),
      message: { role: "user", content: "earlier context", timestamp: 1 },
    });
    fixture.appendTranscript({
      id: "msg-2",
      parentId: "msg-1",
      timestamp: new Date(2).toISOString(),
      message: {
        role: "assistant",
        content: [{ type: "text", text: "earlier reply" }],
        api: "responses",
        provider: "test-cli",
        model: "test-model",
        usage: createZeroUsageFixture(),
        stopReason: "stop",
        timestamp: 2,
      },
    });
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "before_prompt_build"),
      runBeforePromptBuild: vi.fn(async ({ messages }: { messages: unknown[] }) => ({
        prependContext: `history:${messages.length}`,
        systemPrompt: "hook system",
        prependSystemContext: "prepend system",
        appendSystemContext: "append system",
      })),
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as never);

    // Hooks see history; the CLI receives approved context and current-turn guidance.
    const context = await fixture.prepare({
      sessionKey: "agent:main:test",
      agentId: "main",
      trigger: "user",
      runId: "run-test",
      messageChannel: "telegram",
      messageProvider: "acp",
      config: {
        ...createCliBackendConfig(),
      },
    });

    expect(context.params.prompt).toMatch(
      /^history:2\n\nlatest ask\n\nFor the current source conversation,/,
    );
    expect(context.params.transcriptPrompt).toBe("latest ask");
    expect(context.contextEngineTurnPrompt).toBe("latest ask");
    expect(context.systemPrompt).toBe(
      `${wrappedPluginSystemContext("prepend system")}\n\nhook system\n\n${wrappedPluginSystemContext("append system")}${SYSTEM_PROMPT_CACHE_BOUNDARY}\nCurrent model identity: test-cli/test-model. If asked what model you are, answer with this value for the current run.`,
    );
    expect(hookRunner.runBeforePromptBuild).toHaveBeenCalledExactlyOnceWith(
      {
        prompt: "latest ask",
        messages: [
          expect.objectContaining({ role: "user", content: "earlier context" }),
          expect.objectContaining({
            role: "assistant",
            content: [{ type: "text", text: "earlier reply" }],
          }),
        ],
      },
      expect.objectContaining({
        runId: "run-test",
        agentId: "main",
        sessionKey: "agent:main:test",
        sessionId: "session-test",
        workspaceDir: dir,
        modelProviderId: "test-cli",
        modelId: "test-model",
        messageProvider: "acp",
        trigger: "user",
        channelId: "telegram",
      }),
    );
  });

  it("uses compact current-turn context when a room event resumes a CLI session", async () => {
    await withAuthenticatedHistory("test-cli", async (prepare) => {
      fixture.appendTranscript({
        id: "msg-1",
        parentId: null,
        timestamp: new Date(1).toISOString(),
        message: makeUserMessage("prior room event", 1),
      });
      // Room resumes carry compact event text into the CLI prompt but keep the
      // richer room context in Branch Agent history for reseed and audits.
      const context = await prepare({
        sessionKey: "agent:main:test",
        agentId: "main",
        trigger: "user",
        prompt: "[Branch Agent room event]",
        currentInboundEventKind: "room_event",
        currentInboundContext: {
          text: "Room context:\nAlice: lunch?\n\nCurrent event:\nBob: yes",
          resumableText: "Current event:\nBob: yes",
        },
        cliSessionBinding: {
          sessionId: "cli-session",
        },
        config: createCliBackendConfig({
          reseedFromRawTranscriptWhenUncompacted: true,
        }),
      });

      expect(context.reusableCliSession).toEqual({ mode: "reuse", sessionId: "cli-session" });
      expect(context.params.prompt).toMatch(
        /^Current event:\nBob: yes\n\n\[Branch Agent room event\]\n\nFor the current source conversation,/,
      );
      expect(context.params.prompt).toMatch(
        /\n\nCurrent active computer .*active_node=unknown active_node_identity=unknown$/,
      );
      expect(context.params.transcriptPrompt).toBe("[Branch Agent room event]");
      expect(context.branchHistoryPrompt).toContain("Room context:\nAlice: lunch?");
      expect(context.branchHistoryPrompt).toContain("Current event:\nBob: yes");
    });
  });

  it("marks inter-session prompts after CLI prompt-build hook context is applied", async () => {
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "before_prompt_build"),
      runBeforePromptBuild: vi.fn(async () => ({
        prependContext: "trusted hook context",
      })),
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as never);

    const context = await fixture.prepare({
      sessionKey: "agent:main:test",
      agentId: "main",
      trigger: "user",
      prompt: "foreign reply text",
      inputProvenance: {
        kind: "inter_session",
        sourceSessionKey: "agent:main:slack:dm:U123",
        sourceChannel: "slack",
        sourceTool: "sessions_send",
      },
      runId: "run-test",
    });

    expect(context.params.prompt).toMatch(/^\[Inter-session message/);
    expect(context.params.prompt).toContain("sourceSession=agent:main:slack:dm:U123");
    expect(context.params.prompt).toContain("isUser=false");
    expect(context.params.prompt).toContain("trusted hook context");
    expect(context.params.prompt).toContain("foreign reply text");
    expect(hookRunner.runBeforePromptBuild).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: "user",
        inputProvenance: {
          kind: "inter_session",
          sourceSessionKey: "agent:main:slack:dm:U123",
          sourceChannel: "slack",
          sourceTool: "sessions_send",
        },
      }),
    );
  });

  it("applies turn-authorized prompt enrichment after CLI tool preparation", async () => {
    const hookRunner = {
      hasHooks: vi.fn((hookName: string) => hookName === "before_prompt_build"),
      runBeforePromptBuild: vi.fn(async () => undefined),
      runAuthorizedPromptBuild: vi.fn(async () => ({
        prependContext: "authorized memory context",
      })),
    };
    mockGetGlobalHookRunner.mockReturnValue(hookRunner as never);
    const preparedRunAdmission = prepareAgentRunAdmission({
      cfg: {},
      operationalRunInstance: createOperationalRunInstanceRef("run-test"),
      facts: {
        runId: "run-test",
        agentId: "main",
        ingress: { kind: "system", boundary: "test", state: "present" },
      },
    });

    const context = await fixture
      .prepare({
        toolAuthorityFingerprint: "turn-authority",
        preparedRunAdmission,
      })
      .finally(preparedRunAdmission.close);

    expect(context.params.prompt).toMatch(
      /^authorized memory context\n\nlatest ask\n\nFor the current source conversation,/,
    );
    expect(context.params.transcriptPrompt).toBe("latest ask");
    expect(hookRunner.runAuthorizedPromptBuild).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "latest ask" }),
      expect.any(Object),
      {
        toolAuthorityFingerprint: "turn-authority",
        activeToolNames: [],
        assertHostActive: expect.any(Function),
      },
    );
  });
});

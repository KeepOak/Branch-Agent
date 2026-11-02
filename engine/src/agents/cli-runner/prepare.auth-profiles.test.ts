// Exercises CLI preparation, auth, prompt hooks, MCP setup, and session reuse.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import {
  claimHeartbeatOutcomeForRun,
  persistHeartbeatOutcome,
} from "../../infra/heartbeat-outcome-store.js";
import { CliBackendAuthProfilePreparationError } from "../../plugins/cli-backend-errors.js";
import { closeBranchStateDatabaseByPath } from "../../state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../../state/branch-state-db.paths.js";
import { connectUserModelAccount } from "../../state/user-model-accounts.js";
import { ensureProfileForEmail } from "../../state/user-profiles.js";
import { prepareSystemAgentRunAdmission } from "../admitted-run-context.js";
import {
  createApiKeyCredential,
  createAuthProfileStoreFixture,
} from "../auth-profiles/credential-fixtures.test-support.js";
import { resolveApiKeyForProfile as resolveApiKeyForProfileImpl } from "../auth-profiles/oauth.js";
import {
  loadAuthProfileStoreWithoutExternalProfiles,
  saveAuthProfileStore,
} from "../auth-profiles/store-runtime.js";
import { createCliRunnerPrepareFixture } from "../cli-runner.test-helpers.js";
import type { SandboxWorkspaceInfo } from "../sandbox/types.js";
import { SessionManager } from "../sessions/session-manager.js";
import {
  captureRoutingDecisionWork,
  createModelRoutingTestAdmission,
} from "../test-helpers/model-routing-decision-e2e-fixtures.js";
import { setRawCliBackendForPrepareTest } from "./prepare-mcp.test-support.js";
import { registerCliThinkingPreparationTests } from "./prepare-thinking.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  type CliContextBudgetTestCase,
  createArgBackendConfig,
  createCliBackendConfig,
  setCliBackendForPrepareTest,
  installCliRunnerPrepareTestDoubles,
  resetCliRunnerPrepareTestDoubles,
  defaultTestCliBackend,
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

  it("preserves outer fallback route provenance through CLI admission", async () => {
    const runId = "run-cli-model-fallback-receipt";
    const cfg = { logging: { audit: { executionIdentity: true } } } satisfies BranchConfig;
    const preparedRunAdmission = createModelRoutingTestAdmission({
      cfg,
      runId,
      agentId: "main",
      boundary: "cli-prepare-test",
    });

    const { decisionWork } = await captureRoutingDecisionWork(() =>
      fixture.prepare({
        runId,
        config: cfg,
        preparedRunAdmission,
        model: "mock-2",
        modelRoutingProvenance: {
          requestedProvider: "openai",
          requestedModel: "mock-1",
          stage: "fallback",
          fallbackReason: "rate_limit",
        },
      }),
    ).finally(preparedRunAdmission.close);

    expect(decisionWork).toHaveLength(1);
    expect(decisionWork[0]?.receipt).toMatchObject({
      action: { summary: "Requested openai/mock-1; selected test-cli/mock-2." },
      decision: { reasonCode: "rate_limit" },
    });
  });

  registerCliThinkingPreparationTests({
    getFixture: () => fixture,
    setBackend: setCliBackendForPrepareTest,
  });

  it.each<CliContextBudgetTestCase>([
    {
      name: "a Claude CLI user alias",
      provider: "claude-cli",
      expectedContextTokens: 100_000,
      model: "large",
      modelAliases: { large: "claude-opus-4-7" },
    },
    {
      name: "a Claude CLI-native alias",
      provider: "claude-cli",
      expectedContextTokens: 100_000,
      model: "claude-opus-4-7",
      modelAliases: { "claude-opus-4-7": "deployment-large" },
    },
  ])("resolves canonical model budgets for $name", async (testCase) => {
    const prepareExecution = vi.fn(async () => undefined);
    const baseConfig = createCliBackendConfig();
    setCliBackendForPrepareTest({
      id: testCase.provider,
      command: testCase.provider === "claude-cli" ? "claude" : testCase.provider,
      modelProvider: "fixture-anthropic",
      pluginId: "fixture-plugin",
      prepareExecution,
      modelAliases: testCase.modelAliases,
    });
    const context = await fixture.prepare({
      provider: testCase.provider,
      model: testCase.model,
      config: {
        ...baseConfig,
        agents: baseConfig.agents,
        models: {
          providers: {
            "fixture-anthropic": {
              baseUrl: "https://api.anthropic.com",
              models: [
                {
                  id: "claude-opus-4-7",
                  name: "Claude Opus 4.7",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 200_000,
                  maxTokens: 8_192,
                  contextTokens: 100_000,
                },
              ],
            },
            "collision-provider": {
              baseUrl: "https://collision.invalid",
              models: [
                {
                  id: "large",
                  name: "Unrelated Large",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 32_000,
                  maxTokens: 4_096,
                  contextTokens: 32_000,
                },
              ],
            },
            "claude-cli": {
              baseUrl: "https://runtime.invalid",
              models: [
                {
                  id: "large",
                  name: "Configured Alias Source",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 200_000,
                  maxTokens: 8_192,
                  contextTokens: 200_000,
                },
              ],
            },
          },
        },
      } satisfies BranchConfig,
    });

    expect(context.backendResolved.modelProvider).toBe("fixture-anthropic");
    expect(context.contextWindowInfo?.tokens).toBe(testCase.expectedContextTokens);
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({ contextTokenBudget: testCase.expectedContextTokens }),
    );
  });

  it.each([
    { name: "the session-selected 200k option", selection: "200k", expected: 200_000 },
    {
      name: "the declared default option when unselected",
      selection: undefined,
      expected: 1_000_000,
    },
  ])("caps the context budget with $name from catalog contextWindows", async (testCase) => {
    const prepareExecution = vi.fn(async () => undefined);
    setCliBackendForPrepareTest({ prepareExecution });
    setCliRunnerPrepareTestDeps({
      loadManifestModelCatalog: vi.fn(() => [
        {
          id: "claude-fable-5",
          name: "Claude Fable 5",
          provider: "anthropic",
          contextWindow: 1_000_000,
          contextWindows: [
            { id: "200k", label: "200K", contextWindow: 200_000 },
            { id: "1m", label: "1M", contextWindow: 1_000_000 },
          ],
          contextWindowDefault: "1m",
        },
      ]),
    });

    const context = await fixture.prepare({
      provider: "claude-cli",
      model: "claude-fable-5",
      config: {},
      // The run owner carries the selection as a prepared fact; a session entry
      // alone must not drive it (reply-path regression: selection dropped when
      // prepare read sessionEntry directly).
      ...(testCase.selection ? { contextWindow: testCase.selection } : {}),
      sessionEntry: {
        sessionId: "cli-session",
        updatedAt: 0,
        ...(testCase.selection ? {} : { contextWindow: "200k" }),
      },
    });

    expect(context.contextWindowInfo?.tokens).toBe(testCase.expected);
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({ contextTokenBudget: testCase.expected }),
    );
  });

  it.each(["process", "plugin"] as const)(
    "carries silent heartbeat outcome in late %s user input without rebinding",
    async (targetKind) => {
      const { sessionTarget } = fixture.session;
      if (targetKind === "plugin") {
        setRawCliBackendForPrepareTest({
          ...defaultTestCliBackend,
          prepareExecution: () => ({
            async *execute() {
              yield { type: "result" };
            },
          }),
        });
      }
      const admission = prepareSystemAgentRunAdmission(
        {},
        "run-test",
        "main",
        "heartbeat-context-test",
      );
      const input = {
        preparedRunAdmission: admission,
        sessionKey: sessionTarget.sessionKey,
        trigger: "user" as const,
        prompt: "What happened?",
        transcriptPrompt: "What happened?",
        currentInboundContext: { text: "Quoted reply", resumableText: "Room delta" },
      };
      try {
        const before = await fixture.prepare(input);
        await persistHeartbeatOutcome({
          ...sessionTarget,
          runSessionKey: "agent:main:main:heartbeat",
          occurredAt: 1,
          response: { outcome: "done", notify: false, summary: "ISOLATED_CLI_OUTCOME_947" },
        });
        for (let retry = 0; retry < 2; retry++) {
          const context = await fixture.prepare(input);
          expect(context.executionTarget.kind).toBe(targetKind);
          const visibleInput = [
            context.params.prompt,
            context.promptContext?.prependContext,
            context.promptContext?.appendContext,
          ]
            .filter(Boolean)
            .join("\n");
          expect(visibleInput.match(/ISOLATED_CLI_OUTCOME_947/g)).toHaveLength(1);
          expect(context.params.transcriptPrompt).toBe("What happened?");
          expect(context.systemPrompt).toBe(before.systemPrompt);
          expect(context.extraSystemPromptHash).toBe(before.extraSystemPromptHash);
          expect(context.messageToolPolicyHash).toBe(before.messageToolPolicyHash);
          expect(input.currentInboundContext).toEqual({
            text: "Quoted reply",
            resumableText: "Room delta",
          });
        }
        const laterAdmission = prepareSystemAgentRunAdmission(
          {},
          "later-user-run",
          "main",
          "heartbeat-context-test",
        );
        try {
          const later = await fixture.prepare({
            ...input,
            runId: "later-user-run",
            preparedRunAdmission: laterAdmission,
          });
          expect(JSON.stringify([later.params.prompt, later.promptContext])).not.toContain(
            "ISOLATED_CLI_OUTCOME_947",
          );
        } finally {
          laterAdmission.close();
        }
      } finally {
        admission.close();
      }
    },
  );

  it.each(["heartbeat", "in-memory", "aborted"] as const)(
    "does not consume silent heartbeat context for %s CLI preparation",
    async (kind) => {
      const { sessionTarget, dir } = fixture.session;
      await persistHeartbeatOutcome({
        ...sessionTarget,
        runSessionKey: "agent:main:main:heartbeat",
        occurredAt: 1,
        response: { outcome: "done", notify: false, summary: "Retained CLI outcome" },
      });
      const admission = prepareSystemAgentRunAdmission(
        {},
        "run-test",
        "main",
        "heartbeat-context-test",
      );
      const input = {
        preparedRunAdmission: admission,
        sessionKey: sessionTarget.sessionKey,
        trigger: kind === "heartbeat" ? kind : ("user" as const),
        ...(kind === "in-memory" ? { sessionManager: SessionManager.inMemory(dir) } : {}),
        ...(kind === "aborted" ? { abortSignal: AbortSignal.abort() } : {}),
      };
      try {
        if (kind === "aborted") {
          await expect(fixture.prepare(input)).rejects.toThrow();
        } else {
          const context = await fixture.prepare(input);
          expect(JSON.stringify([context.params.prompt, context.promptContext])).not.toContain(
            "Retained CLI outcome",
          );
        }
        expect(
          (await claimHeartbeatOutcomeForRun({ ...sessionTarget, runId: "next-user" }))?.summary,
        ).toBe("Retained CLI outcome");
      } finally {
        admission.close();
      }
    },
  );

  it("does not renew an explicitly revoked CLI owner to claim silent heartbeat context", async () => {
    const { sessionTarget } = fixture.session;
    await persistHeartbeatOutcome({
      ...sessionTarget,
      runSessionKey: "agent:main:main:heartbeat",
      occurredAt: 1,
      response: { outcome: "done", notify: false, summary: "Keep revoked-owner outcome" },
    });
    const admission = prepareSystemAgentRunAdmission(
      {},
      "revoked-user",
      "main",
      "heartbeat-context-test",
    );
    const admittedRunContext = await admission.admit("embedded");
    admission.close();
    await expect(
      fixture.prepare({
        admittedRunContext,
        runId: "revoked-user",
        trigger: "user",
        sessionKey: sessionTarget.sessionKey,
      }),
    ).rejects.toThrow("authority");
    expect(
      (await claimHeartbeatOutcomeForRun({ ...sessionTarget, runId: "next-user" }))?.summary,
    ).toBe("Keep revoked-owner outcome");
  });

  it("honors an explicit auth agent directory independently of session identity", async () => {
    const { dir } = fixture.session;
    const modelOwnerAgentDir = path.join(dir, "ops-agent");
    const systemAgentDir = path.join(dir, "branch-agent");
    const prepareExecution = vi.fn(async () => undefined);
    fs.mkdirSync(modelOwnerAgentDir, { recursive: true });
    setRawCliBackendForPrepareTest({
      id: "test-cli",
      pluginId: "test-plugin",
      bundleMcp: false,
      prepareExecution,
      config: createArgBackendConfig("test-cli"),
    });

    const context = await fixture.prepare({
      sessionKey: "agent:branch:main",
      agentId: "branch",
      agentDir: modelOwnerAgentDir,
      authProfileId: "test-cli:ops",
      config: {
        agents: {
          entries: {
            ops: { agentDir: modelOwnerAgentDir },
            branch: { agentDir: systemAgentDir },
          },
        },
      },
    });

    expect(context.effectiveAuthProfileId).toBe("test-cli:ops");
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDir: modelOwnerAgentDir,
        authProfileId: "test-cli:ops",
      }),
    );
  });

  it("passes expired Gemini CLI OAuth fields to CLI-owned refresh", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "google-gemini-cli:user@example.test";
    const prepareExecution = vi.fn(async () => ({
      env: { GEMINI_CLI_HOME: path.join(agentDir, "gemini-home") },
    }));
    const resolveApiKeyForProfile = vi.fn(async () => {
      throw new Error("Gemini CLI OAuth must not enter core refresh");
    });
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: {
          type: "oauth",
          provider: "google-gemini-cli",
          access: "raw-access-token",
          refresh: "raw-refresh-token",
          expires: 1,
          projectId: "project-1",
          email: "user@example.test",
        },
      }),
      agentDir,
    );
    setRawCliBackendForPrepareTest({
      id: "google-gemini-cli",
      pluginId: "google",
      bundleMcp: false,
      authEpochMode: "profile-only",
      prepareExecution,
      config: createArgBackendConfig("gemini", ["--prompt", "{prompt}"], "json"),
    });
    setCliRunnerPrepareTestDeps({
      resolveApiKeyForProfile,
    });

    const context = await fixture.prepare({
      sessionKey: "agent:main:main",
      provider: "google-gemini-cli",
      model: "gemini-3.1-pro-preview",
      authProfileId,
      onSuccessfulAuthBinding: () => {},
      config: {},
    });

    expect(resolveApiKeyForProfile).not.toHaveBeenCalled();
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        authProfileId,
        authCredential: expect.objectContaining({
          type: "oauth",
          provider: "google-gemini-cli",
          access: "raw-access-token",
          refresh: "raw-refresh-token",
          expires: 1,
        }),
      }),
    );
    expect(context.authBindingFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(context.authBindingSkipsLocalCredential).toBe(true);
  });

  it("still materializes selected API keys for Gemini CLI preparation", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "google:api-key";
    const prepareExecution = vi.fn(async () => ({
      env: { GEMINI_CLI_HOME: path.join(agentDir, "gemini-home") },
    }));
    const resolveApiKeyForProfile = vi.fn(async () => ({
      apiKey: "resolved-api-key",
      profileId: authProfileId,
      profileType: "api_key" as const,
      provider: "google",
    }));
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: createApiKeyCredential("google", "stored-api-key"),
      }),
      agentDir,
    );
    setRawCliBackendForPrepareTest({
      id: "google-gemini-cli",
      pluginId: "google",
      bundleMcp: false,
      authEpochMode: "profile-only",
      prepareExecution,
      config: createArgBackendConfig("gemini", ["--prompt", "{prompt}"], "json"),
    });
    setCliRunnerPrepareTestDeps({
      resolveApiKeyForProfile,
    });

    await fixture.prepare({
      sessionKey: "agent:main:main",
      provider: "google-gemini-cli",
      model: "gemini-3.1-pro-preview",
      authProfileId,
      config: {},
    });

    expect(resolveApiKeyForProfile).toHaveBeenCalledOnce();
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        authProfileId,
        authCredential: expect.objectContaining({
          type: "api_key",
          provider: "google",
          key: "resolved-api-key",
        }),
      }),
    );
  });

  it("preserves a selected Gemini profile when backend auth preparation fails", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "google-gemini-cli:legacy";
    const backendError = new CliBackendAuthProfilePreparationError(
      "Gemini CLI OAuth profile is incomplete and cannot be repaired by Branch.",
    );
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [authProfileId]: {
            type: "oauth",
            provider: "google-gemini-cli",
            access: "expired-access-token",
            refresh: "",
            expires: 0,
          },
        },
      },
      agentDir,
    );
    setRawCliBackendForPrepareTest({
      id: "google-gemini-cli",
      pluginId: "google",
      bundleMcp: false,
      authEpochMode: "profile-only",
      prepareExecution: vi.fn(async () => {
        throw backendError;
      }),
      config: createArgBackendConfig("gemini", ["--prompt", "{prompt}"], "json"),
    });

    await expect(
      fixture.prepare({
        sessionKey: "agent:main:main",
        provider: "google-gemini-cli",
        model: "gemini-3.1-pro-preview",
        authProfileId,
        config: {},
      }),
    ).rejects.toMatchObject({
      name: "CliAuthProfilePreparationError",
      reason: "auth",
      profileId: authProfileId,
      provider: "google-gemini-cli",
      agentDir,
      cause: backendError,
    });
  });

  it("selects the configured Gemini CLI OAuth profile when no explicit profile is passed", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "google-gemini-cli:user@example.test";
    const prepareExecution = vi.fn(async () => ({
      env: { GEMINI_CLI_HOME: path.join(agentDir, "gemini-home") },
    }));
    const resolveApiKeyForProfile = vi.fn(async () => {
      throw new Error("Gemini CLI OAuth must not enter core refresh");
    });
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: {
          type: "oauth",
          provider: "google-gemini-cli",
          access: "raw-access-token",
          refresh: "raw-refresh-token",
          expires: 1_800_000_000_000,
          projectId: "project-1",
          email: "user@example.test",
        },
      }),
      agentDir,
    );
    setRawCliBackendForPrepareTest({
      id: "google-gemini-cli",
      pluginId: "google",
      bundleMcp: false,
      authEpochMode: "profile-only",
      prepareExecution,
      config: {
        command: "gemini",
        args: ["--prompt", "{prompt}"],
        output: "json",
        input: "arg",
        sessionMode: "existing",
      },
    });
    setCliRunnerPrepareTestDeps({
      resolveApiKeyForProfile,
    });

    await fixture.prepare({
      sessionKey: "agent:main:main",
      provider: "google-gemini-cli",
      model: "gemini-3.1-pro-preview",
      config: {
        auth: {
          profiles: {
            [authProfileId]: {
              provider: "google-gemini-cli",
              mode: "oauth",
              email: "user@example.test",
            },
          },
        },
      } as BranchConfig,
    });

    expect(resolveApiKeyForProfile).not.toHaveBeenCalled();
    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        authProfileId,
        authCredential: expect.objectContaining({
          type: "oauth",
          provider: "google-gemini-cli",
          access: "raw-access-token",
          refresh: "raw-refresh-token",
          expires: 1_800_000_000_000,
        }),
      }),
    );
  });

  it("does not expose auth profile credentials to non-bundled prepare hooks", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "test-cli:secret";
    const prepareExecution = vi.fn(async (_ctx: unknown) => undefined);
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: createApiKeyCredential("test-cli", "secret-key"),
      }),
      agentDir,
    );
    setRawCliBackendForPrepareTest({
      id: "test-cli",
      pluginId: "test-plugin",
      bundleMcp: false,
      prepareExecution,
      config: createArgBackendConfig("test-cli", ["--prompt", "{prompt}"], "json"),
    });

    await fixture.prepare({
      sessionKey: "agent:main:main",
      authProfileId,
      config: {},
    });

    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        authProfileId,
      }),
    );
    expect(prepareExecution.mock.calls[0]?.[0]).not.toHaveProperty("authCredential");
  });

  it.each(["connected", "missing"] as const)(
    "requires the exact selected personal CLI credential when its account is %s",
    async (accountState) => {
      const { dir } = fixture.session;
      const agentDir = path.join(dir, "agents", "main", "agent");
      const databasePath = resolveBranchStateSqlitePath();
      try {
        const owner = ensureProfileForEmail("cli-owner@example.test");
        const credential = {
          type: "token" as const,
          provider: "anthropic",
          token: "synthetic-personal-cli-token",
        };
        const connected = connectUserModelAccount({
          ownerProfileId: owner.id,
          credential,
          assertCurrent: () => undefined,
        });
        const authProfileId =
          accountState === "connected"
            ? connected.authProfileId
            : `personal:${owner.id}:${randomUUID()}`;
        const prepareExecution = vi.fn(async () => undefined);
        setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });

        const preparation = fixture.prepare({
          agentDir,
          provider: "claude-cli",
          model: "sonnet",
          authProfileId,
        });
        if (accountState === "connected") {
          await preparation;
          expect(prepareExecution).toHaveBeenCalledWith(
            expect.objectContaining({ authProfileId, authCredential: credential }),
          );
        } else {
          await expect(preparation).rejects.toThrow(
            `could not materialize selected auth profile "${authProfileId}"`,
          );
          expect(prepareExecution).not.toHaveBeenCalled();
        }
        expect(loadAuthProfileStoreWithoutExternalProfiles(agentDir).profiles).not.toHaveProperty(
          connected.authProfileId,
        );
      } finally {
        closeBranchStateDatabaseByPath(databasePath);
      }
    },
  );

  it("persists and forwards a refreshed managed Anthropic OAuth profile", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "anthropic:branch-managed";
    const prepareExecution = vi.fn(async () => undefined);
    const refreshedCredential = {
      type: "oauth" as const,
      provider: "anthropic",
      access: "refreshed-access-token",
      refresh: "refreshed-refresh-token",
      expires: Date.now() + 60 * 60_000,
    };
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: {
          type: "oauth",
          provider: "anthropic",
          access: "expired-access-token",
          refresh: "stored-refresh-token",
          expires: Date.now() - 60_000,
        },
      }),
      agentDir,
    );
    setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });
    const resolveApiKeyForProfile = vi.fn<typeof resolveApiKeyForProfileImpl>(async ({ store }) => {
      saveAuthProfileStore(
        {
          ...store,
          profiles: {
            ...store.profiles,
            [authProfileId]: refreshedCredential,
          },
        },
        agentDir,
      );
      return {
        apiKey: refreshedCredential.access,
        provider: refreshedCredential.provider,
        profileId: authProfileId,
        profileType: refreshedCredential.type,
        credential: refreshedCredential,
      };
    });
    setCliRunnerPrepareTestDeps({
      resolveApiKeyForProfile,
    });

    await fixture.prepare({
      sessionKey: "agent:main:main",
      agentDir,
      provider: "claude-cli",
      model: "sonnet",
      authProfileId,
      config: {},
    });

    expect(prepareExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        authProfileId,
        authCredential: expect.objectContaining({
          type: "oauth",
          provider: "anthropic",
          access: refreshedCredential.access,
          refresh: refreshedCredential.refresh,
        }),
      }),
    );
    expect(loadAuthProfileStoreWithoutExternalProfiles(agentDir).profiles[authProfileId]).toEqual(
      refreshedCredential,
    );
    expect(resolveApiKeyForProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: authProfileId,
        agentDir,
        allowProfileFallback: false,
      }),
    );
  });

  it.each([
    {
      label: "OAuth under the Claude CLI provider",
      credential: {
        type: "oauth" as const,
        provider: "claude-cli",
        access: "expired-imported-access",
        refresh: "imported-refresh",
        expires: Date.now() - 60_000,
        email: "owner@example.com",
      },
    },
  ])(
    "runs an imported Claude CLI login stored as $label natively without forwarding a credential",
    async ({ credential }) => {
      const { dir } = fixture.session;
      const agentDir = path.join(dir, "agents", "main", "agent");
      const authProfileId = "anthropic:claude-cli";
      const prepareExecution = vi.fn(async () => undefined);
      fs.mkdirSync(agentDir, { recursive: true });
      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            [authProfileId]: credential,
          },
        },
        agentDir,
      );
      setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });
      const resolveApiKeyForProfile = vi.fn<typeof resolveApiKeyForProfileImpl>(async () => null);
      setCliRunnerPrepareTestDeps({
        resolveApiKeyForProfile,
      });

      await fixture.prepare({
        sessionKey: "agent:main:main",
        agentDir,
        provider: "claude-cli",
        model: "sonnet",
        authProfileId,
        config: {},
      });

      expect(prepareExecution).toHaveBeenCalledTimes(1);
      expect(prepareExecution).toHaveBeenCalledWith(
        expect.objectContaining({ authProfileId: undefined, authCredential: undefined }),
      );
      expect(resolveApiKeyForProfile).not.toHaveBeenCalled();
    },
  );

  it("does not revive a selected managed credential when auth resolution returns null", async () => {
    const { dir } = fixture.session;
    const agentDir = path.join(dir, "agents", "main", "agent");
    const authProfileId = "anthropic:branch-managed";
    const prepareExecution = vi.fn(async () => undefined);
    fs.mkdirSync(agentDir, { recursive: true });
    saveAuthProfileStore(
      createAuthProfileStoreFixture({
        [authProfileId]: {
          type: "oauth",
          provider: "anthropic",
          access: "expired-access-token",
          refresh: "expired-refresh-token",
          expires: Date.now() - 60_000,
        },
      }),
      agentDir,
    );
    setCliBackendForPrepareTest({ prepareExecution, authEpochMode: "profile-only" });
    setCliRunnerPrepareTestDeps({
      resolveApiKeyForProfile: vi.fn(async () => null),
    });

    const preparation = fixture.prepare({
      sessionKey: "agent:main:main",
      agentDir,
      provider: "claude-cli",
      model: "sonnet",
      authProfileId,
      config: {},
    });
    await expect(preparation).rejects.toThrow(
      `could not materialize selected auth profile "${authProfileId}"`,
    );
    await expect(preparation).rejects.toMatchObject({
      name: "CliAuthProfilePreparationError",
      reason: "auth",
      profileId: authProfileId,
      provider: "anthropic",
      agentDir,
    });
    await expect(preparation).rejects.toThrow("branch models auth login --provider anthropic");
    expect(prepareExecution).not.toHaveBeenCalled();
  });
});

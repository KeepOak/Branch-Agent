import path from "node:path";
import { normalizeUsage, type AgentHarnessV2 } from "branch/plugin-sdk/agent-harness-runtime";
import * as agentAuth from "branch/plugin-sdk/agent-runtime";
import type { Model } from "branch/plugin-sdk/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmbeddedRunAttemptResult } from "./attempt-terminal.js";
import * as authBridge from "./auth-bridge.js";
import { CodexSettledTurnContext } from "./settled-turn-context.js";
import { projectSettledCodexMessages } from "./settled-turn-projection.js";
import {
  attachCodexMirrorAttestation,
  fingerprintCodexMirrorSourceMessage,
} from "./transcript-mirror-attestation.js";

const mocks = vi.hoisted(() => ({
  runBounded: vi.fn(),
  mirror: vi.fn(),
  nativeAuth: vi.fn(),
  quota: vi.fn(),
}));

vi.mock("./native-auth.js", () => ({ probeCodexNativeAuth: mocks.nativeAuth }));
vi.mock("./request.js", () => ({ requestCodexAppServerJson: mocks.quota }));

vi.mock("./bounded-turn.js", () => ({
  runBoundedCodexAppServerTurn: mocks.runBounded,
}));

vi.mock("./transcript-mirror.js", () => ({
  codexTranscriptMirrorRuntime: { mirror: mocks.mirror },
}));

const { runCodexSettledTurnFinalization } = await import("./settled-turn-finalizer.js");

type SettledTurnFinalizationAttemptParams = Parameters<
  NonNullable<AgentHarnessV2["finalizeSettledTurn"]>
>[0]["attempt"];

function createAttempt(
  authRequirement?: "api-key" | "subscription",
): SettledTurnFinalizationAttemptParams {
  return {
    prompt: "Produce the final user-visible answer now.",
    sessionId: "session-1",
    sessionKey: "agent:main:session-1",
    sessionFile: "/tmp/session.jsonl",
    workspaceDir: "/tmp/workspace",
    agentDir: "/tmp/synthetic-finalizer-agent",
    runId: "run-1",
    timeoutMs: 5_000,
    provider: "irrelevant-outer-provider",
    modelId: "irrelevant-outer-model",
    model: {
      id: "irrelevant-outer-model",
      provider: "irrelevant-outer-provider",
      api: "openai-chatgpt-responses",
    } as Model,
    authProfileId: "openai:outer",
    authStorage: {} as never,
    authProfileStore: {
      version: 1,
      profiles: {
        "openai:captured": { type: "api_key", provider: "openai", key: "synthetic-captured-key" },
        "openai:outer": { type: "api_key", provider: "openai", key: "synthetic-wrong-outer-key" },
      },
    },
    runtimePlan: authRequirement
      ? {
          auth: {
            providerForAuth: "openai",
            authProfileProviderForAuth: "openai",
            forwardedAuthProfileId: "openai:outer",
            modelRoute: {
              provider: "openai",
              modelId: "irrelevant-outer-model",
              api: "openai-responses",
              baseUrl: "https://api.openai.com/v1",
              authRequirement,
              requestTransportOverrides: "none",
            },
          },
          observability: { harnessId: "codex" },
        }
      : undefined,
    modelRegistry: {} as never,
    thinkLevel: "low",
  } as SettledTurnFinalizationAttemptParams;
}

function createSettledAttempt(
  selection: ConstructorParameters<typeof CodexSettledTurnContext>[1] = {
    model: "gpt-5.6-luna",
    authProfileId: "openai:captured",
  },
): EmbeddedRunAttemptResult {
  const messagesSnapshot: EmbeddedRunAttemptResult["messagesSnapshot"] = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "call-1", name: "message", arguments: {} }],
    } as never,
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "message",
      content: [{ type: "text", text: "Message sent." }],
    } as never,
  ];
  return {
    terminal: { kind: "ok" },
    sessionIdUsed: "session-1",
    messagesSnapshot,
    settledTurnFinalizationContext: new CodexSettledTurnContext(
      projectSettledCodexMessages([
        { role: "user", content: "Send the update to Alice." } as never,
        ...messagesSnapshot,
      ]),
      selection,
    ),
    assistantTexts: [],
    toolMetas: [{ toolName: "message", replaySafe: false }],
    lastAssistant: undefined,
    lastToolError: undefined,
    didSendViaMessagingTool: true,
    messagingToolSentTexts: ["update"],
    messagingToolSentMediaUrls: [],
    messagingToolSentTargets: [],
    toolMediaUrls: ["/tmp/already-delivered.png"],
    toolAudioAsVoice: true,
    hasToolMediaBlockReply: true,
    successfulCronAdds: 1,
    cloudCodeAssistFormatError: false,
    attemptUsage: { input: 100, output: 20, total: 120 },
    replayMetadata: { hadPotentialSideEffects: true, replaySafe: false },
    currentAttemptReplayMetadata: { hadPotentialSideEffects: true, replaySafe: false },
    itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
  };
}

function boundedResult() {
  return {
    text: "The update was sent successfully.",
    items: [],
    model: "synthetic-catalog-id",
    nativeSelection: { model: "synthetic-summary-model", modelProvider: "openai" },
    usage: { input: 5, output: 4, cacheRead: 2, cacheWrite: 1, reasoningTokens: 3, total: 12 },
  };
}

function nativeSummaryFixture(failover = true) {
  const owner = path.resolve("fixture-summary-owner");
  const alternate = path.resolve("fixture-summary-alternate");
  const operation = {
    attempt: { ...createAttempt("api-key"), resolvedApiKey: "synthetic-outer-key" },
    settledAttempt: createSettledAttempt({
      model: "gpt-5.6-luna",
      modelProvider: "openai",
      nativeAccountHome: owner,
    }),
  };
  const options = {
    pluginConfig: {
      appServer: {
        homeScope: "user",
        nativeAccounts: [
          { id: "owner", home: owner },
          { id: "alternate", home: alternate },
        ],
        nativeAccountId: "alternate",
        nativeAccountQuotaFailover: failover,
      },
    },
  };
  return { owner, alternate, operation, options };
}

describe("runCodexSettledTurnFinalization", () => {
  beforeEach(() => {
    mocks.nativeAuth
      .mockReset()
      .mockResolvedValue({ nativeAuth: { runtime: "codex", mode: "oauth" } });
    mocks.quota.mockReset().mockResolvedValue({
      rateLimits: { limitId: "codex", primary: { usedPercent: 10 } },
    });
    vi.spyOn(authBridge, "resolveCodexAppServerPreparedAuthHandoff");
    mocks.runBounded.mockReset().mockResolvedValue(boundedResult());
    mocks.mirror.mockReset();
    mocks.mirror.mockImplementation(
      async (params: {
        messages: EmbeddedRunAttemptResult["messagesSnapshot"];
        assertCurrent?: () => void;
      }) => {
        params.assertCurrent?.();
        const assistant = params.messages[0]!;
        return {
          assistantMirrorIdentitiesOwned: ["settled-finalizer:run-1"],
          messagesPresent: [
            attachCodexMirrorAttestation(
              Object.assign({}, assistant, {
                idempotencyKey: "codex-settled-finalizer:run-1:assistant",
              }),
              fingerprintCodexMirrorSourceMessage(assistant as never),
            ),
          ],
        };
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preflights captured owner before changed default and summarizes once on the alternate", async () => {
    const { owner, alternate, operation, options } = nativeSummaryFixture();
    const source = structuredClone(operation.settledAttempt);
    mocks.quota.mockResolvedValueOnce({
      rateLimits: { limitId: "codex", primary: { usedPercent: 100 } },
    });
    const result = await runCodexSettledTurnFinalization(operation, options);
    expect(mocks.quota.mock.calls.map(([request]) => request.startOptions.codexHome)).toEqual([
      owner,
      alternate,
    ]);
    for (const [request] of mocks.quota.mock.calls) {
      expect(request).toMatchObject({
        method: "account/rateLimits/read",
        isolated: true,
        authProfileId: null,
      });
      expect(request.startOptions.clearEnv).toEqual(
        expect.arrayContaining(["CODEX_API_KEY", "OPENAI_API_KEY", "CODEX_ACCESS_TOKEN"]),
      );
    }
    expect(mocks.runBounded).toHaveBeenCalledOnce();
    expect(mocks.runBounded).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { mode: "required", id: "gpt-5.6-luna" },
        modelProvider: "openai",
        profile: undefined,
        authRequirement: "subscription",
        requireNoExternalCapabilities: true,
        historyItems: (
          operation.settledAttempt.settledTurnFinalizationContext as CodexSettledTurnContext
        ).data,
        options: expect.objectContaining({
          pluginConfig: expect.objectContaining({
            appServer: expect.objectContaining({ codexHome: alternate }),
          }),
        }),
      }),
    );
    expect(authBridge.resolveCodexAppServerPreparedAuthHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        authProfileId: undefined,
        resolvedApiKey: undefined,
        homeScope: "user",
      }),
    );
    expect(mocks.mirror).toHaveBeenCalledOnce();
    expect(mocks.mirror).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        idempotencyScope: "codex-settled-finalizer:run-1",
        terminalAssistantOwner: { mirrorIdentity: "settled-finalizer:run-1", runId: "run-1" },
      }),
    );
    expect(result.assistantTranscriptOwned).toBe(true);
    expect(structuredClone(operation.settledAttempt)).toEqual(source);
    expect(options.pluginConfig.appServer.nativeAccountId).toBe("alternate");
  });

  it("does not inspect an alternate when captured owner's quota is available", async () => {
    const { owner, operation, options } = nativeSummaryFixture();
    await runCodexSettledTurnFinalization(operation, options);
    expect(mocks.quota.mock.calls.map(([request]) => request.startOptions.codexHome)).toEqual([
      owner,
    ]);
    expect(mocks.runBounded.mock.calls[0]![0].options.pluginConfig.appServer.codexHome).toBe(owner);
  });

  it.each([true, false])(
    "starts no summary when eligible accounts are exhausted (failover=%s)",
    async (failover) => {
      const { operation, options } = nativeSummaryFixture(failover);
      mocks.quota.mockResolvedValue({
        rateLimits: { limitId: "codex", primary: { usedPercent: 100 } },
      });
      await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow(
        "exhausted quota",
      );
      expect(mocks.quota).toHaveBeenCalledTimes(failover ? 2 : 1);
      expect(mocks.runBounded).not.toHaveBeenCalled();
      expect(mocks.mirror).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "api-key", "token"])(
    "never rotates on native auth failure/mode %s",
    async (mode) => {
      const { operation, options } = nativeSummaryFixture();
      mocks.nativeAuth.mockResolvedValue(
        mode ? { nativeAuth: { runtime: "codex", mode } } : undefined,
      );
      await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow(
        "subscription login",
      );
      expect(mocks.nativeAuth).toHaveBeenCalledOnce();
      expect(mocks.quota).not.toHaveBeenCalled();
      expect(mocks.runBounded).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { rateLimits: { limitId: "codex" } }, { ordinaryUsageAllowed: null }])(
    "never rotates on unknown quota %j",
    async (quota) => {
      const { operation, options } = nativeSummaryFixture();
      mocks.quota.mockResolvedValue(quota);
      await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow(
        "quota is unavailable",
      );
      expect(mocks.quota).toHaveBeenCalledOnce();
      expect(mocks.runBounded).not.toHaveBeenCalled();
    },
  );

  it.each(["transport unavailable", "quota timeout"])("never rotates on %s", async (reason) => {
    const { operation, options } = nativeSummaryFixture();
    const error = new Error(reason);
    mocks.quota.mockRejectedValue(error);
    await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toBe(error);
    expect(mocks.quota).toHaveBeenCalledOnce();
    expect(mocks.runBounded).not.toHaveBeenCalled();
  });

  it("honors cancellation between exhausted-owner quota and alternate admission", async () => {
    const { operation, options } = nativeSummaryFixture();
    const controller = new AbortController();
    operation.attempt.abortSignal = controller.signal;
    mocks.quota.mockImplementationOnce(async () => {
      controller.abort(new Error("fixture cancellation"));
      return { rateLimits: { limitId: "codex", primary: { usedPercent: 100 } } };
    });
    await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow(
      "fixture cancellation",
    );
    expect(mocks.nativeAuth).toHaveBeenCalledOnce();
    expect(mocks.runBounded).not.toHaveBeenCalled();
  });

  it("never retries a summary after model handoff fails", async () => {
    const { operation, options } = nativeSummaryFixture();
    const quotaFailure = new Error("usageLimitExceeded after turn start");
    mocks.runBounded.mockRejectedValue(quotaFailure);
    await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toBe(quotaFailure);
    expect(mocks.quota).toHaveBeenCalledOnce();
    expect(mocks.runBounded).toHaveBeenCalledOnce();
    expect(mocks.mirror).not.toHaveBeenCalled();
  });

  it("starts no account inspection or summary after the selection budget expires", async () => {
    const { operation, options } = nativeSummaryFixture();
    operation.attempt.timeoutMs = 0;
    await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow(
      "inspection timed out",
    );
    expect(mocks.nativeAuth).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.runBounded).not.toHaveBeenCalled();
  });

  it("does not bypass passive capability validation on an alternate account", async () => {
    const { operation, options } = nativeSummaryFixture();
    mocks.quota.mockResolvedValueOnce({
      rateLimits: { limitId: "codex", primary: { usedPercent: 100 } },
    });
    mocks.runBounded.mockResolvedValue({
      ...boundedResult(),
      items: [{ type: "commandExecution", id: "forbidden-summary-command" }],
    });
    await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow();
    expect(mocks.runBounded).toHaveBeenCalledOnce();
    expect(mocks.mirror).not.toHaveBeenCalled();
  });

  it("does not skip mirror attestation on an alternate account", async () => {
    const { operation, options } = nativeSummaryFixture();
    mocks.quota.mockResolvedValueOnce({
      rateLimits: { limitId: "codex", primary: { usedPercent: 100 } },
    });
    mocks.mirror.mockResolvedValue({ assistantMirrorIdentitiesOwned: [], messagesPresent: [] });
    await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow(
      "transcript attestation mismatch",
    );
    expect(mocks.runBounded).toHaveBeenCalledOnce();
    expect(mocks.mirror).toHaveBeenCalledOnce();
  });

  it("rejects native registry finalization without a captured owner before account inspection", async () => {
    const { operation, options } = nativeSummaryFixture();
    operation.settledAttempt = createSettledAttempt();
    await expect(runCodexSettledTurnFinalization(operation, options)).rejects.toThrow(
      "no captured native account owner",
    );
    expect(mocks.nativeAuth).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.runBounded).not.toHaveBeenCalled();
  });

  it("keeps the captured native home for finalization after the default changes", async () => {
    const captured = path.resolve("fixture-captured-home");
    const changed = path.resolve("fixture-new-default");
    await runCodexSettledTurnFinalization(
      {
        attempt: { ...createAttempt("api-key"), resolvedApiKey: "synthetic-outer-billed-key" },
        settledAttempt: createSettledAttempt({
          model: "gpt-5.6-luna",
          nativeAccountHome: captured,
        }),
      },
      {
        pluginConfig: {
          appServer: {
            homeScope: "user",
            nativeAccounts: [
              { id: "captured", home: captured },
              { id: "changed", home: changed },
            ],
            nativeAccountId: "changed",
          },
        },
      },
    );
    expect(authBridge.resolveCodexAppServerPreparedAuthHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        homeScope: "user",
        authProfileId: undefined,
        resolvedApiKey: undefined,
        authRequirement: "subscription",
      }),
    );
    expect(mocks.runBounded).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: undefined,
        authRequirement: "subscription",
        isolation: "configured-transport",
        options: expect.objectContaining({
          pluginConfig: expect.objectContaining({
            appServer: expect.objectContaining({ codexHome: captured }),
          }),
        }),
      }),
    );
  });

  it("refuses finalization if the captured native home is no longer registered", async () => {
    await expect(
      runCodexSettledTurnFinalization(
        {
          attempt: createAttempt(),
          settledAttempt: createSettledAttempt({
            model: "gpt-5.6-luna",
            nativeAccountHome: path.resolve("fixture-removed-home"),
          }),
        },
        { pluginConfig: {} },
      ),
    ).rejects.toThrow("no longer registered");
    expect(mocks.runBounded).not.toHaveBeenCalled();
    expect(authBridge.resolveCodexAppServerPreparedAuthHandoff).not.toHaveBeenCalled();
  });

  it("binds tool-result failure status into mirror attestations", () => {
    const toolResult = {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "message",
      content: [{ type: "text", text: "Message sent." }],
    };

    expect(fingerprintCodexMirrorSourceMessage(toolResult as never)).not.toBe(
      fingerprintCodexMirrorSourceMessage({ ...toolResult, isError: true } as never),
    );
  });

  it("uses captured model/profile and returned native attribution", async () => {
    const modelProvider = "openai";
    const attempt = createAttempt();
    attempt.prepareAssistantTranscriptMessage = (message) => message;
    const settledAttempt = createSettledAttempt({
      model: "gpt-5.6-luna",
      modelProvider,
      authProfileId: "openai:captured",
    });
    const settledBefore = structuredClone(settledAttempt);
    const result = await runCodexSettledTurnFinalization(
      { attempt, settledAttempt },
      { pluginConfig: {} },
    );

    expect(authBridge.resolveCodexAppServerPreparedAuthHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        homeScope: "agent",
        authProfileId: "openai:captured",
        authProfileStore: attempt.authProfileStore,
      }),
    );
    expect(mocks.runBounded).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { mode: "required", id: "gpt-5.6-luna" },
        modelProvider,
        profile: "openai:captured",
        isolation: "private-stdio",
        requireNoExternalCapabilities: true,
        allowEmptyText: true,
        historyItems: [
          expect.objectContaining({ type: "message", role: "user" }),
          expect.objectContaining({ type: "function_call", call_id: "call-1" }),
          expect.objectContaining({ type: "function_call_output", call_id: "call-1" }),
        ],
        input: [{ type: "text", text: attempt.prompt, text_elements: [] }],
      }),
    );
    expect(mocks.mirror).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        idempotencyScope: "codex-settled-finalizer:run-1",
        skipBeforeMessageWriteHooks: true,
        prepareAssistantTranscriptMessage: attempt.prepareAssistantTranscriptMessage,
        messages: [
          expect.objectContaining({
            role: "assistant",
            provider: "openai",
            model: "synthetic-summary-model",
          }),
        ],
      }),
    );
    expect(result).toMatchObject({
      assistantTranscriptOwned: true,
      assistantTranscriptIdempotencyKey: "codex-settled-finalizer:run-1:assistant",
      usage: boundedResult().usage,
      assistant: {
        role: "assistant",
        api: "openai-chatgpt-responses",
        provider: "openai",
        model: "synthetic-summary-model",
        content: [{ type: "text", text: "The update was sent successfully." }],
      },
    });
    expect(normalizeUsage(result.assistant.usage)?.reasoningTokens).toBe(3);
    expect(structuredClone(settledAttempt)).toEqual(settledBefore);
  });

  it("uses the prepared API key without resolving the outer profile", async () => {
    const attempt = createAttempt("api-key");
    attempt.resolvedApiKey = "synthetic-resolved-api-key";
    attempt.model = { ...attempt.model, api: "openai-responses" };
    const resolveProfile = vi.spyOn(agentAuth, "resolveApiKeyForProfile");

    const result = await runCodexSettledTurnFinalization(
      { attempt, settledAttempt: createSettledAttempt() },
      {},
    );

    expect(mocks.runBounded).toHaveBeenCalledWith(
      expect.objectContaining({
        preparedAuth: { kind: "api-key", apiKey: "synthetic-resolved-api-key" },
        authRequirement: "api-key",
        authProfileStore: attempt.authProfileStore,
      }),
    );
    expect(mocks.runBounded.mock.calls[0]?.[0]).not.toHaveProperty("profile");
    expect(resolveProfile).not.toHaveBeenCalled();
    expect(result.assistant).toMatchObject({
      api: "openai-responses",
      provider: "openai",
      model: "synthetic-summary-model",
    });
  });

  it("uses configured transport for remote settled finalization", async () => {
    const attempt = createAttempt();
    const settledAttempt = createSettledAttempt({
      model: "gpt-5.6-luna",
      modelProvider: "openai",
      authProfileId: "openai:captured",
    });
    const options = {
      pluginConfig: { appServer: { transport: "websocket", url: "ws://127.0.0.1:19400" } },
    };

    await runCodexSettledTurnFinalization({ attempt, settledAttempt }, options);

    expect(mocks.runBounded).toHaveBeenCalledWith(
      expect.objectContaining({
        isolation: "configured-transport",
        requireNoExternalCapabilities: true,
        options,
      }),
    );
  });

  it.each(["agent", "user"])(
    "uses the selected scoped subscription for a bounded side turn (ordinary home: %s)",
    async (homeScope) => {
      const attempt = createAttempt("subscription");
      const token = [
        Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
        Buffer.from(
          JSON.stringify({
            "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" },
          }),
        ).toString("base64url"),
        "synthetic-signature",
      ].join(".");
      attempt.authProfileStore.profiles["openai:captured"] = {
        type: "token",
        provider: "openai",
        token,
      };
      const resolveProfile = vi.spyOn(agentAuth, "resolveApiKeyForProfile").mockResolvedValue({
        apiKey: token,
        provider: "openai",
        profileId: "openai:captured",
        profileType: "token",
      });
      const ordinaryNativeHome = homeScope === "user";
      if (ordinaryNativeHome) {
        attempt.runtimePlan!.auth.forwardedAuthProfileId = "openai:captured";
      }
      const settledAttempt = createSettledAttempt({
        model: "gpt-5.6-luna",
        authProfileId: ordinaryNativeHome ? undefined : "openai:captured",
      });
      const options = { pluginConfig: { appServer: { homeScope } } };

      await runCodexSettledTurnFinalization({ attempt, settledAttempt }, options);

      expect(resolveProfile).toHaveBeenCalledExactlyOnceWith({
        store: attempt.authProfileStore,
        profileId: "openai:captured",
        agentDir: attempt.agentDir,
      });
      expect(authBridge.resolveCodexAppServerPreparedAuthHandoff).toHaveBeenCalledWith(
        expect.objectContaining({
          homeScope: "agent",
          authProfileId: "openai:captured",
          authProfileStore: attempt.authProfileStore,
          authRequirement: "subscription",
        }),
      );
      expect(mocks.runBounded).toHaveBeenCalledWith(
        expect.objectContaining({
          isolation: "private-stdio",
          options,
          authRequirement: "subscription",
          preparedAuth: {
            kind: "profile",
            profileId: "openai:captured",
            store: attempt.authProfileStore,
            snapshot: expect.objectContaining({
              loginParams: {
                type: "chatgptAuthTokens",
                accessToken: token,
                chatgptAccountId: "synthetic-account",
                chatgptPlanType: null,
              },
            }),
          },
        }),
      );
      expect(mocks.runBounded.mock.calls[0]?.[0]).not.toHaveProperty("profile");
    },
  );

  it.each([" ", "NO_REPLY", " NO_REPLY\n", "no_reply"])(
    "preserves non-visible output with native attribution for %j without transcript mutation",
    async (text) => {
      mocks.runBounded.mockResolvedValue({ ...boundedResult(), text });

      await expect(
        runCodexSettledTurnFinalization(
          { attempt: createAttempt(), settledAttempt: createSettledAttempt() },
          {},
        ),
      ).resolves.toMatchObject({
        assistant: {
          provider: "openai",
          model: "synthetic-summary-model",
          content: [{ type: "text", text: text.trim() }],
        },
      });
      expect(mocks.runBounded).toHaveBeenCalledOnce();
      expect(mocks.mirror).not.toHaveBeenCalled();
    },
  );

  it("does not mutate the transcript when the bounded turn is interrupted", async () => {
    mocks.runBounded.mockRejectedValue(
      new Error("codex app-server settled-turn finalization turn ended with status interrupted"),
    );

    await expect(
      runCodexSettledTurnFinalization(
        { attempt: createAttempt(), settledAttempt: createSettledAttempt() },
        {},
      ),
    ).rejects.toThrow("turn ended with status interrupted");
    expect(mocks.mirror).not.toHaveBeenCalled();
  });

  it("rejects a missing native provider instead of using outer attribution", async () => {
    const modelProvider = null;
    mocks.runBounded.mockResolvedValue({
      ...boundedResult(),
      nativeSelection: { model: "synthetic-summary-model", modelProvider },
    });
    await expect(
      runCodexSettledTurnFinalization(
        { attempt: createAttempt(), settledAttempt: createSettledAttempt() },
        {},
      ),
    ).rejects.toThrow("did not report its native model provider");
    expect(mocks.mirror).not.toHaveBeenCalled();
  });

  it.each(["commandExecution", "futureCapabilityItem"])(
    "rejects unexpected native %s evidence before transcript mutation",
    async (type) => {
      mocks.runBounded.mockResolvedValue({
        ...boundedResult(),
        managedHooksEnabled: true,
        items: [{ id: "item-1", type }],
      });

      await expect(
        runCodexSettledTurnFinalization(
          { attempt: createAttempt(), settledAttempt: createSettledAttempt() },
          {},
        ),
      ).rejects.toThrow(`unexpected native item: ${type}`);
      expect(mocks.mirror).not.toHaveBeenCalled();
    },
  );

  it("accepts an attested managed Stop-hook continuation before mirroring the revised answer", async () => {
    const attempt = createAttempt();
    mocks.runBounded.mockResolvedValue({
      ...boundedResult(),
      managedHooksEnabled: true,
      items: [
        { id: "draft", type: "agentMessage", text: "An earlier draft." },
        {
          id: "hook",
          type: "hookPrompt",
          fragments: [{ text: "Revise the answer.", hookRunId: "managed-stop-1" }],
        },
        { id: "answer", type: "agentMessage", text: "The update was sent successfully." },
      ],
    });

    await expect(
      runCodexSettledTurnFinalization({ attempt, settledAttempt: createSettledAttempt() }, {}),
    ).resolves.toMatchObject({ assistantTranscriptOwned: true });
    expect(mocks.mirror).toHaveBeenCalledOnce();
  });

  it.each(["NO_REPLY", " "])(
    "preserves %j after an attested managed Stop-hook continuation without mirroring",
    async (text) => {
      mocks.runBounded.mockResolvedValue({
        ...boundedResult(),
        text,
        managedHooksEnabled: true,
        items: [
          { id: "draft", type: "agentMessage", text: "An earlier draft." },
          {
            id: "hook",
            type: "hookPrompt",
            fragments: [{ text: "Revise the answer.", hookRunId: "managed-stop-1" }],
          },
          { id: "answer", type: "agentMessage", text },
        ],
      });

      await expect(
        runCodexSettledTurnFinalization(
          { attempt: createAttempt(), settledAttempt: createSettledAttempt() },
          {},
        ),
      ).resolves.toMatchObject({
        assistant: {
          provider: "openai",
          model: "synthetic-summary-model",
          content: [{ type: "text", text: text.trim() }],
        },
      });
      expect(mocks.runBounded).toHaveBeenCalledOnce();
      expect(mocks.mirror).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, false])(
    "rejects unattested hook continuations before transcript mutation (%s)",
    async (managedHooksEnabled) => {
      mocks.runBounded.mockResolvedValue({
        ...boundedResult(),
        managedHooksEnabled,
        items: [
          {
            id: "hook",
            type: "hookPrompt",
            fragments: [{ text: "Revise the answer.", hookRunId: "hook-1" }],
          },
        ],
      });

      await expect(
        runCodexSettledTurnFinalization(
          { attempt: createAttempt(), settledAttempt: createSettledAttempt() },
          {},
        ),
      ).rejects.toThrow("unexpected native item: hookPrompt");
      expect(mocks.mirror).not.toHaveBeenCalled();
    },
  );

  it("accepts the exact current-turn prompt echo once", async () => {
    const attempt = createAttempt();
    mocks.runBounded.mockResolvedValue({
      ...boundedResult(),
      items: [
        {
          id: "prompt-echo",
          type: "userMessage",
          content: [{ type: "text", text: attempt.prompt, text_elements: [] }],
        },
        { id: "answer", type: "agentMessage", text: "The update was sent successfully." },
      ],
    });

    await expect(
      runCodexSettledTurnFinalization({ attempt, settledAttempt: createSettledAttempt() }, {}),
    ).resolves.toMatchObject({ assistantTranscriptOwned: true });
    expect(mocks.mirror).toHaveBeenCalledOnce();
  });

  it.each(["mismatched", "duplicate"])(
    "rejects a %s current-turn prompt echo before transcript mutation",
    async (kind) => {
      const attempt = createAttempt();
      const promptEcho = {
        type: "userMessage",
        content: [
          {
            type: "text",
            text: kind === "mismatched" ? "A different prompt." : attempt.prompt,
            text_elements: [],
          },
        ],
      };
      mocks.runBounded.mockResolvedValue({
        ...boundedResult(),
        items: [
          { id: "prompt-echo-1", ...promptEcho },
          ...(kind === "duplicate" ? [{ id: "prompt-echo-2", ...promptEcho }] : []),
        ],
      });

      await expect(
        runCodexSettledTurnFinalization({ attempt, settledAttempt: createSettledAttempt() }, {}),
      ).rejects.toThrow("unexpected native item: userMessage");
      expect(mocks.mirror).not.toHaveBeenCalled();
    },
  );

  it("rejects forged context before host auth or an isolated client can be used", async () => {
    const settledAttempt = createSettledAttempt();
    settledAttempt.settledTurnFinalizationContext = { source: "harness", data: [] };
    const before = structuredClone(settledAttempt);
    const clientFactory = vi.fn();
    await expect(
      runCodexSettledTurnFinalization(
        { attempt: createAttempt(), settledAttempt },
        { clientFactory },
      ),
    ).rejects.toThrow("finalization context is unavailable");
    expect(authBridge.resolveCodexAppServerPreparedAuthHandoff).not.toHaveBeenCalled();
    expect(mocks.runBounded).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
    expect(mocks.mirror).not.toHaveBeenCalled();
    expect(structuredClone(settledAttempt)).toEqual(before);
  });

  it.each([
    "before auth",
    "after auth",
    "after inference",
    "at mirror write",
    "after mirror write",
  ])("rejects cancellation %s without returning a stale final answer", async (stage) => {
    const caller = new AbortController();
    const attempt = { ...createAttempt(), abortSignal: caller.signal };
    const reason = new Error("finalizer cancelled");
    if (stage === "before auth") {
      caller.abort(reason);
    } else if (stage === "after auth") {
      vi.mocked(authBridge.resolveCodexAppServerPreparedAuthHandoff).mockImplementationOnce(
        async () => {
          caller.abort(reason);
          return { nativeAuthProfile: false, authProfileId: "openai:captured" };
        },
      );
    } else if (stage === "after inference") {
      mocks.runBounded.mockImplementationOnce(async () => {
        caller.abort(reason);
        return boundedResult();
      });
    } else {
      const mirror = mocks.mirror.getMockImplementation()!;
      mocks.mirror.mockImplementationOnce(async (params) => {
        if (stage === "at mirror write") {
          caller.abort(reason);
        }
        const result = await mirror(params);
        caller.abort(reason);
        return result;
      });
    }

    await expect(
      runCodexSettledTurnFinalization({ attempt, settledAttempt: createSettledAttempt() }, {}),
    ).rejects.toBe(reason);
    if (stage === "before auth") {
      expect(authBridge.resolveCodexAppServerPreparedAuthHandoff).not.toHaveBeenCalled();
    }
    if (stage === "before auth" || stage === "after auth") {
      expect(mocks.runBounded).not.toHaveBeenCalled();
    }
    expect(mocks.mirror).toHaveBeenCalledTimes(stage.includes("mirror") ? 1 : 0);
  });

  it("rejects a stale idempotency hit instead of delivering an unpersisted answer", async () => {
    mocks.mirror.mockImplementation(
      async (params: { messages: EmbeddedRunAttemptResult["messagesSnapshot"] }) => {
        const staleAssistant = {
          ...params.messages[0]!,
          content: [{ type: "text", text: "An older final answer." }],
        } as (typeof params.messages)[number];
        return {
          assistantMirrorIdentitiesOwned: ["settled-finalizer:run-1"],
          messagesPresent: [
            attachCodexMirrorAttestation(
              staleAssistant,
              fingerprintCodexMirrorSourceMessage(staleAssistant as never),
            ),
          ],
        };
      },
    );

    await expect(
      runCodexSettledTurnFinalization(
        { attempt: createAttempt(), settledAttempt: createSettledAttempt() },
        {},
      ),
    ).rejects.toThrow("transcript attestation mismatch");
  });
});

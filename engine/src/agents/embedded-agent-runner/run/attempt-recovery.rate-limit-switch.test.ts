import { beforeEach, describe, expect, it, vi } from "vitest";
import { sleepWithAbort } from "../../../infra/backoff.js";
import type { AuthProfileStore } from "../../auth-profiles.js";
import { isProfileInCooldown } from "../../auth-profiles.js";
import { FailoverError } from "../../failover-error.js";
import {
  buildEmbeddedRunnerAssistant,
  createMockUsage,
  makeEmbeddedRunnerAttempt,
} from "../../test-helpers/embedded-agent-runner-e2e-fixtures.js";
import { createUsageAccumulator } from "../usage-accumulator.js";
import { recoverEmbeddedRunAttempt } from "./attempt-recovery.js";
import { disabledCompactionRuntime } from "./attempt-recovery.test-support.js";
import { createEmbeddedRunContextRecoveryState } from "./context-recovery-state.js";
import {
  createEmbeddedRunFailoverRetryController,
  RATE_LIMIT_ACCOUNT_SWITCH_AFTER_MS,
} from "./failover-retry-controller.js";
import { resolveEmbeddedRunAttemptTerminalState } from "./terminal-outcome.js";

vi.mock("../../../infra/backoff.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infra/backoff.js")>()),
  sleepWithAbort: vi.fn(async () => {}),
}));

// mock-isolation: keep the limited mark in memory; usage.blocked-retry-after.test.ts covers the write.
vi.mock("../../auth-profiles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth-profiles.js")>()),
  markAuthProfileBlockedUntil: vi.fn(
    async (params: {
      store: AuthProfileStore;
      profileId: string;
      blockedUntil: number;
      source: "provider_retry_after";
    }) => {
      params.store.usageStats ??= {};
      params.store.usageStats[params.profileId] = {
        ...params.store.usageStats[params.profileId],
        blockedUntil: params.blockedUntil,
        blockedReason: "subscription_limit",
        blockedSource: params.source,
      };
    },
  ),
}));

const THIRTY_HOURS_MS = 30 * 60 * 60 * 1000;
const PROVIDER = "anthropic";
const MODEL = "claude-fixture-1";

function fixtureStore(): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      "anthropic:first": { type: "token", provider: PROVIDER, token: "fixture-token-first" },
      "anthropic:key": { type: "api_key", provider: PROVIDER, key: "fixture-key" },
      "anthropic:second": { type: "token", provider: PROVIDER, token: "fixture-token-second" },
    },
  } as AuthProfileStore;
}

type Scenario = {
  candidates: string[];
  retryAfterMs?: number;
  replaySafe?: boolean;
  fallbackConfigured?: boolean;
  pinned?: boolean;
  /** Provider error text; defaults to generic rate-limit wording with the Retry-After. */
  errorMessage?: string;
  /** Saved retry.provider.maxRetryDelayMs for the attempt. */
  maxRetryDelayMs?: number;
};

/** The usage-window wording a subscription returns when its 5-hour or weekly limit is hit. */
const USAGE_LIMIT_MESSAGE = "429 subscription usage limit. Retry after 108000 seconds.";
const USAGE_LIMIT_MS = 108_000 * 1000;

/** One finished attempt: a tool ran, then the provider answered 429 with a Retry-After. */
async function recoverFromRateLimit(scenario: Scenario) {
  const store = fixtureStore();
  const candidates = scenario.candidates;
  let index = 0;
  let current: string | undefined = candidates[0];
  const used: string[] = [candidates[0]];
  // Mirrors auth-controller advanceAuthProfile: forward through the run's order, skipping
  // cooldowns and, with `accept`, the profiles it rejects; a filtered miss keeps the current one.
  const advanceAuthProfile = vi.fn(
    async (options?: { accept?: (profileId: string | undefined) => boolean }) => {
      const startIndex = index;
      while (++index < candidates.length) {
        const candidate = candidates[index];
        if (options?.accept && !options.accept(candidate)) {
          continue;
        }
        if (!isProfileInCooldown(store, candidate, undefined, MODEL)) {
          current = candidate;
          used.push(candidate);
          return true;
        }
      }
      if (options?.accept) {
        index = startIndex;
      }
      return false;
    },
  );
  const seconds = Math.round((scenario.retryAfterMs ?? THIRTY_HOURS_MS) / 1000);
  const erroredAssistant = buildEmbeddedRunnerAssistant({
    api: "anthropic-messages",
    provider: PROVIDER,
    model: MODEL,
    stopReason: "error",
    errorMessage:
      scenario.errorMessage ??
      `429 This request would exceed your account's rate limit. Retry after ${seconds} seconds.`,
    content: [],
    usage: createMockUsage(0, 0),
  });
  const toolAssistant = buildEmbeddedRunnerAssistant({
    provider: PROVIDER,
    model: MODEL,
    stopReason: "toolUse",
    content: [{ type: "toolCall", id: "call_1", name: "exec", arguments: {} }],
  });
  const attempt = makeEmbeddedRunnerAttempt({
    assistantTexts: [],
    messagesSnapshot: [
      { role: "user", content: "tidy the fixture folder" },
      toolAssistant,
      { role: "toolResult", toolCallId: "call_1", toolName: "exec", isError: false },
      erroredAssistant,
    ] as never,
    toolMetas: [{ toolCallId: "call_1", toolName: "exec", replaySafe: false }] as never,
    lastAssistant: erroredAssistant,
    currentAttemptAssistant: erroredAssistant,
    itemLifecycle: { startedCount: 1, completedCount: 1, activeCount: 0 },
    ...(scenario.maxRetryDelayMs !== undefined
      ? { providerRetryMaxDelayMs: scenario.maxRetryDelayMs }
      : {}),
    ...(scenario.replaySafe
      ? { currentAttemptReplayMetadata: { replaySafe: true, hadPotentialSideEffects: false } }
      : {}),
  });
  const terminalState = resolveEmbeddedRunAttemptTerminalState({
    attempt,
    assistant: erroredAssistant,
  });
  const controller = createEmbeddedRunFailoverRetryController({
    runParams: {
      runId: "run:rate-limit-switch",
      ...(scenario.pinned
        ? { authProfileId: candidates[0], authProfileIdSource: "user" as const }
        : {}),
    } as Parameters<typeof createEmbeddedRunFailoverRetryController>[0]["runParams"],
    provider: PROVIDER,
    modelId: MODEL,
    globalLane: "test",
    agentDir: "/tmp/rate-limit-switch-test",
    fallbackConfigured: scenario.fallbackConfigured ?? false,
    profileFailureStore: store,
    getLastProfileId: () => current,
    getSessionId: () => "session:rate-limit-switch",
    harnessOwnsTransport: () => false,
    getRuntimeAuthOwnerId: () => "embedded",
    getApiKeyInfo: () => null,
    advanceAuthProfile,
  });
  const markOwnedTranscriptRetry = vi.fn();
  const continueFromCurrentTranscript = vi.fn();
  const onAgentEvent = vi.fn();
  const sessionPromptState = {
    sessionFile: "/tmp/session.jsonl",
    suppressNextUserMessagePersistence: false,
    withSessionWriterContext: (run: () => Promise<unknown>) => run(),
    recordOutputLimitNotice: vi.fn(async () => {}),
    settleOwnedTranscriptProjection: vi.fn(async () => {}),
    markOwnedTranscriptRetry,
    continueFromCurrentTranscript,
  };
  const startedAt = Date.now();
  const recovery = await recoverEmbeddedRunAttempt({
    runInput: {
      runParams: {
        config: {},
        agentId: "main",
        sessionId: "session:rate-limit-switch",
        runId: "run:rate-limit-switch",
        onAgentEvent,
      },
      resolvedSessionKey: "agent:main:rate-limit-switch",
      fallbackConfigured: scenario.fallbackConfigured ?? false,
      suspendForFailure: vi.fn(),
      startedAtMs: startedAt,
      laneController: { throwIfAborted: vi.fn() },
    },
    preparedRuntime: {
      provider: PROVIDER,
      modelId: MODEL,
      model: { id: MODEL },
      profileCandidates: candidates,
      genericCompactionRecoveryAllowed: false,
      attemptedThinking: new Set(["off"]),
      maybeRefreshRuntimeAuthForAuthError: vi.fn(async () => false),
      snapshot: () => ({
        thinkLevel: "off",
        agentHarness: { id: "branch" },
        outerContextTokenMeta: {},
        pluginHarnessOwnsTransport: false,
      }),
    },
    normalizedAttempt: {
      attempt,
      sessionIdUsed: attempt.sessionIdUsed,
      attemptAssistant: erroredAssistant,
      currentAttemptAssistant: erroredAssistant,
      assistantErrorText: erroredAssistant.errorMessage,
      terminalState,
      setTerminalLifecycleMeta: vi.fn(),
      attemptCompactionCount: 0,
      activeErrorContext: { provider: PROVIDER, model: MODEL },
      resolveReplayInvalidForAttempt: () => true,
      canRestartForLiveSwitch: false,
    },
    runtimePlan: { auth: {} },
    sessionPromptState,
    failoverRetryController: controller,
    compactionRuntime: {
      ...disabledCompactionRuntime,
      assertRecoveryActive: () => {
        throw new Error("overflow compaction requested");
      },
    },
    contextRecoveryState: createEmbeddedRunContextRecoveryState(),
    usageAccumulator: createUsageAccumulator(),
    lastRunPromptUsage: undefined,
    runtimeAuthRetry: false,
    codexAppServerRecoveryRetryAvailable: false,
    codexAppServerRecoveryRetries: 0,
    lastRetryFailoverReason: null,
    traceAttempts: [],
    sessionAgentId: "main",
  } as never);
  const statusEvents = onAgentEvent.mock.calls
    .map(([event]) => event as { stream: string; data: Record<string, unknown> })
    .filter((event) => event.stream === "run_status");
  return {
    recovery,
    store,
    controller,
    used,
    current: () => current,
    advanceAuthProfile,
    markOwnedTranscriptRetry,
    continueFromCurrentTranscript,
    sessionPromptState,
    statusEvents,
    startedAt,
  };
}

function resetLabel(resetAt: number): string {
  return new Date(resetAt).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const rateLimitContext = {
  failoverProvider: PROVIDER,
  failoverModel: MODEL,
  logFallbackDecision: vi.fn(),
};

describe("rate-limited run switches subscription", () => {
  beforeEach(() => {
    vi.mocked(sleepWithAbort).mockClear();
  });

  it("switches a 30 h limit to the next free subscription instead of sleeping", async () => {
    const run = await recoverFromRateLimit({ candidates: ["anthropic:first", "anthropic:second"] });

    expect(sleepWithAbort).not.toHaveBeenCalled();
    expect(run.recovery).toMatchObject({ action: "retry" });
    expect(run.current()).toBe("anthropic:second");
    // The finished tool call stays in the transcript; the run continues from it rather
    // than resubmitting the original request.
    expect(run.markOwnedTranscriptRetry).toHaveBeenCalledTimes(1);
    expect(run.continueFromCurrentTranscript).toHaveBeenCalledTimes(1);
    expect(run.sessionPromptState.suppressNextUserMessagePersistence).toBe(false);
  });

  it("marks the limited subscription blocked until its reset", async () => {
    const run = await recoverFromRateLimit({ candidates: ["anthropic:first", "anthropic:second"] });

    const stats = run.store.usageStats?.["anthropic:first"];
    expect(stats?.blockedSource).toBe("provider_retry_after");
    expect(stats?.blockedReason).toBe("subscription_limit");
    expect(stats?.blockedUntil).toBeGreaterThanOrEqual(run.startedAt + THIRTY_HOURS_MS);
    expect(stats?.blockedUntil).toBeLessThan(Date.now() + THIRTY_HOURS_MS + 5_000);
    expect(run.store.usageStats?.["anthropic:second"]).toBeUndefined();
  });

  it("tells the thread which account hit its limit and where the run moved", async () => {
    const run = await recoverFromRateLimit({ candidates: ["anthropic:first", "anthropic:second"] });

    const blockedUntil = run.store.usageStats?.["anthropic:first"]?.blockedUntil ?? 0;
    expect(run.statusEvents).toHaveLength(1);
    expect(run.statusEvents[0]?.data).toMatchObject({
      phase: "account_switched",
      message: `Claude account 1 hit its limit until ${resetLabel(blockedUntil)}. Moved to Claude account 2.`,
      fromProfileId: "anthropic:first",
      toProfileId: "anthropic:second",
      limitedUntil: blockedUntil,
    });
    expect(String(run.statusEvents[0]?.data.message)).not.toContain("@");
  });

  it("steps over an API key to reach the next subscription", async () => {
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:key", "anthropic:second"],
    });

    expect(sleepWithAbort).not.toHaveBeenCalled();
    expect(run.current()).toBe("anthropic:second");
    expect(run.continueFromCurrentTranscript).toHaveBeenCalledTimes(1);
    expect(run.statusEvents[0]?.data.message).toMatch(/Moved to Claude account 2\.$/);
  });

  it("never lands on an API key and hands a replay-safe run to fallback without a delay cap", async () => {
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:key"],
      replaySafe: true,
      fallbackConfigured: true,
    });

    expect(sleepWithAbort).not.toHaveBeenCalled();
    expect(run.recovery).toEqual({ action: "proceed" });
    expect(run.continueFromCurrentTranscript).not.toHaveBeenCalled();
    // The assistant-failure rotation that follows escalates to the fallback model instead of
    // rotating to the API key.
    await expect(
      run.controller.advanceRateLimitAuthProfile(rateLimitContext),
    ).rejects.toBeInstanceOf(FailoverError);
    expect(run.advanceAuthProfile).not.toHaveBeenCalled();
    expect(run.used).toEqual(["anthropic:first"]);
  });

  it("waits on the limited account when it isn't replay-safe and names it with its reset", async () => {
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:key"],
      fallbackConfigured: true,
    });

    const slept = vi.mocked(sleepWithAbort).mock.calls.reduce((total, [ms]) => total + ms, 0);
    expect(slept).toBeGreaterThanOrEqual(THIRTY_HOURS_MS);
    expect(run.used).toEqual(["anthropic:first"]);
    expect(run.continueFromCurrentTranscript).toHaveBeenCalledTimes(1);
    const blockedUntil = run.store.usageStats?.["anthropic:first"]?.blockedUntil ?? 0;
    const limited = run.statusEvents.find((event) => event.data.phase === "account_limited");
    expect(limited?.data).toMatchObject({
      message: `Claude account 1 hit its limit until ${resetLabel(blockedUntil)}. No other subscription is free, so it waits until then.`,
      profileId: "anthropic:first",
      limitedUntil: blockedUntil,
      reason: "no_other_subscription",
    });
  });

  it("never switches a user-pinned subscription; it waits and says why", async () => {
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:second"],
      pinned: true,
    });

    expect(sleepWithAbort).toHaveBeenCalled();
    expect(run.advanceAuthProfile).not.toHaveBeenCalled();
    expect(run.used).toEqual(["anthropic:first"]);
    const limited = run.statusEvents.find((event) => event.data.phase === "account_limited");
    expect(limited?.data).toMatchObject({ reason: "pinned", profileId: "anthropic:first" });
    expect(String(limited?.data.message)).toContain("set to use only that account");
  });

  it("waits on a pinned account that hit its usage window and names its reset", async () => {
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:second"],
      pinned: true,
      errorMessage: USAGE_LIMIT_MESSAGE,
    });

    const slept = vi.mocked(sleepWithAbort).mock.calls.reduce((total, [ms]) => total + ms, 0);
    expect(slept).toBeGreaterThanOrEqual(USAGE_LIMIT_MS);
    expect(run.recovery).toMatchObject({ action: "retry" });
    expect(run.used).toEqual(["anthropic:first"]);
    expect(run.continueFromCurrentTranscript).toHaveBeenCalledTimes(1);
    const blockedUntil = run.store.usageStats?.["anthropic:first"]?.blockedUntil ?? 0;
    const limited = run.statusEvents.find((event) => event.data.phase === "account_limited");
    expect(limited?.data).toMatchObject({
      message: `Claude account 1 hit its limit until ${resetLabel(blockedUntil)}. This conversation is set to use only that account, so it waits until then.`,
      profileId: "anthropic:first",
      limitedUntil: blockedUntil,
      reason: "pinned",
    });
  });

  it("waits on the usage-window account when tools ran and no other subscription is free", async () => {
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:key"],
      fallbackConfigured: true,
      errorMessage: USAGE_LIMIT_MESSAGE,
    });

    const slept = vi.mocked(sleepWithAbort).mock.calls.reduce((total, [ms]) => total + ms, 0);
    expect(slept).toBeGreaterThanOrEqual(USAGE_LIMIT_MS);
    expect(run.recovery).toMatchObject({ action: "retry" });
    expect(run.used).toEqual(["anthropic:first"]);
    expect(run.continueFromCurrentTranscript).toHaveBeenCalledTimes(1);
    const limited = run.statusEvents.find((event) => event.data.phase === "account_limited");
    expect(limited?.data).toMatchObject({
      profileId: "anthropic:first",
      reason: "no_other_subscription",
    });
  });

  it("keeps a replay-safe pinned account waiting past a delay cap with fallback configured", async () => {
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:second"],
      pinned: true,
      replaySafe: true,
      fallbackConfigured: true,
      maxRetryDelayMs: 60_000,
      errorMessage: USAGE_LIMIT_MESSAGE,
    });

    const slept = vi.mocked(sleepWithAbort).mock.calls.reduce((total, [ms]) => total + ms, 0);
    expect(slept).toBeGreaterThanOrEqual(USAGE_LIMIT_MS);
    expect(run.recovery).toMatchObject({ action: "retry" });
    expect(run.advanceAuthProfile).not.toHaveBeenCalled();
    expect(run.used).toEqual(["anthropic:first"]);
    const limited = run.statusEvents.find((event) => event.data.phase === "account_limited");
    expect(limited?.data).toMatchObject({ reason: "pinned", profileId: "anthropic:first" });
  });

  it("keeps short waits on the same account", async () => {
    const shortWaitMs = RATE_LIMIT_ACCOUNT_SWITCH_AFTER_MS - 60_000;
    const run = await recoverFromRateLimit({
      candidates: ["anthropic:first", "anthropic:second"],
      retryAfterMs: shortWaitMs,
    });

    expect(sleepWithAbort).toHaveBeenCalledWith(shortWaitMs, undefined);
    expect(run.advanceAuthProfile).not.toHaveBeenCalled();
    expect(run.store.usageStats?.["anthropic:first"]).toBeUndefined();
    expect(run.statusEvents.map((event) => event.data.phase)).toEqual(["retrying"]);
  });
});

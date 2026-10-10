// A long rate limit switching subscriptions through the real embedded auth controller.
import type { Model } from "branch/plugin-sdk/llm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sleepWithAbort } from "../../../infra/backoff.js";
import type { AuthProfileStore } from "../../auth-profiles.js";
import type { ResolvedProviderAuth } from "../../model-auth.js";

const mocks = vi.hoisted(() => ({
  prepareProviderRuntimeAuth: vi.fn(),
  getApiKeyForModelCore: vi.fn(),
}));

vi.mock("../../../infra/backoff.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infra/backoff.js")>()),
  sleepWithAbort: vi.fn(async () => {}),
}));

vi.mock("../../../plugins/provider-runtime.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/provider-runtime.js")>()),
  prepareProviderRuntimeAuth: mocks.prepareProviderRuntimeAuth,
}));

vi.mock("../../model-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../model-auth.js")>()),
  getApiKeyForModelCore: mocks.getApiKeyForModelCore,
}));

// mock-isolation: keep the limited mark in memory; usage.blocked-retry-after.test.ts covers the write.
vi.mock("../../auth-profiles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../auth-profiles.js")>()),
  markAuthProfileBlockedUntil: vi.fn(
    async (params: { store: AuthProfileStore; profileId: string; blockedUntil: number }) => {
      params.store.usageStats ??= {};
      params.store.usageStats[params.profileId] = {
        ...params.store.usageStats[params.profileId],
        blockedUntil: params.blockedUntil,
        blockedReason: "subscription_limit",
        blockedSource: "provider_retry_after",
      };
    },
  ),
}));

import { createEmbeddedRunAuthController, type EmbeddedRunAuthState } from "./auth-controller.js";
import {
  createEmbeddedRunFailoverRetryController,
  type RateLimitAccountWait,
} from "./failover-retry-controller.js";

const PROVIDER = "anthropic";
const MODEL = "claude-fixture-1";
const USAGE_LIMIT_MESSAGE = "429 subscription usage limit. Retry after 108000 seconds.";
const USAGE_LIMIT_MS = 108_000 * 1000;
const ORDER = ["anthropic:first", "anthropic:key", "anthropic:second"];

function fixtureModel(): Model {
  return {
    id: MODEL,
    name: MODEL,
    provider: PROVIDER,
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.example",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_000,
  } as Model;
}

/** Credentials as the auth store resolves them; a signed-out profile resolves without a token. */
function resolvedAuth(profileId: string, secondSignedIn: boolean): ResolvedProviderAuth {
  switch (profileId) {
    case "anthropic:first":
      return { apiKey: "fixture-token-first", mode: "token", profileId, source: "profile" };
    case "anthropic:key":
      return { apiKey: "fixture-api-key", mode: "api-key", profileId, source: "profile" };
    default:
      return secondSignedIn
        ? { apiKey: "fixture-token-second", mode: "token", profileId, source: "profile" }
        : { mode: "token", profileId, source: "profile" };
  }
}

async function limitedRun(params: { secondSignedIn: boolean; replaySafe: boolean }) {
  const store = {
    version: 1,
    profiles: {
      "anthropic:first": { type: "token", provider: PROVIDER, token: "fixture-token-first" },
      "anthropic:key": { type: "api_key", provider: PROVIDER, key: "fixture-api-key" },
      "anthropic:second": { type: "token", provider: PROVIDER, token: "fixture-token-second" },
    },
  } as AuthProfileStore;
  mocks.getApiKeyForModelCore.mockImplementation(async ({ profileId }: { profileId: string }) =>
    resolvedAuth(profileId, params.secondSignedIn),
  );
  mocks.prepareProviderRuntimeAuth.mockResolvedValue(undefined);
  const setRuntimeApiKey = vi.fn<(provider: string, apiKey: string) => void>();
  const state: EmbeddedRunAuthState = {
    models: { runtime: fixtureModel(), effective: fixtureModel() },
    apiKeyInfo: null,
    lastProfileId: undefined,
    runtimeAuthState: null,
    runtimeAuthRefreshCancelled: false,
    profileIndex: 0,
    thinkLevel: "off",
  };
  const authController = createEmbeddedRunAuthController({
    config: undefined,
    agentDir: "/tmp/account-switch-auth",
    workspaceDir: "/tmp/account-switch-auth-workspace",
    authStore: store,
    authStorage: { setRuntimeApiKey },
    profileCandidates: ORDER,
    initialThinkLevel: "off",
    attemptedThinking: new Set(),
    fallbackConfigured: true,
    allowTransientCooldownProbe: false,
    provider: PROVIDER,
    modelId: MODEL,
    state,
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  });
  await authController.initializeAuthProfile();
  const controller = createEmbeddedRunFailoverRetryController({
    runParams: {
      runId: "run:account-switch-auth",
    } as Parameters<typeof createEmbeddedRunFailoverRetryController>[0]["runParams"],
    provider: PROVIDER,
    modelId: MODEL,
    globalLane: "test",
    agentDir: "/tmp/account-switch-auth",
    fallbackConfigured: true,
    profileFailureStore: store,
    getLastProfileId: () => state.lastProfileId,
    getSessionId: () => "session:account-switch-auth",
    harnessOwnsTransport: () => false,
    getRuntimeAuthOwnerId: () => "embedded",
    getApiKeyInfo: () => state.apiKeyInfo,
    advanceAuthProfile: authController.advanceAuthProfile,
  });
  const limits: RateLimitAccountWait[] = [];
  const switches: string[] = [];
  const retried = await controller.maybeRetryTransient({
    reason: "rate_limit",
    message: USAGE_LIMIT_MESSAGE,
    retryAfterMs: USAGE_LIMIT_MS,
    failoverEligible: params.replaySafe,
    profileCandidates: ORDER,
    onRetry: ({ limit }) => {
      if (limit) {
        limits.push(limit);
      }
    },
    onAccountSwitch: (change) => {
      switches.push(change.to.profileId);
    },
  });
  const runtimeKeys = setRuntimeApiKey.mock.calls.map(([, key]) => key);
  return { retried, state, limits, switches, runtimeKeys };
}

describe("rate-limit account switch with the embedded auth controller", () => {
  beforeEach(() => {
    vi.mocked(sleepWithAbort).mockClear();
    mocks.getApiKeyForModelCore.mockReset();
    mocks.prepareProviderRuntimeAuth.mockReset();
  });

  it("waits on the limited account when the next subscription can't sign in and tools ran", async () => {
    const run = await limitedRun({ secondSignedIn: false, replaySafe: false });

    expect(run.retried).toBe(true);
    const slept = vi.mocked(sleepWithAbort).mock.calls.reduce((total, [ms]) => total + ms, 0);
    expect(slept).toBeGreaterThanOrEqual(USAGE_LIMIT_MS);
    expect(run.limits).toEqual([
      expect.objectContaining({
        reason: "no_other_subscription",
        account: { profileId: "anthropic:first", label: "Claude account 1" },
      }),
    ]);
    expect(run.switches).toEqual([]);
    // The run still signs in as the limited account; the API key was never applied.
    expect(run.state.lastProfileId).toBe("anthropic:first");
    expect(run.state.apiKeyInfo?.profileId).toBe("anthropic:first");
    expect(run.runtimeKeys).not.toContain("fixture-api-key");
    expect(run.runtimeKeys.at(-1)).toBe("fixture-token-first");
  });

  it("hands a replay-safe run to fallback without applying the API key", async () => {
    const run = await limitedRun({ secondSignedIn: false, replaySafe: true });

    expect(run.retried).toBe(false);
    expect(sleepWithAbort).not.toHaveBeenCalled();
    expect(run.switches).toEqual([]);
    expect(run.state.lastProfileId).toBe("anthropic:first");
    expect(run.state.apiKeyInfo?.profileId).toBe("anthropic:first");
    expect(run.runtimeKeys).not.toContain("fixture-api-key");
    expect(run.runtimeKeys.at(-1)).toBe("fixture-token-first");
  });

  it("passes over the API key to the next subscription that signs in", async () => {
    const run = await limitedRun({ secondSignedIn: true, replaySafe: false });

    expect(run.retried).toBe(true);
    expect(sleepWithAbort).not.toHaveBeenCalled();
    expect(run.switches).toEqual(["anthropic:second"]);
    expect(run.state.lastProfileId).toBe("anthropic:second");
    expect(run.runtimeKeys).not.toContain("fixture-api-key");
    expect(run.runtimeKeys.at(-1)).toBe("fixture-token-second");
  });
});

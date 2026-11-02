// Covers provider usage summary loading across auth and plugin paths.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderResolveUsageAuthContext } from "../plugins/types.js";
import { AsyncWorkScope } from "../shared/async-work-scope.js";
import { createDeferredCore } from "../shared/deferred.js";
import { createProviderUsageFetch, makeResponse } from "../test-utils/provider-usage-fetch.js";
import {
  getProviderUsageAuthWithPluginMock,
  getProviderUsageSnapshotWithPluginMock,
  resetProviderUsageSnapshotWithPluginMock,
} from "./provider-usage-plugin-runtime.test-mocks.js";
import { overlayAccountLiveState } from "./provider-usage.account-state.js";
import { loadProviderUsageSummary } from "./provider-usage.load.js";
import { ignoredErrors } from "./provider-usage.shared.js";
import { loadUsageWithAuth, usageNow } from "./provider-usage.test-support.js";
import type { ProviderUsageSnapshot, UsageSummary } from "./provider-usage.types.js";

const resolveProviderUsageAuthWithPluginMock = getProviderUsageAuthWithPluginMock();
const resolveProviderUsageSnapshotWithPluginMock = getProviderUsageSnapshotWithPluginMock();

describe("provider-usage.load", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetProviderUsageSnapshotWithPluginMock();
  });
  afterEach(() => vi.useRealTimers());

  it("does not dispatch auth or fetch for an exhausted budget", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    resolveProviderUsageAuthWithPluginMock.mockResolvedValue({ token: "fixture-token" });
    const result = await loadProviderUsageSummary({
      providers: ["anthropic"],
      config: {},
      env: { ANTHROPIC_API_KEY: "fixture-token" },
      now: usageNow,
      timeoutMs: 0,
      fetch,
    });
    expect(result).toEqual({
      updatedAt: usageNow,
      providers: [{ provider: "anthropic", displayName: "Claude", windows: [], error: "Timeout" }],
    });
    expect(resolveProviderUsageAuthWithPluginMock).not.toHaveBeenCalled();
    expect(resolveProviderUsageSnapshotWithPluginMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["init", false],
    ["request", true],
  ] as const)(
    "cancels the usage fetch (%s signal, caller abort: %s)",
    async (signalSource, callerAbort) => {
      vi.useFakeTimers();
      const scope = new AsyncWorkScope();
      const started = createDeferredCore();
      const response = createDeferredCore<Response>();
      const caller = new AbortController();
      const aborted = vi.fn();
      let fetchSignal: AbortSignal | null | undefined;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        fetchSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        fetchSignal?.addEventListener(
          "abort",
          () => {
            aborted();
            response.reject(fetchSignal?.reason);
          },
          { once: true },
        );
        started.resolve();
        return response.promise;
      });
      resolveProviderUsageSnapshotWithPluginMock.mockImplementation(async ({ context }) => {
        await (signalSource === "init"
          ? context.fetchFn("https://usage.example.test", { signal: caller.signal })
          : context.fetchFn(new Request("https://usage.example.test", { signal: caller.signal })));
        return { provider: "anthropic", displayName: "Claude", windows: [] };
      });
      const pending = scope.track(() =>
        loadProviderUsageSummary({
          auth: [{ provider: "anthropic", token: "fixture-token" }],
          config: {},
          env: {},
          timeoutMs: 1,
          fetch,
        }),
      );
      try {
        await started.promise;
        if (callerAbort) {
          caller.abort(new Error("Caller cancelled"));
        }
        await vi.advanceTimersByTimeAsync(callerAbort ? 0 : 1);
        expect(fetchSignal?.aborted).toBe(true);
        expect(aborted).toHaveBeenCalledOnce();
        expect(caller.signal.aborted).toBe(callerAbort);
        expect((await pending).providers).toEqual([
          {
            provider: "anthropic",
            displayName: "Claude",
            windows: [],
            error: callerAbort ? "Caller cancelled" : "Timeout",
          },
        ]);
        await scope.drain();
        expect(scope.hasPendingWork).toBe(false);
      } finally {
        response.resolve(new Response("{}"));
        await pending;
        await scope.drain();
      }
    },
  );

  it.each(["candidates", "oauth"])(
    "rejects a retained %s auth helper after the usage deadline",
    async (helper) => {
      vi.useFakeTimers();
      const scope = new AsyncWorkScope();
      const captured = createDeferredCore<ProviderResolveUsageAuthContext>();
      const release = createDeferredCore();
      resolveProviderUsageAuthWithPluginMock.mockImplementation(async ({ context }) => {
        captured.resolve(context);
        await release.promise;
        return { handled: true };
      });
      const pending = scope.track(() =>
        loadProviderUsageSummary({
          providers: ["anthropic"],
          config: {},
          env: { ANTHROPIC_API_KEY: "fixture-token" },
          timeoutMs: 1,
        }),
      );
      try {
        const context = await captured.promise;
        await vi.advanceTimersByTimeAsync(1);
        expect((await pending).providers[0]?.error).toBe("Timeout");
        expect(context.signal?.aborted).toBe(true);
        await expect(
          Promise.resolve().then(async () => {
            if (helper === "candidates") {
              await context.resolveApiKeyCandidatesFromConfigAndStore?.();
            } else {
              await context.resolveOAuthToken();
            }
          }),
        ).rejects.toBe(context.signal?.reason);
        expect(resolveProviderUsageSnapshotWithPluginMock).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        await pending;
        await scope.drain();
      }
    },
  );

  it("returns unsupported provider snapshots for unknown provider ids", async () => {
    const mockFetch = createProviderUsageFetch(async () => makeResponse(404, "not found"));
    const summary = await loadUsageWithAuth(
      loadProviderUsageSummary,
      [{ provider: "unsupported-provider", token: "token-u" }],
      mockFetch,
    );
    expect(summary.providers).toHaveLength(1);
    expect(summary.providers[0]?.error).toBe("Unsupported provider");
  });

  it("filters errors that are marked as ignored", async () => {
    resolveProviderUsageSnapshotWithPluginMock.mockResolvedValueOnce({
      provider: "anthropic",
      displayName: "Claude",
      windows: [],
      error: "HTTP 500",
    });
    const mockFetch = createProviderUsageFetch(async () => {
      throw new Error("legacy fetch should not run");
    });
    ignoredErrors.add("HTTP 500");
    try {
      const summary = await loadUsageWithAuth(
        loadProviderUsageSummary,
        [{ provider: "anthropic", token: "token-a" }],
        mockFetch,
      );
      expect(summary.providers).toStrictEqual([]);
    } finally {
      ignoredErrors.delete("HTTP 500");
    }
  });

  it("keeps balance-only summary snapshots", async () => {
    resolveProviderUsageSnapshotWithPluginMock.mockResolvedValueOnce({
      provider: "deepseek",
      displayName: "DeepSeek",
      windows: [],
      summary: "Balance ¥42.50",
    });
    const mockFetch = createProviderUsageFetch(async () => {
      throw new Error("legacy fetch should not run");
    });

    const summary = await loadUsageWithAuth(
      loadProviderUsageSummary,
      [{ provider: "deepseek", token: "token-d" }],
      mockFetch,
    );

    expect(summary.providers).toEqual([
      {
        provider: "deepseek",
        displayName: "DeepSeek",
        windows: [],
        summary: "Balance ¥42.50",
      },
    ]);
  });

  it("returns live siblings at the deadline while retaining the unfinished provider", async () => {
    vi.useFakeTimers();
    const scope = new AsyncWorkScope();
    const heldSnapshot = createDeferredCore<ProviderUsageSnapshot>();
    const lateSnapshot: ProviderUsageSnapshot = {
      provider: "anthropic",
      displayName: "Claude",
      windows: [{ label: "5h", usedPercent: 20 }],
    };
    let summaryPromise: Promise<UsageSummary> | undefined;
    let draining: Promise<void> | undefined;
    try {
      resolveProviderUsageSnapshotWithPluginMock.mockImplementation(async ({ provider }) => {
        if (provider === "anthropic") {
          return await heldSnapshot.promise;
        }
        return {
          provider,
          displayName: "Codex",
          windows: [{ label: "3h", usedPercent: 12 }],
        };
      });
      summaryPromise = scope.track(() =>
        loadProviderUsageSummary({
          auth: [
            { provider: "anthropic", token: "token-a" },
            { provider: "openai", token: "token-codex" },
          ],
          config: {},
          env: {},
          timeoutMs: 5_000,
        }),
      );
      let settled = false;
      void summaryPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(5_000);
      const settledAtDeadline = settled;
      if (!settledAtDeadline) {
        await vi.advanceTimersByTimeAsync(1_000);
      }
      const summary = await summaryPromise;

      expect(settledAtDeadline).toBe(true);
      expect(summary.providers).toEqual([
        { provider: "anthropic", displayName: "Claude", windows: [], error: "Timeout" },
        {
          provider: "openai",
          displayName: "Codex",
          windows: [{ label: "3h", usedPercent: 12 }],
        },
      ]);
      let drained = false;
      draining = scope.drain().then(() => {
        drained = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(drained).toBe(false);
      heldSnapshot.resolve(lateSnapshot);
      await draining;
      expect(drained).toBe(true);
      expect(summary.providers[0]?.error).toBe("Timeout");
    } finally {
      heldSnapshot.resolve(lateSnapshot);
      await Promise.allSettled([
        summaryPromise,
        ...resolveProviderUsageSnapshotWithPluginMock.mock.results.map((result) => result.value),
      ]);
      await (draining ?? scope.drain());
      vi.useRealTimers();
    }
  });

  it("keeps successful provider usage when a sibling auth hook rejects", async () => {
    resolveProviderUsageAuthWithPluginMock.mockImplementation(async ({ provider }) => {
      if (provider === "anthropic") {
        throw new Error("auth failed");
      }
      return { token: `${provider}-token` };
    });
    resolveProviderUsageSnapshotWithPluginMock.mockImplementation(async ({ provider }) => ({
      provider,
      displayName: provider,
      windows: [{ label: "5h", usedPercent: 12 }],
    }));

    const summary = await loadProviderUsageSummary({
      providers: ["anthropic", "openai"],
      config: {},
      // Credential sources keep both providers past the plugin-auth gate so the
      // sibling-isolation behavior under test is actually exercised.
      env: { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-openai-test" },
    });

    expect(summary.providers).toEqual([
      { provider: "anthropic", displayName: "Claude", windows: [], error: "auth failed", signInNeeded: true },
      {
        provider: "openai",
        displayName: "openai",
        windows: [{ label: "5h", usedPercent: 12 }],
      },
    ]);
  });

  it("keeps mixed account states when the usage endpoint returns 429 for every account", async () => {
    const now = usageNow;
    const resetAt = now + 25 * 3_600_000;
    resolveProviderUsageSnapshotWithPluginMock.mockImplementation(async ({ context }) => ({
      provider: "anthropic",
      displayName: "Claude",
      windows: context.authProfileId === "anthropic:ready" ? [{ label: "5h", usedPercent: 20 }] : [],
      error: "HTTP 429: Rate limited. Please try again later.",
    }));
    const summary = await loadProviderUsageSummary({
      now,
      providers: ["anthropic"],
      auth: ["rejected-a", "rejected-b", "limited", "ready"].map((id) => ({
        provider: "anthropic" as const,
        token: `token-${id}`,
        authProfileId: `anthropic:${id}`,
      })),
      authStore: {
        version: 1,
        profiles: {},
        usageStats: {
          "anthropic:rejected-a": {
            disabledUntil: now + 60_000,
            disabledReason: "auth_permanent",
          },
          "anthropic:rejected-b": {
            disabledUntil: now + 60_000,
            disabledReason: "auth",
          },
          "anthropic:limited": {
            blockedUntil: resetAt,
            blockedReason: "subscription_limit",
            blockedSource: "provider_retry_after",
          },
        },
      },
      config: {},
      env: {},
    });
    expect(summary.providers).toHaveLength(4);
    expect(summary.providers[0]).toMatchObject({
      authProfileId: "anthropic:rejected-a",
      signInNeeded: true,
    });
    expect(summary.providers[1]).toMatchObject({
      authProfileId: "anthropic:rejected-b",
      signInNeeded: true,
    });
    expect(summary.providers[0]?.rateLimitedUntil).toBeUndefined();
    expect(summary.providers[0]?.ready).toBeUndefined();
    expect(summary.providers[1]?.rateLimitedUntil).toBeUndefined();
    expect(summary.providers[2]).toMatchObject({
      authProfileId: "anthropic:limited",
      rateLimitedUntil: resetAt,
    });
    expect(summary.providers[2]?.signInNeeded).toBeUndefined();
    expect(summary.providers[3]).toMatchObject({
      authProfileId: "anthropic:ready",
      ready: true,
      windows: [{ label: "5h", usedPercent: 20 }],
    });
    expect(summary.providers[3]?.rateLimitedUntil).toBeUndefined();
    expect(summary.providers.filter((row) => row.signInNeeded === true)).toHaveLength(2);
    expect(summary.providers.every((row) => row.error === "HTTP 429: Rate limited. Please try again later.")).toBe(
      true,
    );
  });

  it("throws when fetch is unavailable", async () => {
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", undefined);
    try {
      await expect(
        loadProviderUsageSummary({
          now: usageNow,
          auth: [{ provider: "xiaomi", token: "token-x" }],
          env: {},
          fetch: undefined,
        }),
      ).rejects.toThrow("fetch is not available");
    } finally {
      vi.stubGlobal("fetch", previousFetch);
    }
  });
});

const USAGE_429 = "HTTP 429: Rate limited. Please try again later.";
const RESET_AT = usageNow + 25 * 3_600_000;

function claudeAccount(
  id: string,
  extra: Partial<ProviderUsageSnapshot> = {},
): ProviderUsageSnapshot {
  return {
    provider: "anthropic",
    displayName: "Claude",
    authProfileId: `anthropic:${id}`,
    windows: [],
    error: USAGE_429,
    ...extra,
  };
}

describe("overlayAccountLiveState", () => {
  it("maps mixed accounts when the usage endpoint returns 429 for every row", () => {
    const summary: UsageSummary = {
      updatedAt: usageNow,
      providers: [
        claudeAccount("rejected-a"),
        claudeAccount("rejected-b"),
        claudeAccount("limited"),
        claudeAccount("ready", { windows: [{ label: "5h", usedPercent: 20 }] }),
      ],
    };
    const overlaid = overlayAccountLiveState(
      summary,
      {
        "anthropic:rejected-a": {
          disabledUntil: usageNow + 60_000,
          disabledReason: "auth_permanent",
        },
        "anthropic:rejected-b": {
          disabledUntil: usageNow + 60_000,
          disabledReason: "auth",
        },
        "anthropic:limited": {
          blockedUntil: RESET_AT,
          blockedReason: "subscription_limit",
          blockedSource: "provider_retry_after",
        },
      },
      usageNow,
    );
    expect(overlaid.providers.map((row) => ({
      id: row.authProfileId,
      signInNeeded: row.signInNeeded,
      rateLimitedUntil: row.rateLimitedUntil,
      ready: row.ready,
    }))).toEqual([
      { id: "anthropic:rejected-a", signInNeeded: true, rateLimitedUntil: undefined, ready: undefined },
      { id: "anthropic:rejected-b", signInNeeded: true, rateLimitedUntil: undefined, ready: undefined },
      { id: "anthropic:limited", signInNeeded: undefined, rateLimitedUntil: RESET_AT, ready: undefined },
      { id: "anthropic:ready", signInNeeded: undefined, rateLimitedUntil: undefined, ready: true },
    ]);
    expect(overlaid.providers.every((row) => row.error === USAGE_429)).toBe(true);
    expect(overlaid.providers.filter((row) => row.rateLimitedUntil === RESET_AT)).toHaveLength(1);
  });

  it("treats 401, 403 and invalid grant as sign-in, not as a shared rate limit", () => {
    const summary: UsageSummary = {
      updatedAt: usageNow,
      providers: [
        claudeAccount("one", { error: "HTTP 401: unauthorized" }),
        claudeAccount("two", { error: "HTTP 403: login rejected" }),
        claudeAccount("three", { error: "invalid_grant" }),
      ],
    };
    const overlaid = overlayAccountLiveState(summary, undefined, usageNow);
    expect(overlaid.providers.every((row) => row.signInNeeded === true)).toBe(true);
    expect(overlaid.providers.every((row) => row.ready !== true && row.rateLimitedUntil === undefined)).toBe(
      true,
    );
  });

  it("does not mark every account rate-limited when only the usage probe is 429", () => {
    const summary: UsageSummary = {
      updatedAt: usageNow,
      providers: [claudeAccount("a"), claudeAccount("b"), claudeAccount("c")],
    };
    const overlaid = overlayAccountLiveState(summary, {}, usageNow);
    expect(overlaid.providers.every((row) => row.ready === true)).toBe(true);
    expect(overlaid.providers.every((row) => row.rateLimitedUntil === undefined)).toBe(true);
    expect(overlaid.providers.every((row) => row.signInNeeded !== true)).toBe(true);
  });
});


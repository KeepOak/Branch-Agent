import path from "node:path";
import type { EmbeddedRunAttemptParamsV2 } from "branch/plugin-sdk/agent-harness-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeAccountBindingStore, runWithCodexNativeAccount } from "./native-account-attempt.js";
import { sessionBindingIdentity } from "./session-binding.js";
import { createCodexTestBindingStore } from "./session-binding.test-helpers.js";

const { probe, request } = vi.hoisted(() => ({ probe: vi.fn(), request: vi.fn() }));
vi.mock("./native-auth.js", () => ({ probeCodexNativeAuth: probe }));
vi.mock("./request.js", () => ({ requestCodexAppServerJson: request }));
const one = path.resolve("fixture-account-one");
const two = path.resolve("fixture-account-two");
const pluginConfig = {
  appServer: {
    homeScope: "user",
    nativeAccounts: [
      { id: "one", home: one },
      { id: "two", home: two },
    ],
    nativeAccountId: "one",
    nativeAccountQuotaFailover: true,
  },
};
const params = {
  agentId: "main",
  sessionId: "fixture-session",
  timeoutMs: 1_000,
  hostCapabilities: { assertActive: vi.fn() },
} as unknown as EmbeddedRunAttemptParamsV2;

describe("native account attempt integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probe.mockResolvedValue({ nativeAuth: { runtime: "codex", mode: "oauth" } });
    request.mockResolvedValue({ rateLimits: { limitId: "codex", primary: { usedPercent: 10 } } });
  });
  it("uses read-only isolated native auth to skip quota, persists home, then resumes that owner", async () => {
    const bindingStore = createCodexTestBindingStore();
    request.mockResolvedValueOnce({
      rateLimits: { limitId: "codex", primary: { usedPercent: 100 } },
    });
    const run = vi.fn(async (options) => {
      await options.bindingStore.mutate(sessionBindingIdentity(params), {
        kind: "set",
        binding: { threadId: "thread", cwd: "fixture" },
      });
      return "answer";
    });
    expect(await runWithCodexNativeAccount(params, { pluginConfig, bindingStore }, run)).toBe(
      "answer",
    );
    expect(run.mock.calls[0]?.[0].pluginConfig.appServer.codexHome).toBe(two);
    expect(request.mock.calls.map(([options]) => options.startOptions.codexHome)).toEqual([
      one,
      two,
    ]);
    for (const [options] of request.mock.calls) {
      expect(options).toMatchObject({
        method: "account/rateLimits/read",
        isolated: true,
        authProfileId: null,
      });
      expect(options.startOptions.clearEnv).toEqual(
        expect.arrayContaining(["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]),
      );
    }
    expect(bindingStore.read(sessionBindingIdentity(params))?.nativeAccountHome).toBe(two);
    request.mockClear();
    probe.mockClear();
    await runWithCodexNativeAccount(
      params,
      { pluginConfig, bindingStore },
      vi.fn().mockResolvedValue("resumed"),
    );
    expect(request).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
  it("retains home on binding patch and replacement", async () => {
    const store = createCodexTestBindingStore();
    const owned = nativeAccountBindingStore(store, two);
    const identity = sessionBindingIdentity(params);
    await owned.mutate(identity, { kind: "set", binding: { threadId: "first", cwd: "fixture" } });
    await owned.mutate(identity, {
      kind: "patch",
      threadId: "first",
      patch: { model: "fixture-model" },
    });
    expect(store.read(identity)?.nativeAccountHome).toBe(two);
    await owned.mutate(identity, {
      kind: "replace-thread",
      expectedThreadId: "first",
      binding: { threadId: "second", cwd: "fixture" },
    });
    expect(store.read(identity)?.nativeAccountHome).toBe(two);
  });
  it("refuses a thread acquired concurrently by another account", async () => {
    const store = createCodexTestBindingStore();
    const identity = sessionBindingIdentity(params);
    await store.mutate(identity, {
      kind: "set",
      binding: { threadId: "concurrent", cwd: "fixture", nativeAccountHome: one },
    });
    const owned = nativeAccountBindingStore(store, two);
    expect(() => owned.read(identity)).toThrow("ownership changed");
    await expect(
      owned.mutate(identity, {
        kind: "patch",
        threadId: "concurrent",
        patch: { model: "fixture" },
      }),
    ).rejects.toThrow("ownership changed");
    expect(store.read(identity)?.nativeAccountHome).toBe(one);
  });
  it.each([
    { authProfileId: "openai:explicit" },
    { sandbox: { enabled: true } },
    { expectedSessionRuntimeOwnership: { model: "native", auth: "native" } },
  ])("does not replace another authentication authority: %j", async (patch) => {
    const run = vi.fn();
    await expect(
      runWithCodexNativeAccount(
        { ...params, ...patch } as EmbeddedRunAttemptParamsV2,
        { pluginConfig, bindingStore: createCodexTestBindingStore() },
        run,
      ),
    ).rejects.toThrow("authority");
    expect(run).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });
  it("does not rotate accounts on an inspection transport failure", async () => {
    const run = vi.fn();
    request.mockRejectedValueOnce(new Error("transport failed"));
    await expect(
      runWithCodexNativeAccount(
        params,
        { pluginConfig, bindingStore: createCodexTestBindingStore() },
        run,
      ),
    ).rejects.toThrow("transport failed");
    expect(request).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects an API-key native login instead of entering a billed turn or rotating accounts", async () => {
    probe.mockResolvedValueOnce({ nativeAuth: { runtime: "codex", mode: "api-key" } });
    const run = vi.fn();
    await expect(
      runWithCodexNativeAccount(
        params,
        { pluginConfig, bindingStore: createCodexTestBindingStore() },
        run,
      ),
    ).rejects.toThrow("not authenticated");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

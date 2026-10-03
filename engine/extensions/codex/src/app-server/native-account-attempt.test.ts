import path from "node:path";
import type { EmbeddedRunAttemptParamsV2 } from "branch/plugin-sdk/agent-harness-runtime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCodexAppServerAgentHarness,
  createCodexAppServerNativeCompaction,
} from "../../harness.js";
import {
  nativeAccountBindingStore,
  projectBoundCodexNativeAccount,
  runWithCodexNativeAccount,
} from "./native-account-attempt.js";
import type { CodexRunAttemptOptions } from "./run-attempt-types.js";
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
});

const ownershipParams = {
  agentId: "main",
  sessionId: "ownership-fixture",
  timeoutMs: 1_000,
  hostCapabilities: {
    kind: "agent-harness-host-capability",
    version: 1,
    assertActive: vi.fn(),
    retainSourceAuthority: vi.fn(),
  },
} as unknown as EmbeddedRunAttemptParamsV2;

async function bound(home?: string) {
  const bindingStore = createCodexTestBindingStore();
  await bindingStore.mutate(sessionBindingIdentity(ownershipParams), {
    kind: "set",
    binding: {
      threadId: "saved-thread",
      cwd: "fixture",
      ...(home ? { nativeAccountHome: home } : {}),
    },
  });
  return bindingStore;
}

describe("native account persisted-owner admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probe.mockResolvedValue({ nativeAuth: { runtime: "codex", mode: "oauth" } });
    request.mockResolvedValue({ rateLimits: { limitId: "codex", primary: { usedPercent: 10 } } });
  });

  it("rejects an owned normal turn after the registry disappears before auth or transport", async () => {
    const bindingStore = await bound(two);
    const before = bindingStore.read(sessionBindingIdentity(ownershipParams));
    const run = vi.fn();
    await expect(
      runWithCodexNativeAccount(ownershipParams, { pluginConfig: {}, bindingStore }, run),
    ).rejects.toThrow("owner is no longer registered");
    expect(run).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(bindingStore.read(sessionBindingIdentity(ownershipParams))).toEqual(before);
  });

  it("rejects a removed owned home even when another account remains selected", async () => {
    const bindingStore = await bound(two);
    const run = vi.fn();
    const removedConfig = {
      appServer: { ...pluginConfig.appServer, nativeAccounts: [{ id: "one", home: one }] },
    };
    await expect(
      runWithCodexNativeAccount(
        ownershipParams,
        { pluginConfig: removedConfig, bindingStore },
        run,
      ),
    ).rejects.toThrow("explicit migration required");
    expect(run).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("requires explicit migration for a normal existing ownerless thread", async () => {
    const bindingStore = await bound();
    const run = vi.fn();
    await expect(
      runWithCodexNativeAccount(ownershipParams, { pluginConfig, bindingStore }, run),
    ).rejects.toThrow("explicit migration required");
    expect(run).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("resumes the persisted owner instead of the selected account and preserves caller options", async () => {
    const bindingStore = await bound(two);
    const clientFactory = vi.fn();
    const run = vi.fn(async (options: CodexRunAttemptOptions) => {
      expect(options.clientFactory).toBe(clientFactory);
      expect(options.pluginConfig).toMatchObject({ appServer: { codexHome: two } });
      expect(
        options.bindingStore.read(sessionBindingIdentity(ownershipParams))?.nativeAccountHome,
      ).toBe(two);
      return "resumed";
    });
    await expect(
      runWithCodexNativeAccount(
        ownershipParams,
        { pluginConfig, bindingStore, clientFactory },
        run,
      ),
    ).resolves.toBe("resumed");
    expect(probe).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves the normal unregistered path with legacy binding=%s",
    async (legacy) => {
      const options = {
        pluginConfig: {},
        bindingStore: legacy ? await bound() : createCodexTestBindingStore(),
      };
      const run = vi.fn(async (actual) => {
        expect(actual).toBe(options);
        return "legacy";
      });
      await expect(runWithCodexNativeAccount(ownershipParams, options, run)).resolves.toBe(
        "legacy",
      );
      expect(probe).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("distinguishes an absent binding from an existing ownerless thread in projection", async () => {
    expect(projectBoundCodexNativeAccount(pluginConfig, undefined)).toBe(pluginConfig);
    const bindingStore = await bound();
    expect(() =>
      projectBoundCodexNativeAccount(
        pluginConfig,
        bindingStore.read(sessionBindingIdentity(ownershipParams)),
      ),
    ).toThrow("explicit migration required");
  });

  it("projects the saved owner and retains explicit transport options", async () => {
    const bindingStore = await bound(two);
    const config = {
      appServer: {
        ...pluginConfig.appServer,
        command: "fixture-native",
        args: ["app-server", "--stdio"],
      },
    };
    expect(
      projectBoundCodexNativeAccount(
        config,
        bindingStore.read(sessionBindingIdentity(ownershipParams)),
      ),
    ).toMatchObject({
      appServer: { codexHome: two, command: "fixture-native", args: ["app-server", "--stdio"] },
    });
  });

  for (const entry of ["side-question", "manual-compaction", "native-compaction"] as const) {
    it.each([
      {
        name: "ownerless legacy thread",
        pluginConfig,
        home: undefined,
        error: "explicit migration required",
      },
      {
        name: "removed registry",
        pluginConfig: {},
        home: two,
        error: "owner is no longer registered",
      },
      {
        name: "removed account",
        pluginConfig: {
          appServer: { ...pluginConfig.appServer, nativeAccounts: [{ id: "one", home: one }] },
        },
        home: two,
        error: "owner is no longer registered",
      },
    ])(
      `${entry} rejects $name through the actual harness callback`,
      async ({ pluginConfig, home, error }) => {
        const bindingStore = await bound(home);
        const before = bindingStore.read(sessionBindingIdentity(ownershipParams));
        const harness = createCodexAppServerAgentHarness({ pluginConfig, bindingStore });
        // A missing guard must stop at the next host boundary, never native I/O.
        const assertActive = vi.fn<() => void>(() => {
          throw new Error("Ownership fixture reached downstream work before rejection");
        });
        if (entry !== "side-question") assertActive.mockImplementationOnce(() => undefined);
        const entryParams = {
          ...ownershipParams,
          hostCapabilities: { ...ownershipParams.hostCapabilities, assertActive },
        };
        const compactParams = {
          ...entryParams,
          trigger: "manual",
          nativeCompactionRequest: "required_preflight",
        };
        const operation =
          entry === "side-question"
            ? harness.runSideQuestion!(
                ownershipParams as unknown as Parameters<
                  NonNullable<typeof harness.runSideQuestion>
                >[0],
              )
            : entry === "manual-compaction"
              ? harness.compact!(
                  compactParams as unknown as Parameters<NonNullable<typeof harness.compact>>[0],
                )
              : createCodexAppServerNativeCompaction({ pluginConfig, bindingStore })(
                  compactParams as unknown as Parameters<
                    ReturnType<typeof createCodexAppServerNativeCompaction>
                  >[0],
                );
        await expect(operation).rejects.toThrow(error);
        expect(bindingStore.read(sessionBindingIdentity(ownershipParams))).toEqual(before);
        expect(probe).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
      },
    );
  }
});

import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import {
  copyLegacyClaudeProfile,
  migrateLegacyClaudeConfig,
} from "./anthropic-manual-migration-core.js";
import { migrateLegacyClaudeProfilesAtStartup } from "./anthropic-manual-migration.js";
import { normalizeRawCredentialEntry } from "./persisted-credential.js";
import type { AuthProfileStore } from "./types.js";

const mocks = vi.hoisted(() => ({
  stores: new Map<string, AuthProfileStore>(),
  writeConfig: vi.fn(),
}));
vi.mock("./candidate-stores.js", () => ({
  listCandidateAuthProfileStores: async () =>
    [...mocks.stores.keys()].map((agentId) => ({ agentId, databasePath: `missing-${agentId}.db` })),
  loadCandidateAuthProfileStore: (candidate: { agentId: string }) =>
    mocks.stores.get(candidate.agentId),
  updateCandidateAuthProfileStore: ({
    candidate,
    updater,
  }: {
    candidate: { agentId: string };
    updater: (store: AuthProfileStore) => boolean;
  }) => {
    const store = mocks.stores.get(candidate.agentId)!;
    return { changed: updater(store), store };
  },
}));
vi.mock("../../config/io.js", () => ({ writeConfigFile: mocks.writeConfig }));

describe("legacy Claude account migration", () => {
  it("copies the credential and rewrites global and Trunk orders without losing usage", () => {
    const legacy = "anthropic:manual";
    const next = "anthropic:owner@example.test";
    const extra = Array.from({ length: 11 }, (_, index) => `anthropic:other-${index}`);
    const store: AuthProfileStore = {
      version: 1,
      profiles: { [legacy]: { type: "token", provider: "anthropic", token: "fake-token" } },
      order: { anthropic: [legacy, ...extra] },
      lastGood: { anthropic: legacy },
      usageStats: { [legacy]: { lastUsed: 42 } },
    };
    const cfg: BranchConfig = {
      auth: {
        profiles: { [legacy]: { provider: "anthropic", mode: "token" } },
        order: { anthropic: [legacy, ...extra] },
      },
    };
    expect(copyLegacyClaudeProfile(store, next, "owner@example.test")).toBe(true);
    expect(store.profiles[legacy]).toBeDefined();
    expect(store.profiles[next]).toMatchObject({
      token: "fake-token",
      email: "owner@example.test",
    });
    expect(store.order?.anthropic).toEqual([next, ...extra]);
    expect(store.order?.anthropic).toHaveLength(12);
    expect(store.lastGood?.anthropic).toBe(next);
    expect(store.usageStats?.[next]?.lastUsed).toBe(42);
    const migrated = migrateLegacyClaudeConfig(cfg, next, "owner@example.test");
    expect(migrated.auth?.profiles?.[legacy]).toBeUndefined();
    expect(migrated.auth?.profiles?.[next]?.email).toBe("owner@example.test");
    expect(migrated.auth?.order?.anthropic).toEqual([next, ...extra]);
    expect(copyLegacyClaudeProfile(store, next, "owner@example.test")).toBe(false);
    expect(migrateLegacyClaudeConfig(migrated, next, "owner@example.test")).toEqual(migrated);
  });

  it("rewrites a Trunk's local order without adding a credential it does not own", () => {
    const store: AuthProfileStore = {
      version: 1,
      profiles: {},
      order: { anthropic: ["anthropic:manual", "anthropic:work"] },
    };
    expect(
      copyLegacyClaudeProfile(store, "anthropic:owner@example.test", "owner@example.test"),
    ).toBe(true);
    expect(store.profiles).toEqual({});
    expect(store.order?.anthropic).toEqual(["anthropic:owner@example.test", "anthropic:work"]);
  });

  it("migrates two Trunks with distinct legacy tokens under their own identities", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const tokenA = "sk-ant-oat01-" + "a".repeat(80);
    const tokenB = "sk-ant-oat01-" + "b".repeat(80);
    for (const [agentId, token] of [
      ["a", tokenA],
      ["b", tokenB],
    ]) {
      mocks.stores.set(agentId, {
        version: 1,
        profiles: { "anthropic:manual": { type: "token", provider: "anthropic", token } },
        order: { anthropic: ["anthropic:manual"] },
      });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, options: { headers: { Authorization: string } }) =>
          new Response(
            JSON.stringify({
              account: {
                email: options.headers.Authorization.includes(tokenA)
                  ? "a@example.test"
                  : "b@example.test",
              },
            }),
            { status: 200 },
          ),
      ),
    );
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(true);
      expect(mocks.stores.get("a")?.profiles["anthropic:a@example.test"]).toMatchObject({
        token: tokenA,
      });
      expect(mocks.stores.get("b")?.profiles["anthropic:b@example.test"]).toMatchObject({
        token: tokenB,
      });
      expect(mocks.stores.get("a")?.profiles["anthropic:manual"]).toBeUndefined();
      expect(mocks.stores.get("b")?.profiles["anthropic:manual"]).toBeUndefined();
      expect(mocks.stores.get("b")?.order?.anthropic).toEqual(["anthropic:b@example.test"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("migrates a token without an email to its stable hash fallback", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const token = "sk-ant-oat01-" + "c".repeat(80);
    mocks.stores.set("c", {
      version: 1,
      profiles: { "anthropic:manual": { type: "token", provider: "anthropic", token } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    try {
      expect(
        await migrateLegacyClaudeProfilesAtStartup({
          auth: { profiles: { "anthropic:manual": { provider: "anthropic", mode: "token" } } },
        }),
      ).toBe(true);
      const ids = Object.keys(mocks.stores.get("c")!.profiles);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toMatch(/^anthropic:id-[a-f0-9]{12}$/);
      expect(mocks.stores.get("c")?.profiles[ids[0]]).toMatchObject({ token });
      expect(mocks.stores.get("c")?.profiles[ids[0]]).not.toHaveProperty("email");
      expect(mocks.writeConfig).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("migrates on 429, honors Retry-After across starts, then promotes the ID to email once", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const token = "sk-ant-oat01-" + "d".repeat(80);
    const originalConfig: BranchConfig = {
      auth: {
        profiles: { "anthropic:manual": { provider: "anthropic", mode: "token" } },
        order: { anthropic: ["anthropic:manual"] },
      },
    };
    mocks.stores.set("d", {
      version: 1,
      profiles: { "anthropic:manual": { type: "token", provider: "anthropic", token } },
      order: { anthropic: ["anthropic:manual"] },
      lastGood: { anthropic: "anthropic:manual" },
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "3600" } }),
      )
      .mockResolvedValue(
        new Response(JSON.stringify({ account: { email: "Owner@Example.test" } }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup(originalConfig)).toBe(true);
      const store = mocks.stores.get("d")!;
      const [hashId] = Object.keys(store.profiles);
      expect(hashId).toMatch(/^anthropic:id-[a-f0-9]{12}$/);
      expect(store.profiles["anthropic:manual"]).toBeUndefined();
      expect(store.profiles[hashId]).toMatchObject({ token, identityLookupRetryAt: 4_600_000 });
      expect(
        normalizeRawCredentialEntry(store.profiles[hashId] as unknown as Record<string, unknown>),
      ).toMatchObject({ identityLookupRetryAt: 4_600_000, identityLookupFailures: 1 });
      expect(store.order?.anthropic).toEqual([hashId]);
      const hashConfig = mocks.writeConfig.mock.calls[0][0] as BranchConfig;
      expect(await migrateLegacyClaudeProfilesAtStartup(hashConfig)).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      now.mockReturnValue(4_600_001);
      expect(await migrateLegacyClaudeProfilesAtStartup(hashConfig)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(store.profiles[hashId]).toBeUndefined();
      expect(store.profiles["anthropic:owner@example.test"]).toMatchObject({
        token,
        email: "owner@example.test",
      });
      expect(store.order?.anthropic).toEqual(["anthropic:owner@example.test"]);
      expect(store.lastGood?.anthropic).toBe("anthropic:owner@example.test");
      const emailConfig = mocks.writeConfig.mock.calls[1][0] as BranchConfig;
      expect(emailConfig.auth?.order?.anthropic).toEqual(["anthropic:owner@example.test"]);
      expect(await migrateLegacyClaudeProfilesAtStartup(emailConfig)).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("backs off after network failures instead of looking up on each start", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const token = "sk-ant-oat01-" + "e".repeat(80);
    mocks.stores.set("e", {
      version: 1,
      profiles: { "anthropic:manual": { type: "token", provider: "anthropic", token } },
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn().mockRejectedValue(new Error("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(true);
      const store = mocks.stores.get("e")!;
      const [hashId] = Object.keys(store.profiles);
      expect(store.profiles[hashId]).toMatchObject({ identityLookupRetryAt: 1_300_000 });
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      now.mockReturnValue(1_300_001);
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(store.profiles[hashId]).toMatchObject({
        identityLookupFailures: 2,
        identityLookupRetryAt: 1_900_001,
      });
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("migrates a reference-only manual credential without persisting its resolved token", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const token = "sk-ant-oat01-" + "f".repeat(80);
    const ref = { source: "env" as const, provider: "default", id: "CLAUDE_MIGRATION_TEST_TOKEN" };
    vi.stubEnv(ref.id, token);
    mocks.stores.set("owner", {
      version: 1,
      profiles: { "anthropic:manual": { type: "token", provider: "anthropic", tokenRef: ref } },
      order: { anthropic: ["anthropic:manual"] },
    });
    const fetchMock = vi.fn(async () => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(true);
      const store = mocks.stores.get("owner")!;
      const [hashId] = Object.keys(store.profiles);
      expect(hashId).toMatch(/^anthropic:id-[a-f0-9]{12}$/);
      expect(store.profiles[hashId]).toMatchObject({ tokenRef: ref });
      expect(store.profiles[hashId]).not.toHaveProperty("token");
      expect(store.order?.anthropic).toEqual([hashId]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("migrates an owner-shaped API-key setup token and retains its cooldown across starts", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const key = "sk-ant-oat01-" + "j".repeat(95);
    const originalConfig: BranchConfig = {
      auth: {
        profiles: { "anthropic:manual": { provider: "anthropic", mode: "api_key" } },
        order: { anthropic: ["anthropic:manual"] },
      },
    };
    mocks.stores.set("owner", {
      version: 1,
      profiles: { "anthropic:manual": { type: "api_key", provider: "anthropic", key } },
      order: { anthropic: ["anthropic:manual"] },
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "3600" } }))
      .mockResolvedValue(new Response(JSON.stringify({ account: { email: "owner@example.test" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup(originalConfig)).toBe(true);
      const store = mocks.stores.get("owner")!;
      const [hashId] = Object.keys(store.profiles);
      expect(hashId).toMatch(/^anthropic:id-[a-f0-9]{12}$/);
      expect(store.profiles[hashId]).toMatchObject({ type: "api_key", key, identityLookupRetryAt: 4_600_000 });
      expect(normalizeRawCredentialEntry(store.profiles[hashId] as unknown as Record<string, unknown>))
        .toMatchObject({ type: "api_key", key, identityLookupRetryAt: 4_600_000, identityLookupFailures: 1 });
      const hashConfig = mocks.writeConfig.mock.calls[0][0] as BranchConfig;
      expect(hashConfig.auth?.profiles?.[hashId]?.mode).toBe("api_key");
      expect(await migrateLegacyClaudeProfilesAtStartup(hashConfig)).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      now.mockReturnValue(4_600_001);
      expect(await migrateLegacyClaudeProfilesAtStartup(hashConfig)).toBe(true);
      expect(store.profiles[hashId]).toBeUndefined();
      expect(store.profiles["anthropic:owner@example.test"]).toMatchObject({ type: "api_key", key });
      expect(store.order?.anthropic).toEqual(["anthropic:owner@example.test"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("leaves an ordinary Anthropic API key in its manual slot", async () => {
    mocks.stores.clear();
    mocks.stores.set("owner", {
      version: 1,
      profiles: { "anthropic:manual": { type: "api_key", provider: "anthropic", key: "sk-ant-api03-fixture" } },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rewrites reference-only Trunks when promoting a hash to email", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const oldId = "anthropic:id-abcdef123456";
    const nextId = "anthropic:owner@example.test";
    const token = "sk-ant-oat01-" + "g".repeat(80);
    mocks.stores.set("owner", {
      version: 1,
      profiles: { [oldId]: { type: "token", provider: "anthropic", token } },
    });
    mocks.stores.set("trunk", {
      version: 1,
      profiles: {},
      order: { anthropic: [oldId] },
      lastGood: { anthropic: oldId },
      usageStats: { [oldId]: { lastUsed: 42 } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ account: { email: "owner@example.test" } }), { status: 200 }),
      ),
    );
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(true);
      const trunk = mocks.stores.get("trunk")!;
      expect(trunk.profiles).toEqual({});
      expect(trunk.order?.anthropic).toEqual([nextId]);
      expect(trunk.lastGood?.anthropic).toBe(nextId);
      expect(trunk.usageStats?.[nextId]?.lastUsed).toBe(42);
      expect(trunk.usageStats?.[oldId]).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("backs off a hash lookup when the email slot holds a different token", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const oldId = "anthropic:id-abcdef123456";
    const nextId = "anthropic:owner@example.test";
    mocks.stores.set("owner", {
      version: 1,
      profiles: {
        [oldId]: { type: "token", provider: "anthropic", token: "token-one" },
        [nextId]: { type: "token", provider: "anthropic", token: "token-two" },
      },
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ account: { email: "owner@example.test" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(false);
      expect(mocks.stores.get("owner")?.profiles[oldId]).toMatchObject({
        identityLookupFailures: 1,
        identityLookupRetryAt: 1_300_000,
      });
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("keeps an occupied email slot and moves a different manual token to its own hash", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const token = "sk-ant-oat01-" + "h".repeat(80);
    const emailId = "anthropic:owner@example.test";
    mocks.stores.set("owner", {
      version: 1,
      profiles: {
        "anthropic:manual": { type: "token", provider: "anthropic", token },
        [emailId]: { type: "token", provider: "anthropic", token: "different-token" },
      },
      order: { anthropic: ["anthropic:manual", emailId] },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ account: { email: "owner@example.test" } }), { status: 200 }),
      ),
    );
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(true);
      const store = mocks.stores.get("owner")!;
      const hashId = Object.keys(store.profiles).find((id) => id.startsWith("anthropic:id-"))!;
      expect(store.profiles[emailId]).toMatchObject({ token: "different-token" });
      expect(store.profiles[hashId]).toMatchObject({ token, email: "owner@example.test" });
      expect(store.profiles["anthropic:manual"]).toBeUndefined();
      expect(store.order?.anthropic).toEqual([hashId, emailId]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

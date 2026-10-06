import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { migrateLegacyClaudeProfilesAtStartup } from "./anthropic-manual-migration.js";
import { copyLegacyClaudeProfile, migrateLegacyClaudeConfig } from "./anthropic-manual-migration-core.js";
import type { AuthProfileStore } from "./types.js";

const mocks = vi.hoisted(() => ({ stores: new Map<string, AuthProfileStore>(), writeConfig: vi.fn() }));
vi.mock("./candidate-stores.js", () => ({
  listCandidateAuthProfileStores: async () => [...mocks.stores.keys()].map((agentId) => ({ agentId, databasePath: `missing-${agentId}.db` })),
  loadCandidateAuthProfileStore: (candidate: { agentId: string }) => mocks.stores.get(candidate.agentId),
  updateCandidateAuthProfileStore: ({ candidate, updater }: { candidate: { agentId: string }; updater: (store: AuthProfileStore) => boolean }) => {
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
    const cfg: BranchConfig = { auth: { profiles: { [legacy]: { provider: "anthropic", mode: "token" } }, order: { anthropic: [legacy, ...extra] } } };
    expect(copyLegacyClaudeProfile(store, next, "owner@example.test")).toBe(true);
    expect(store.profiles[legacy]).toBeDefined();
    expect(store.profiles[next]).toMatchObject({ token: "fake-token", email: "owner@example.test" });
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
    const store: AuthProfileStore = { version: 1, profiles: {}, order: { anthropic: ["anthropic:manual", "anthropic:work"] } };
    expect(copyLegacyClaudeProfile(store, "anthropic:owner@example.test", "owner@example.test")).toBe(true);
    expect(store.profiles).toEqual({});
    expect(store.order?.anthropic).toEqual(["anthropic:owner@example.test", "anthropic:work"]);
  });

  it("migrates two Trunks with distinct legacy tokens under their own identities", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const tokenA = "sk-ant-oat01-" + "a".repeat(80);
    const tokenB = "sk-ant-oat01-" + "b".repeat(80);
    for (const [agentId, token] of [["a", tokenA], ["b", tokenB]]) {
      mocks.stores.set(agentId, { version: 1, profiles: { "anthropic:manual": { type: "token", provider: "anthropic", token } }, order: { anthropic: ["anthropic:manual"] } });
    }
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: { headers: { Authorization: string } }) =>
      new Response(JSON.stringify({ account: { email: options.headers.Authorization.includes(tokenA) ? "a@example.test" : "b@example.test" } }), { status: 200 })));
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({})).toBe(true);
      expect(mocks.stores.get("a")?.profiles["anthropic:a@example.test"]).toMatchObject({ token: tokenA });
      expect(mocks.stores.get("b")?.profiles["anthropic:b@example.test"]).toMatchObject({ token: tokenB });
      expect(mocks.stores.get("a")?.profiles["anthropic:manual"]).toBeUndefined();
      expect(mocks.stores.get("b")?.profiles["anthropic:manual"]).toBeUndefined();
      expect(mocks.stores.get("b")?.order?.anthropic).toEqual(["anthropic:b@example.test"]);
    } finally { vi.unstubAllGlobals(); }
  });

  it("migrates a token without an email to its stable hash fallback", async () => {
    mocks.stores.clear();
    mocks.writeConfig.mockClear();
    const token = "sk-ant-oat01-" + "c".repeat(80);
    mocks.stores.set("c", { version: 1, profiles: { "anthropic:manual": { type: "token", provider: "anthropic", token } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    try {
      expect(await migrateLegacyClaudeProfilesAtStartup({ auth: { profiles: { "anthropic:manual": { provider: "anthropic", mode: "token" } } } })).toBe(true);
      const ids = Object.keys(mocks.stores.get("c")!.profiles);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toMatch(/^anthropic:id-[a-f0-9]{12}$/);
      expect(mocks.stores.get("c")?.profiles[ids[0]]).toMatchObject({ token });
      expect(mocks.stores.get("c")?.profiles[ids[0]]).not.toHaveProperty("email");
      expect(mocks.writeConfig).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

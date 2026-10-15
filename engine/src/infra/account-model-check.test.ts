import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import { agentHasUsableModel, checkAccountModels } from "./account-model-check.js";

const { store, probe, cfg } = vi.hoisted(() => ({
  store: { version: 1, profiles: {}, usageStats: {} } as AuthProfileStore,
  probe: vi.fn(),
  cfg: { agents: { defaults: { model: { primary: "openai/sol", fallbacks: ["openai/luna"] } } } },
}));
vi.mock("../agents/agent-scope.js", () => ({
  listAgentIds: () => ["builder-one", "builder-two"],
  resolveAgentDir: (unused: unknown, id: string) => id,
  resolveAgentWorkspaceDir: () => "fixture",
  resolveAgentEffectiveModelPrimary: () => "openai/sol",
  resolveEffectiveModelFallbacks: () => ["openai/luna"],
}));
vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: () => store,
  resolvePersistedAuthProfileOwnerAgentDir: () => "owner",
  listProfilesForProvider: () => Object.keys(store.profiles),
  resolveAuthProfileOrder: () => Object.keys(store.profiles),
}));
vi.mock("../agents/auth-profiles/store-runtime.js", () => ({
  updateAuthProfileStoreWithLock: async ({
    updater,
  }: {
    updater: (value: AuthProfileStore) => boolean;
  }) => {
    updater(store);
    return store;
  },
}));
vi.mock("../commands/models/list.probe.js", () => ({ runAuthProbes: probe }));
vi.mock("./provider-usage.load.js", () => ({
  loadProviderUsageSummary: async () => ({ providers: [] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  store.profiles = {
    free: {
      type: "oauth",
      provider: "openai",
      access: "fixture",
      refresh: "fixture",
      expires: Date.now() + 60_000,
    },
  };
  store.usageStats = {};
  probe.mockImplementation(async ({ options, modelCandidates }) => ({
    results: [
      {
        profileId: options.profileIds[0],
        model: modelCandidates[0],
        status: options.profileIds[0] === "paid" ? "ok" : "format",
      },
    ],
  }));
});

describe("subscription model eligibility", () => {
  it("probes every configured model once per shared login with one token and blocks a free-only builder", async () => {
    expect(agentHasUsableModel(cfg, "builder-one", 100)).toBe(false);
    await checkAccountModels(cfg, { now: 100 });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls.map(([params]) => params.modelCandidates[0])).toEqual([
      "openai/sol",
      "openai/luna",
    ]);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ maxTokens: 1, subscriptionSelfCheck: true }),
      }),
    );
    expect(agentHasUsableModel(cfg, "builder-one", 101)).toBe(false);
  });
  it("recovers after a paid login is added, expires old success, and refreshes on demand", async () => {
    await checkAccountModels(cfg, { now: 100 });
    store.profiles.paid = { ...store.profiles.free };
    await checkAccountModels(cfg, { now: 200 });
    expect(agentHasUsableModel(cfg, "builder-one", 201)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(agentHasUsableModel(cfg, "builder-one", 200 + 3 * 60 * 60_000)).toBe(false);
    await checkAccountModels(cfg, { force: true, now: 300 });
    expect(probe).toHaveBeenCalledTimes(8);
  });
  it("never probes API-key profiles", async () => {
    store.profiles = { key: { type: "api_key", provider: "openai", key: "fixture" } };
    await checkAccountModels(cfg);
    expect(probe).not.toHaveBeenCalled();
  });
});

vi.mock("../gateway/model-auth-refresh.js", () => ({
  refreshModelAuthStateAfterMutation: async () => {},
}));

it("continues to the paid account after another probe throws", async () => {
  store.profiles.paid = { ...store.profiles.free };
  probe.mockRejectedValueOnce(new Error("fixture transport failure"));
  await checkAccountModels(cfg, { now: 100 });
  expect(store.usageStats?.free?.modelAccess?.["openai/sol"]?.usable).toBe(false);
  expect(agentHasUsableModel(cfg, "builder-one", 101)).toBe(true);
});

/**
 * A long provider Retry-After marks the limited subscription blocked until its reset, so the
 * next run and the usage ring pick the next free subscription instead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPluginMetadataLifecycleCaches } from "../../plugins/plugin-metadata-lifecycle.js";
import type { AuthProfileStore } from "./types.js";
import {
  mockLockedUpdateForStore,
  resetAuthProfileUsageMocks,
  storeMocks,
} from "./usage-fixture.test-support.js";

const pluginMetadataMocks = vi.hoisted(() => {
  const snapshot = { plugins: [], diagnostics: [] };
  return {
    getCurrentPluginMetadataSnapshot: vi.fn(() => snapshot),
    loadPluginMetadataSnapshot: vi.fn(() => snapshot),
  };
});

vi.mock("../../plugins/current-plugin-metadata-snapshot.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/current-plugin-metadata-snapshot.js")>()),
  getCurrentPluginMetadataSnapshot: pluginMetadataMocks.getCurrentPluginMetadataSnapshot,
}));
vi.mock("../../plugins/plugin-metadata-snapshot.js", () => ({
  loadPluginMetadataSnapshot: pluginMetadataMocks.loadPluginMetadataSnapshot,
}));
vi.mock("./external-auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./external-auth.js")>()),
  createExternalAuthRuntime: () => ({
    listRuntimeExternalAuthProfiles: () => [],
    overlayExternalAuthProfiles: <T>(store: T) => store,
  }),
}));
vi.mock("./store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./store.js")>()),
  resolvePersistedAuthProfileOwnerAgentDir: (await import("./usage-fixture.test-support.js"))
    .storeMocks.resolvePersistedAuthProfileOwnerAgentDir,
}));
// mock-isolation: run the real reducer without persistence workers.
vi.mock("./usage-write.js", async () => ({
  withAuthProfileUsage: (await import("./usage-fixture.test-support.js")).usageMocks
    .withAuthProfileUsage,
}));
// mock-isolation: keep native auth-store I/O outside the in-memory fixture.
vi.mock("./store-runtime.js", async () => {
  const { storeMocks: mocks } = await import("./usage-fixture.test-support.js");
  return {
    loadAuthProfileStoreWithoutExternalProfiles: mocks.loadAuthProfileStoreWithoutExternalProfiles,
    updateAuthProfileStoreWithLock: mocks.updateAuthProfileStoreWithLock,
    saveAuthProfileStore: mocks.saveAuthProfileStore,
  };
});

import { resolveAuthProfileOrder } from "./order.js";
import { coerceProfileUsageStats } from "./profile-usage-stats.js";
import { isProfileInCooldown, markAuthProfileBlockedUntil } from "./usage.js";

const NOW = Date.parse("2026-10-09T03:00:00.000Z");
const RESET = NOW + 30 * 60 * 60 * 1000;

function subscriptions(): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      "anthropic:first": { type: "token", provider: "anthropic", token: "fixture-token-first" },
      "anthropic:second": { type: "token", provider: "anthropic", token: "fixture-token-second" },
    },
    order: { anthropic: ["anthropic:first", "anthropic:second"] },
  };
}

async function markFirstLimited(store: AuthProfileStore): Promise<void> {
  mockLockedUpdateForStore(store);
  await markAuthProfileBlockedUntil({
    store,
    profileId: "anthropic:first",
    blockedUntil: RESET,
    source: "provider_retry_after",
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  clearPluginMetadataLifecycleCaches();
  storeMocks.resolvePersistedAuthProfileOwnerAgentDir.mockReset();
  storeMocks.resolvePersistedAuthProfileOwnerAgentDir.mockImplementation(
    (params: { agentDir?: string }) => params.agentDir,
  );
  storeMocks.saveAuthProfileStore.mockReset();
  storeMocks.loadAuthProfileStoreWithoutExternalProfiles.mockReset();
  storeMocks.updateAuthProfileStoreWithLock.mockReset();
  resetAuthProfileUsageMocks();
});

describe("markAuthProfileBlockedUntil with a provider Retry-After", () => {
  it("blocks the limited subscription until its reset", async () => {
    const store = subscriptions();
    await markFirstLimited(store);

    expect(store.usageStats?.["anthropic:first"]).toMatchObject({
      blockedUntil: RESET,
      blockedReason: "subscription_limit",
      blockedSource: "provider_retry_after",
    });
    expect(isProfileInCooldown(store, "anthropic:first", NOW)).toBe(true);
    expect(isProfileInCooldown(store, "anthropic:first", RESET + 1)).toBe(false);
    expect(isProfileInCooldown(store, "anthropic:second", NOW)).toBe(false);
  });

  it("puts the next free subscription first in the order", async () => {
    const store = subscriptions();
    expect(resolveAuthProfileOrder({ store, provider: "anthropic" })).toEqual([
      "anthropic:first",
      "anthropic:second",
    ]);

    await markFirstLimited(store);

    expect(resolveAuthProfileOrder({ store, provider: "anthropic" })).toEqual([
      "anthropic:second",
      "anthropic:first",
    ]);
  });

  it("keeps the block's source when the saved usage is read back", async () => {
    const store = subscriptions();
    await markFirstLimited(store);

    const saved = JSON.parse(JSON.stringify(store.usageStats?.["anthropic:first"]));
    expect(coerceProfileUsageStats(saved)).toMatchObject({
      blockedUntil: RESET,
      blockedReason: "subscription_limit",
      blockedSource: "provider_retry_after",
    });
  });
});

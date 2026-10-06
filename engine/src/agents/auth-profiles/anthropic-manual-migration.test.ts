import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { copyLegacyClaudeProfile, migrateLegacyClaudeConfig } from "./anthropic-manual-migration-core.js";
import type { AuthProfileStore } from "./types.js";

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
});

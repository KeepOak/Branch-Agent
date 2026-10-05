import { expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import { resolveProviderAuthsAll } from "./provider-usage.auth.js";

const { store, resolveKey } = vi.hoisted(() => {
  const profiles = Object.fromEntries(["ash", "elm", "oak"].map((name) => [`openai:${name}`, {
    type: "oauth", provider: "openai", access: `${name}-token`, refresh: "fixture", expires: 2_000_000_000_000,
    email: `${name}@example.test`,
  }]));
  return { store: { version: 1, profiles } as AuthProfileStore,
    resolveKey: vi.fn(async ({ profileId }: { profileId: string }) => profileId === "openai:elm"
      ? null : { apiKey: `${profileId.split(":")[1]}-token`, provider: "openai" }) };
});

vi.mock("../agents/auth-profiles.js", () => ({
  dedupeProfileIds: (ids: string[]) => [...new Set(ids)],
  ensureAuthProfileStore: () => store,
  ensureAuthProfileStoreWithoutExternalProfiles: () => store,
  hasAnyAuthProfileStoreSourceAsync: async () => true,
  resolveApiKeyForProfile: resolveKey,
  resolveAuthProfileOrder: () => ["openai:ash", "openai:elm", "openai:oak"],
}));
vi.mock("../plugins/provider-runtime.js", async () => ({
  ...(await vi.importActual<typeof import("../plugins/provider-runtime.js")>("../plugins/provider-runtime.js")),
  resolveProviderUsageAuthWithPlugin: async () => undefined,
}));

it("walks every ordered OAuth profile and retains a failed account row", async () => {
  const auths = await resolveProviderAuthsAll({ providers: ["openai"], config: {}, env: {}, store });
  expect(auths.map((auth) => [auth.authProfileId, auth.email, auth.authError])).toEqual([
    ["openai:ash", "ash@example.test", undefined],
    ["openai:elm", "elm@example.test", "Auth failed"],
    ["openai:oak", "oak@example.test", undefined],
  ]);
});

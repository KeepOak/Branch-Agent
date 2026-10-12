import { expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { BranchConfig } from "../config/config.js";

const profileIds = [
  "openai:first",
  "openai:sharing",
  "openai:second",
  "openai:missing",
  "openai:third",
];
const store: AuthProfileStore = {
  version: 1,
  order: { openai: profileIds },
  profiles: Object.fromEntries(
    profileIds.map((id) => [
      id,
      {
        type: "oauth",
        provider: "openai",
        access: `token-${id}`,
        refresh: `refresh-${id}`,
        expires: Date.now() + 86_400_000,
        email: `${id.split(":")[1]}@example.test`,
        ...(id === "openai:sharing" ? { authFlow: "chatgpt-token-sharing" } : {}),
      },
    ]),
  ) as AuthProfileStore["profiles"],
};

vi.mock("../agents/auth-profiles.js", () => ({
  dedupeProfileIds: (ids: string[]) => [...new Set(ids)],
  ensureAuthProfileStore: () => store,
  ensureAuthProfileStoreWithoutExternalProfiles: () => store,
  hasAnyAuthProfileStoreSourceAsync: async () => true,
  resolveAuthProfileOrder: () => store.order?.openai ?? [],
  resolveApiKeyForProfile: async ({ profileId }: { profileId: string }) => {
    if (profileId === "openai:missing") return null;
    return { apiKey: `token-${profileId}`, credential: store.profiles[profileId] };
  },
}));
vi.mock("../plugins/provider-runtime.js", () => ({
  resolveProviderUsageAuthWithPlugin: async () => null,
}));
vi.mock("../plugins/manifest-contract-eligibility.js", () => ({
  loadManifestMetadataSnapshot: () => ({ plugins: [] }),
}));
vi.mock("@branch/normalization-core/string-normalization", () => ({
  normalizeUniqueStringEntries: (values: string[]) => [...new Set(values.filter(Boolean))],
}));
vi.mock("../agents/model-auth-env.js", () => ({ resolveEnvApiKey: () => undefined }));
vi.mock("../agents/model-auth-markers.js", () => ({ isNonSecretApiKeyMarker: () => false }));
vi.mock("../agents/model-auth.js", () => ({ resolveUsableCustomProviderApiKey: () => undefined }));
vi.mock("../agents/model-selection.js", () => ({ normalizeProviderId: (id: string) => id }));
vi.mock("../config/config.js", () => ({ getRuntimeConfig: () => ({}) }));
vi.mock("../plugins/config-state.js", () => ({ normalizePluginsConfig: () => ({}) }));
vi.mock("../plugins/manifest-owner-policy.js", () => ({
  isActivatedManifestOwner: () => false, passesManifestOwnerBasePolicy: () => false,
}));
vi.mock("../secrets/provider-env-vars.js", () => ({
  resolveProviderAuthEnvVarCandidatesCore: () => ({}),
}));
vi.mock("../utils/normalize-secret-input.js", () => ({
  normalizeSecretInput: (value: string | undefined) => value,
}));
vi.mock("./provider-usage.shared.js", () => ({ isOAuthOnlyUsageProvider: () => true }));

import { resolveProviderAuthsAll } from "./provider-usage.auth.js";

it("returns every ordered OpenAI account once, skipping sharing and retaining auth failures", async () => {
  const auths = await resolveProviderAuthsAll({
    providers: ["openai"],
    store,
    config: {} as BranchConfig,
    env: {},
  });
  expect(auths.map((auth) => auth.authProfileId)).toEqual([
    "openai:first", "openai:second", "openai:missing", "openai:third",
  ]);
  expect(auths.map((auth) => auth.token)).toEqual([
    "token-openai:first", "token-openai:second", "", "token-openai:third",
  ]);
  expect(auths[2]).toMatchObject({ authProfileId: "openai:missing", authError: "Auth failed" });
  expect(auths.filter((auth) => auth.authProfileId === "openai:first")).toHaveLength(1);
});

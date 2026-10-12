import { expect, it } from "vitest";
import { loadPersistedAuthProfileStore } from "../../../../src/agents/auth-profiles/persisted.js";
import { saveAuthProfileStore } from "../../../../src/agents/auth-profiles/store-runtime.js";
import type { AuthProfileStore } from "../../../../src/agents/auth-profiles/types.js";
import { withBranchTestState } from "../../../../src/test-utils/branch-test-state.js";
import { createCodexAuthProfileSelection } from "./auth-profile-selection.js";
import { recordCodexAuthProfileOutcome } from "./auth-profile-usage.js";

it("records each Codex agent's first-ordered account in its own durable auth state", async () => {
  await withBranchTestState({ label: "codex-account-usage", scenario: "minimal" }, async (state) => {
    const ids = ["ash", "elm", "oak"] as const;
    const profiles = ids.map((id) => `openai:${id}`);
    const selection = createCodexAuthProfileSelection({
      ensureAuthProfileStore: () => { throw new Error("unexpected store read"); },
      resolveAuthProfileOrder: ({ store }) => store.order?.openai ?? [],
    } as never);
    for (const id of ids) {
      const agentDir = state.agentDir(id);
      const chosen = `openai:${id}`;
      const store: AuthProfileStore = {
        version: 1,
        profiles: Object.fromEntries(profiles.map((profileId) => [profileId, {
          type: "api_key", provider: "openai", key: `synthetic-${profileId}`,
        }])),
        order: { openai: [chosen, ...profiles.filter((profileId) => profileId !== chosen)] },
      };
      saveAuthProfileStore(store, agentDir, { filterExternalAuthProfiles: false, syncExternalCli: false });
      const profileId = selection.resolveCodexAppServerAuthProfileId({ store });
      expect(profileId).toBe(chosen);
      await recordCodexAuthProfileOutcome({
        authProfileId: profileId,
        store,
        agentDir,
        modelId: "gpt-6-sol",
        runId: `run-${id}`,
        succeeded: true,
        providerStarted: true,
      });
      expect(store.lastGood?.openai).toBe(chosen);
      expect(store.usageStats?.[chosen]?.lastUsed).toBeGreaterThan(0);
      const durable = loadPersistedAuthProfileStore(agentDir);
      expect(durable?.lastGood?.openai).toBe(chosen);
      expect(durable?.usageStats?.[chosen]?.lastUsed).toBeGreaterThan(0);
      await recordCodexAuthProfileOutcome({
        authProfileId: profileId,
        store,
        agentDir,
        modelId: "gpt-6-sol",
        runId: `local-${id}`,
        succeeded: true,
        providerStarted: false,
      });
      expect(store.usageStats?.[chosen]?.lastUsed).toBe(durable?.usageStats?.[chosen]?.lastUsed);
    }
  });
});

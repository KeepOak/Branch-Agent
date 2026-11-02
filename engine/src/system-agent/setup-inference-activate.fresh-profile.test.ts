// #589: a fresh desktop profile has explicit agent ownership and no entries, yet setup
// activates a saved sign-in for the window's default agent, "main".
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasResolvedRosterBeforeMigrations } from "../config/agent-roster-provenance.js";
import { clearConfigCache, readConfigFileSnapshot } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { persistProviderAuthProfilesAfterLogin } from "../plugins/provider-auth-persistence.js";
import { closeBranchAgentDatabasesForTest } from "../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";
import {
  credential,
  fixture,
  modelRef,
  tempDirs,
} from "./setup-inference-activate.test-support.js";
import { toSavedAuthSetupKind } from "./setup-inference-core.js";

afterEach(async () => {
  closeBranchAgentDatabasesForTest();
  await closeBranchStateDatabaseAsync();
  closeBranchStateDatabaseForTest();
  tempDirs.cleanup();
  clearConfigCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("setup activation on a fresh desktop profile", () => {
  it.each([{ agentId: "main" as const }, { agentId: undefined }])(
    "activates a saved OpenAI sign-in and selects its model (agentId: $agentId)",
    async ({ agentId }) => {
      const setup = await fixture({ authMethod: "api_key" });
      // desktop/src/profile-migration.ts writeDefaultConfig: explicit ownership, no entries.
      // The provider catalog stands in for what the bundled OpenAI plugin supplies.
      const fresh: BranchConfig = {
        gateway: { mode: "local", bind: "loopback" },
        agents: { ownership: "explicit", defaults: { workspace: setup.workspace } },
        models: setup.config.models,
      };
      await fs.writeFile(setup.configPath, JSON.stringify(fresh, null, 2) + "\n");
      clearConfigCache();
      await persistProviderAuthProfilesAfterLogin({
        config: fresh,
        agentDir: setup.agentDir,
        profiles: [{ profileId: "openai:saved", credential }],
      });

      const result = await setup.activate(toSavedAuthSetupKind("openai:saved"), true, {
        ...(agentId ? { agentId } : {}),
        modelRef,
      });

      expect(result).toMatchObject({ ok: true, modelRef });
      expect(setup.login).not.toHaveBeenCalled();
      expect(setup.run).toHaveBeenCalledOnce();
      expect(setup.run.mock.calls[0]?.[0]).toMatchObject({ authProfileId: "openai:saved" });
      // The model goes to the defaults; the roster stays for setup to create its first Trunk.
      const saved = await readConfigFileSnapshot();
      expect(JSON.stringify(saved.sourceConfig.agents?.defaults?.model)).toContain(modelRef);
      expect(saved.sourceConfig.agents?.ownership).toBe("explicit");
      expect(hasResolvedRosterBeforeMigrations(saved)).toBe(false);
    },
  );

  it("still refuses an agent that a configured roster doesn't have", async () => {
    const setup = await fixture({ authMethod: "api_key" });
    const configured: BranchConfig = {
      gateway: { mode: "local", bind: "loopback" },
      agents: {
        ownership: "explicit",
        entries: { hazel: {} },
        defaults: { workspace: setup.workspace },
      },
      models: setup.config.models,
    };
    await fs.writeFile(setup.configPath, JSON.stringify(configured, null, 2) + "\n");
    clearConfigCache();
    await persistProviderAuthProfilesAfterLogin({
      config: configured,
      agentDir: setup.agentDir,
      profiles: [{ profileId: "openai:saved", credential }],
    });

    await expect(
      setup.activate(toSavedAuthSetupKind("openai:saved"), true, { agentId: "main", modelRef }),
    ).rejects.toThrow('Could not resolve configured agent "main".');
    expect(setup.run).not.toHaveBeenCalled();
  });
});

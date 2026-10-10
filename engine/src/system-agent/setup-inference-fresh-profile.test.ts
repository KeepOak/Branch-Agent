import fs from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { upsertAuthProfileWithLock } from "../agents/auth-profiles/upsert-with-lock.js";
import { clearConfigCache, readConfigFileSnapshot } from "../config/config.js";
import { resolveAgentModelPrimaryValue } from "../config/model-input.js";
import { closeBranchAgentDatabasesAsync } from "../state/branch-agent-db.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import { credential, fixture, modelRef, tempDirs } from "./setup-inference-activate.test-support.js";
import { verifySetupInference } from "./setup-inference-turn.js";
import { applySystemAgentModelSelection } from "./setup-model-selection.js";

afterEach(async () => {
  await closeBranchAgentDatabasesAsync();
  await closeStateDatabaseForTest();
  tempDirs.cleanup();
  clearConfigCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  { agentId: undefined, owner: "main" },
  { agentId: "main", owner: "main" },
  { agentId: undefined, owner: "ops" },
])(
  "activates and verifies a saved OpenAI profile (agent: $agentId, owner: $owner)",
  async ({ agentId, owner }) => {
    const setup = await fixture({ fresh: true, surface: "gateway", authMethod: "api_key" });
    setup.config.agents!.ownership = "explicit";
    setup.config.agents!.defaults!.authInheritance = { agentId: owner };
    if (owner !== "main") {
      setup.config.agents!.defaults!.systemAgent = { agentId: owner };
      setup.config.agents!.entries = {
        [owner]: { agentDir: setup.agentDir, workspace: setup.workspace },
      };
    }
    await fs.writeFile(setup.configPath, JSON.stringify(setup.config));
    clearConfigCache();
    await upsertAuthProfileWithLock({
      agentDir: setup.agentDir,
      profileId: "openai:saved",
      credential,
    });

    const result = await setup.activate("saved-auth:openai%3Asaved", true, { agentId });

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    expect(setup.login).not.toHaveBeenCalled();
    expect(setup.run).toHaveBeenCalledOnce();
    expect(setup.run.mock.calls[0]?.[0]).toMatchObject({
      agentId: owner,
      authProfileId: "openai:saved",
      allowAuthProfileFallback: false,
    });
    const saved = await readConfigFileSnapshot();
    expect(saved.valid).toBe(true);
    expect(Object.keys(saved.config.agents?.entries ?? {})).toEqual([owner]);
    expect(
      resolveAgentModelPrimaryValue(
        agentId ? saved.config.agents?.entries?.[owner]?.model : saved.config.agents?.defaults?.model,
      ),
    ).toBe(`${modelRef}@openai:saved`);
    const verified = await verifySetupInference({
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      deps: setup.deps,
      agentId,
    });
    expect(verified, JSON.stringify(verified)).toMatchObject({ ok: true });
    expect(setup.run).toHaveBeenCalledTimes(2);
  },
);

it("does not register an arbitrary agent or repopulate an authored empty roster", async () => {
  for (const config of [
    { agents: { ownership: "explicit" as const } },
    { agents: { ownership: "explicit" as const, entries: {} } },
  ]) {
    await expect(
      applySystemAgentModelSelection({ config, model: modelRef, targetAgentId: "missing" }),
    ).rejects.toThrow('Could not resolve configured agent "missing".');
  }
  await expect(
    applySystemAgentModelSelection({
      config: { agents: { ownership: "explicit", entries: {} } },
      model: modelRef,
      targetAgentId: "main",
    }),
  ).rejects.toThrow('Could not resolve configured agent "main".');
});

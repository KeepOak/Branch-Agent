import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetModelsJsonReadyCacheForTest } from "../agents/models-config-state.test-support.js";
import { CUSTOM_PROXY_MODELS_CONFIG } from "../agents/models-config.e2e-harness.js";
import { ensureBranchModelsJson, planBranchModelsJsonSource } from "../agents/models-config.js";
import { persistGroveInstallRecord } from "../groves/provenance.js";
import { makeProvenancePlan } from "../groves/provenance.test-helpers.js";
import { resolveGroveToolPolicyConsent } from "../groves/tool-policy-runtime.js";
import {
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import { createPluginCache, withPluginCache } from "../plugins/plugin-cache.js";
import { closeBranchAgentDatabasesForTest } from "../state/branch-agent-db.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    closeBranchAgentDatabasesForTest();
    await closeBranchStateDatabaseAsync();
    clearRuntimeConfigSnapshot();
    resetModelsJsonReadyCacheForTest();
    vi.unstubAllEnvs();
    cleanup();
  }),
);

async function fixture() {
  const home = dirs.make("models-cold-runtime-");
  const state = path.join(home, "state");
  const bundled = path.join(home, "bundled");
  await fs.mkdir(bundled);
  for (const [key, value] of Object.entries({
    HOME: home,
    BRANCH_HOME: undefined,
    BRANCH_STATE_DIR: state,
    BRANCH_CONFIG_PATH: undefined,
    BRANCH_PROFILE: undefined,
    BRANCH_AGENT_DIR: undefined,
    BRANCH_BUNDLED_PLUGINS_DIR: bundled,
    BRANCH_LOAD_SHELL_ENV: undefined,
  })) {
    vi.stubEnv(key, value);
  }
  const { plan } = await makeProvenancePlan(
    home,
    { schemaVersion: 1, agent: { id: "worker" } },
    { branchProfile: { schemaVersion: 1, agent: { tools: { allow: ["read"] } } } },
  );
  persistGroveInstallRecord(plan, { env: process.env });
  const { id, ...agent } = plan.agent.config;
  const config = {
    ...CUSTOM_PROXY_MODELS_CONFIG,
    agents: { entries: { [id]: agent } },
  };
  await fs.writeFile(path.join(state, "branch.json"), JSON.stringify(config));
  await closeBranchStateDatabaseAsync();
  clearRuntimeConfigSnapshot();
  const agentDir = path.join(state, "agents", "worker", "agent");
  return { config, agentDir, state };
}

it.each(["ensure", "plan"] as const)(
  "%s loads cold config and Grove consent without host provenance SQL",
  async (operation) => {
    const { agentDir } = await fixture();
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
    const contents = await withPluginCache(createPluginCache(), async () => {
      if (operation === "plan") {
        return (await planBranchModelsJsonSource(undefined, agentDir)).modelsJsonContents;
      }
      await ensureBranchModelsJson(undefined, agentDir);
      return fs.readFile(path.join(agentDir, "models.json"), "utf8");
    });
    expect(JSON.parse(contents ?? "null")).toEqual({
      providers: CUSTOM_PROXY_MODELS_CONFIG.models?.providers,
    });
    const tools = getRuntimeConfigSnapshot()?.agents?.entries?.worker?.tools;
    expect(
      resolveGroveToolPolicyConsent({
        agentTools: tools,
        agentId: "worker",
        hasAgentAllowlist: true,
        ownsProfile: true,
        profile: "full",
      }),
    ).toEqual({ frozen: true });
    const hostQueries = prepare.mock.calls.map(([sql]) => sql);
    expect(hostQueries.filter((sql) => /from\s+"?grove_installs/i.test(sql))).toEqual([]);
  },
);

it("keeps source secret markers when the same runtime is republished before continuation", async () => {
  const { config, agentDir } = await fixture();
  const provider = CUSTOM_PROXY_MODELS_CONFIG.models!.providers!["custom-proxy"]!;
  const sourceFor = (id: string) => ({
    ...config,
    models: {
      providers: {
        "custom-proxy": {
          ...provider,
          apiKey: { source: "env" as const, provider: "default", id },
        },
      },
    },
  });
  setRuntimeConfigSnapshot(config, sourceFor("MODEL_ORIGINAL_KEY"));
  const pending = ensureBranchModelsJson(undefined, agentDir);
  setRuntimeConfigSnapshot(config, sourceFor("MODEL_REPLACEMENT_KEY"));
  await pending;
  const contents = await fs.readFile(path.join(agentDir, "models.json"), "utf8");
  expect(JSON.parse(contents ?? "null").providers["custom-proxy"].apiKey).toBe(
    "MODEL_ORIGINAL_KEY",
  );
});

it("refuses a cold read after its config selector changes", async () => {
  const { agentDir, state } = await fixture();
  const pending = ensureBranchModelsJson(undefined, agentDir);
  vi.stubEnv("BRANCH_CONFIG_PATH", path.join(state, "replaced.json"));
  await expect(pending).rejects.toThrow("Runtime config source changed");
  expect(getRuntimeConfigSnapshot()).toBeNull();
  await expect(fs.access(path.join(agentDir, "models.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("retains its default agent directory after captured environment changes", async () => {
  const { config, agentDir, state } = await fixture();
  setRuntimeConfigSnapshot(config);
  const pending = ensureBranchModelsJson();
  vi.stubEnv("BRANCH_STATE_DIR", path.join(state, "replacement-state"));
  expect((await pending).agentDir).toBe(agentDir);
});

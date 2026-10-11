// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { getPreparedModelRuntimeMocks, usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { activateGatewayAgentDatabaseStartup } from "../gateway/server-agent-database-startup.js";
import {
  bindPluginMetadataSnapshotCache,
  createPluginCache,
  retirePluginCache,
} from "../plugins/plugin-cache.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "../state/agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "../state/agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import type { BranchDatabaseSchemaPreflight } from "../state/branch-database-preflight.types.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import { resolveAuthProfileDatabasePath } from "./auth-profiles/sqlite.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import { listConfiguredOwnerInputs } from "./prepared-model-runtime.configured.js";
import { getPreparedModelRuntimeSnapshot } from "./prepared-model-runtime.js";

const fixture = usePreparedModelRuntimeHarness({ label: "startup-self-heal" });
const mocks = getPreparedModelRuntimeMocks();

// The Gateway's startup preparation refreshes the active secrets snapshot and migrates sessions
// first; this fixture has neither, so those two steps succeed and the model publication is real.
const secrets = vi.hoisted(() => ({
  active: false,
  revision: 0,
  authDatabasePaths: [] as string[],
}));
vi.mock("../secrets/runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../secrets/runtime.js")>();
  const snapshot = () => ({
    sourceConfig: {},
    authStores: secrets.authDatabasePaths.map((databasePath) => ({ databasePath })),
  });
  return {
    ...actual,
    getActiveSecretsRuntimeSnapshot: (() =>
      secrets.active
        ? snapshot()
        : actual.getActiveSecretsRuntimeSnapshot()) as typeof actual.getActiveSecretsRuntimeSnapshot,
    getActiveSecretsRuntimeSnapshotRevision: () =>
      secrets.active ? secrets.revision : actual.getActiveSecretsRuntimeSnapshotRevision(),
    refreshActiveSecretsRuntimeSnapshotForConfig: (async (
      params: Parameters<typeof actual.refreshActiveSecretsRuntimeSnapshotForConfig>[0],
    ) => {
      if (!secrets.active) {
        return await actual.refreshActiveSecretsRuntimeSnapshotForConfig(params);
      }
      params.assertCurrent?.();
      secrets.revision += 1;
      return true;
    }) as typeof actual.refreshActiveSecretsRuntimeSnapshotForConfig,
  };
});
vi.mock("../gateway/server-startup-session-migration.js", () => ({
  runStartupSessionMigration: async () => {},
}));

async function closeDatabases() {
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}
afterEach(async () => {
  secrets.active = false;
  secrets.authDatabasePaths = [];
  await closeDatabases();
});

const config: BranchConfig = {};
const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
const inputFor = (agentId: string) =>
  listConfiguredOwnerInputs(config, undefined, true).find((input) => input.agentId === agentId)!;

/** A metadata snapshot the Gateway still holds, owned by a plugin cache a reload can retire. */
function gatewayMetadataSnapshot() {
  const cache = createPluginCache();
  const snapshot = { ...mocks.pluginMetadataSnapshot } as unknown as PluginMetadataSnapshot;
  bindPluginMetadataSnapshotCache(snapshot, cache);
  return { snapshot, retire: () => void retirePluginCache(cache).catch(() => {}) };
}

/**
 * Runs the Gateway's own startup activation for one Trunk. Only openAgent (the database worker
 * handshake, covered elsewhere) is skipped. A failed attempt backs off for a minute, so a Trunk
 * that gets ready within the test did so without failing an attempt and without a restart.
 */
async function startTrunk(
  agentId: string,
  getPluginMetadataSnapshot: () => PluginMetadataSnapshot | undefined,
) {
  mocks.configuredAgentIds = [agentId];
  const env = { ...process.env, BRANCH_AGENT_PREPARATION_RETRY_MS: "60000" };
  const path = openBranchAgentDatabase({ agentId, env }).path;
  await closeDatabases();
  secrets.authDatabasePaths = [resolveAuthProfileDatabasePath(fixture.state.agentDir(agentId))];
  secrets.active = true;
  const failedAttempts: string[] = [];
  const warnings: string[] = [];
  let stop: (() => Promise<void>) | undefined;
  await withAgentDatabaseStartupAdmission(async (admission) => {
    const refusals = admission.defer({
      env,
      inspections: [{ target: { agentId, path }, result: Promise.resolve(clean) }],
      reason: "Inspection continues after the Gateway listener binds.",
    });
    recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
    stop = admission.adopt().stop;
    activateGatewayAgentDatabaseStartup({
      admission: {
        activate: (activation: Parameters<typeof admission.activate>[0]) =>
          admission.activate({
            ...activation,
            openAgent: async () => {},
            prepareAgent: async (input) => {
              try {
                await activation.prepareAgent(input);
              } catch (error) {
                failedAttempts.push(String(error));
                throw error;
              }
            },
          }),
      } as unknown as Parameters<typeof activateGatewayAgentDatabaseStartup>[0]["admission"],
      preparationReady: Promise.resolve(),
      getConfig: () => config,
      getPluginRegistry: () => createEmptyPluginRegistry(),
      getPluginMetadataSnapshot,
      isCurrent: () => true,
      log: { info: () => {}, warn: (message) => warnings.push(message) },
    });
  });
  const ready = async () => {
    await expect
      .poll(() => readAgentDatabaseAdmissionRefusal(agentId, { env }), { timeout: 10000 })
      .toBeUndefined();
  };
  return { failedAttempts, warnings, ready, stop: async () => await stop?.() };
}

describe("startup preparation heals a plugin inventory retired by a reload", () => {
  it("publishes a Trunk whose Gateway still holds a retired metadata snapshot, with no failed attempt", async () => {
    // The 19:40 reload retired the plugin inventory ("Plugin inventory has retired") and failed
    // before it published a replacement, so the Gateway kept handing out the retired snapshot.
    const gateway = gatewayMetadataSnapshot();
    gateway.retire();
    const trunk = await startTrunk("builder-birch", () => gateway.snapshot);
    try {
      await trunk.ready();
      expect(getPreparedModelRuntimeSnapshot(inputFor("builder-birch"))).toBeDefined();
      expect(trunk.failedAttempts).toEqual([]);
    } finally {
      await trunk.stop();
    }
  }, 30000);

  it("publishes again when the inventory retires while the Trunk's publication is running", async () => {
    const gateway = gatewayMetadataSnapshot();
    let builds = 0;
    mocks.prepareStaticCatalog.mockImplementation(async () => {
      if (++builds === 1) {
        // A config reload retires the inventory mid-build; the Gateway keeps the old snapshot.
        gateway.retire();
      }
      return { entries: [] };
    });
    const trunk = await startTrunk("device-tester", () => gateway.snapshot);
    try {
      await trunk.ready();
      expect(getPreparedModelRuntimeSnapshot(inputFor("device-tester"))).toBeDefined();
      expect(trunk.failedAttempts).toEqual([]);
      expect(builds).toBeGreaterThanOrEqual(2);
    } finally {
      await trunk.stop();
    }
  }, 30000);
});

describe("startup preparation with auth order rows the store cannot serve", () => {
  const oauth = (provider: string) => ({ type: "oauth" as const, provider, access: "tok" });

  it("publishes a Trunk whose order names profiles absent from its store, and reports the row", async () => {
    // builder-oak: four anthropic profiles; its openai order row names profiles it does not hold.
    mocks.preparedAuthStore = {
      version: 1,
      profiles: { "anthropic:a": oauth("anthropic"), "anthropic:b": oauth("anthropic") },
      order: { anthropic: ["anthropic:b", "anthropic:a"], openai: ["openai:x", "openai:y"] },
    } as unknown as AuthProfileStore;
    const trunk = await startTrunk("builder-oak", () => undefined);
    try {
      await trunk.ready();
      expect(getPreparedModelRuntimeSnapshot(inputFor("builder-oak"))).toBeDefined();
      expect(trunk.failedAttempts).toEqual([]);
      expect(trunk.warnings).toContainEqual(
        expect.stringContaining(
          "agent builder-oak auth order names profiles absent from its auth store; model selection skips them: openai=[openai:x, openai:y]",
        ),
      );
    } finally {
      await trunk.stop();
    }
  }, 30000);

  it("publishes an inheritor whose own store lacks the openai profiles its owner holds, without a report", async () => {
    // Own store: anthropic only. Effective store: plus tk's openai profiles (authInheritance).
    mocks.preparedAuthStore = {
      version: 1,
      profiles: { "anthropic:a": oauth("anthropic"), "openai:tk-1": oauth("openai") },
      order: { anthropic: ["anthropic:a"], openai: ["openai:tk-1"] },
    } as unknown as AuthProfileStore;
    const trunk = await startTrunk("new-trunk-3", () => undefined);
    try {
      await trunk.ready();
      expect(getPreparedModelRuntimeSnapshot(inputFor("new-trunk-3"))).toBeDefined();
      expect(trunk.failedAttempts).toEqual([]);
      expect(trunk.warnings.filter((message) => message.includes("auth order"))).toEqual([]);
    } finally {
      await trunk.stop();
    }
  }, 30000);
});

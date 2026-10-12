import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  createPluginStateKeyedStoreForTests,
  getPluginStateCapacityForTests,
  importPluginStateEntriesForDoctorForTests,
  resetPluginStateStoreForTests,
} from "branch/plugin-sdk/plugin-state-test-runtime";
import type {
  OpenKeyedStoreOptions,
  PluginDoctorStateMigrationContext,
} from "branch/plugin-sdk/runtime-doctor-migrations";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  closeBranchStateDatabaseAsync,
} from "branch/plugin-sdk/sqlite-runtime-testing";

type AuthoredAgents = NonNullable<BranchConfig["agents"]>;
type AuthoredEntry = NonNullable<AuthoredAgents["entries"]>[string];
type AuthoredMemory = NonNullable<BranchConfig["memory"]>;
type AuthoredMemorySearch = NonNullable<AuthoredMemory["search"]>;
type RawLegacyMemorySearch = Omit<AuthoredMemorySearch, "store"> & {
  store?: NonNullable<AuthoredMemorySearch["store"]> & { path?: string };
};
/** Pre-Doctor memory-core config: retired roster rows, default markers, and legacy memory-search keys. */
export type RawLegacyDoctorConfig = Omit<BranchConfig, "agents" | "memory"> & {
  agents?: Omit<AuthoredAgents, "entries"> & {
    entries?: Record<string, AuthoredEntry & { default?: boolean }>;
    list?: unknown[];
  };
  memory?: Omit<AuthoredMemory, "search"> & { search?: RawLegacyMemorySearch };
  memorySearch?: RawLegacyMemorySearch;
};

export function createDoctorContext(env: NodeJS.ProcessEnv): PluginDoctorStateMigrationContext {
  return {
    getPluginStateCapacity() {
      return getPluginStateCapacityForTests("memory-core", env);
    },
    importPluginStateEntries(options, entries) {
      importPluginStateEntriesForDoctorForTests(
        "memory-core",
        { ...options, env: options.env ?? env },
        entries,
      );
    },
    openPluginStateKeyedStore<T>(options: OpenKeyedStoreOptions) {
      return createPluginStateKeyedStoreForTests<T>("memory-core", {
        ...options,
        env: options.env ?? env,
      });
    },
  };
}

export async function resetDoctorPluginState() {
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeBranchStateDatabaseAsync();
  resetPluginStateStoreForTests();
}

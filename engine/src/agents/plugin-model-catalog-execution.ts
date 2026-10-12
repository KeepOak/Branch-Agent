import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolvePathViaExistingAncestorSync } from "../infra/boundary-path.js";
import { withFileLock } from "../infra/file-lock.js";
import { runtimeProcessEntrypoints } from "../infra/runtime-process-entrypoints.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { runSqliteReadOnlyOperation } from "../infra/sqlite-readonly-worker.js";
import {
  assertExistingDatabaseIdentity,
  readDatabasePathIdentitySync,
} from "../infra/sqlite-worker-identity.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import type { SqliteWorkerStore } from "../infra/sqlite-worker-store.js";
import type { BranchAgentDatabaseOptions } from "../state/branch-agent-db-contract.js";
import { registerBranchAgentDatabaseAsyncResource } from "../state/branch-agent-db-resources.js";
import { captureBranchAgentDatabaseExecution } from "../state/branch-agent-execution.js";
import {
  openBranchAgentSqliteWorkerStore,
  type BranchAgentSqliteWorkerStore,
} from "../state/branch-agent-worker-store.js";
import { runBranchAgentWorkerWrite } from "../state/branch-agent-write-admission.js";
import { registerBranchStateDatabaseAsyncResource } from "../state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { captureBranchStateReadContext } from "../state/branch-state-worker-context.js";
import {
  resolveAuthProfileDatabaseOwnerId,
  resolveAuthProfileDatabasePath,
} from "./auth-profiles/sqlite.js";
import type { PersistedPluginModelCatalog } from "./plugin-model-catalog.read-operation.js";
import type { PluginModelCatalogCredentialOperations } from "./plugin-model-catalog.worker.js";

/** A clean read must follow publication settlement, including another process's uncommitted row. */
export async function withPluginModelCatalogPublicationLocks<T>(
  databasePaths: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const paths = [...new Set(databasePaths.map(resolvePathViaExistingAncestorSync))].toSorted();
  const enter = async (index: number): Promise<T> => {
    const databasePath = paths[index];
    return databasePath
      ? await withFileLock(
          `${databasePath}.plugin-model-catalog`,
          {
            retries: {
              retries: 20,
              factor: 2,
              minTimeout: 100,
              maxTimeout: 10_000,
              randomize: true,
            },
            stale: 180_000,
            staleRecovery: "remove-if-definitely-stale",
          },
          () => enter(index + 1),
        )
      : await operation();
  };
  return await enter(0);
}

/** The canonical executor owns preparation, publication, and custody settlement. */
export async function withPluginModelCatalogWorker<T>(
  options: BranchAgentDatabaseOptions,
  prepare: boolean,
  operation: (
    scope: Pick<SqliteWorkerStore<PluginModelCatalogCredentialOperations>, "execute">,
  ) => Promise<T>,
): Promise<T> {
  const execution = captureBranchAgentDatabaseExecution(options);
  let worker: BranchAgentSqliteWorkerStore<PluginModelCatalogCredentialOperations> | undefined;
  try {
    if (prepare) {
      await runBranchAgentWorkerWrite(options, () =>
        execution.prepare({
          assertCurrent: () => execution.assertCurrent(),
          createAdmission(binding) {
            return () => ({
              nativeLocations: binding.nativeLocations,
              admission: createSqliteWorkerOperationAdmission((request, grant) => {
                binding.authorize(request);
                execution.assertCurrent();
                if (!grant()) {
                  throw new Error("Catalog database preparation authority expired");
                }
              }, binding.attachment),
            });
          },
        }),
      );
    }
    worker = await openBranchAgentSqliteWorkerStore<PluginModelCatalogCredentialOperations>(
      options,
      { execution },
      {
        moduleUrl: resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.pluginModelCatalogCredentials),
        input: undefined,
      },
    );
    return await worker.run(operation, () => execution.assertCurrent());
  } finally {
    try {
      await worker?.close();
    } finally {
      await execution.release();
    }
  }
}

/** Preparation retains read authority through worker settlement, without admitting a writer. */
export async function loadPersistedPluginModelCatalogs(
  agentDir: string,
  pluginIds?: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PersistedPluginModelCatalog[]> {
  if (pluginIds?.length === 0) {
    return [];
  }
  const env = cloneEnvWithPlatformSemantics(environment);
  const options = {
    agentId: resolveAuthProfileDatabaseOwnerId(agentDir),
    path: resolveAuthProfileDatabasePath(agentDir),
    env,
  };
  const identity = readDatabasePathIdentitySync(options.path);
  if (!identity.key.startsWith("file:")) {
    return [];
  }
  const root = captureBranchStateReadContext(resolveBranchStateSqlitePath(env));
  const controller = new AbortController();
  let reading: Promise<PersistedPluginModelCatalog[]> | undefined;
  const revoke = () => controller.abort(new Error("Plugin catalog read owner was revoked"));
  const close = async () => {
    revoke();
    await reading?.catch(() => undefined);
  };
  const assertCurrent = () => {
    controller.signal.throwIfAborted();
    root.admission.assertCurrent();
    root.maintenanceScope?.assertAdmission();
    assertExistingDatabaseIdentity(options.path, identity.key, identity.birthtime);
  };
  assertCurrent();
  const unregisterAgent = registerBranchAgentDatabaseAsyncResource({ ...options, revoke, close });
  let unregisterRoot: (() => void) | undefined;
  try {
    unregisterRoot = registerBranchStateDatabaseAsyncResource({
      close: async (closedIdentity) => {
        if (!closedIdentity || closedIdentity.key === root.admission.identity.key) {
          await close();
        }
      },
    });
    reading = runSqliteReadOnlyOperation(
      options.path,
      { type: "pluginCatalog.read", input: { agentId: options.agentId, pluginIds } },
      { source: "canonical", expectedIdentity: identity.key, env, signal: controller.signal },
    );
    const catalogs = await reading;
    assertCurrent();
    return catalogs;
  } finally {
    unregisterRoot?.();
    unregisterAgent();
  }
}

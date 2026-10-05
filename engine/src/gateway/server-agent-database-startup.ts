import { resolveAgentDir } from "../agents/agent-scope-config.js";
import { resolveAuthProfileDatabasePath } from "../agents/auth-profiles/sqlite.js";
import { resolveConfiguredAgentDatabaseTargets } from "../config/sessions/targets.js";
import type { BranchConfig } from "../config/types.branch.js";
import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";
import type { PluginRegistry } from "../plugins/registry-types.js";
import { withPluginRuntimeRegistryScope } from "../plugins/runtime/gateway-request-scope.js";
import { getSpawnBroker, runWithSpawnBroker } from "../process/spawn-broker/context.js";
import {
  AgentDatabasePreparationSupersededError,
  withAgentDatabasePreparationGuard,
} from "../state/agent-database-admission.js";
import type { getAgentDatabaseStartupAdmission } from "../state/agent-database-startup.js";
import { isSameBranchAgentDatabasePath } from "../state/branch-agent-db.paths.js";
import { runStartupModelPublication } from "./server-agent-database-startup.publication.js";

function assertAgentDatabaseConfiguration(
  cfg: BranchConfig,
  agentId: string,
  paths: readonly string[],
  env: NodeJS.ProcessEnv,
) {
  const configuredPaths = resolveConfiguredAgentDatabaseTargets(cfg, { env }).filter(
    (target) => target.agentId === agentId,
  );
  if (
    configuredPaths.length === 0 ||
    paths.some(
      (pathname) =>
        !configuredPaths.some((target) => isSameBranchAgentDatabasePath(target.path, pathname)),
    )
  ) {
    throw new Error(`Agent ${agentId} database configuration changed during startup inspection`);
  }
}

/** Finish only the deferred agent's preparation before its admission owner recovers it. */
export function activateGatewayAgentDatabaseStartup(params: {
  admission: ReturnType<typeof getAgentDatabaseStartupAdmission>;
  preparationReady: Promise<void>;
  getConfig: () => BranchConfig;
  getPluginRegistry: () => PluginRegistry;
  getPluginMetadataSnapshot: () => PluginMetadataSnapshot | undefined;
  isCurrent: () => boolean;
  log: { info: (message: string) => void; warn: (message: string) => void };
}): void {
  const broker = getSpawnBroker();
  params.admission?.activate({
    isCurrent: params.isCurrent,
    openAgent: ({ agentId, paths, env, signal, assertCurrent }) =>
      runWithSpawnBroker(broker, async () => {
        const [
          { captureBranchAgentDatabaseExecution },
          { runBranchAgentWorkerWrite },
          { createSqliteWorkerOperationAdmission },
        ] = await Promise.all([
          import("../state/branch-agent-execution.js"),
          import("../state/branch-agent-write-admission.js"),
          import("../infra/sqlite-worker-operation-admission.js"),
        ]);
        assertCurrent();
        let cfg = params.getConfig();
        assertAgentDatabaseConfiguration(cfg, agentId, paths, env);
        const assertOpenCurrent = () => {
          signal.throwIfAborted();
          assertCurrent();
          const currentConfig = params.getConfig();
          if (currentConfig !== cfg) {
            assertAgentDatabaseConfiguration(currentConfig, agentId, paths, env);
            cfg = currentConfig;
          }
        };
        for (const pathname of paths) {
          const options = { agentId, path: pathname, env };
          const execution = captureBranchAgentDatabaseExecution(options);
          try {
            await runBranchAgentWorkerWrite(
              options,
              () =>
                execution.prepare(
                  {
                    assertCurrent: assertOpenCurrent,
                    createAdmission: (binding) => () => ({
                      nativeLocations: binding.nativeLocations,
                      admission: createSqliteWorkerOperationAdmission((request, grant) => {
                        binding.authorize(request);
                        assertOpenCurrent();
                        if (!grant()) {
                          throw new Error(`Agent ${agentId} startup admission expired`);
                        }
                      }, binding.attachment),
                    }),
                  },
                  signal,
                ),
              undefined,
              signal,
            );
          } finally {
            await execution.release();
          }
        }
      }),
    prepareAgent: ({ agentId, paths, env, signal, assertCurrent }) =>
      runWithSpawnBroker(broker, async () => {
        await racePromiseWithAbortSignal(params.preparationReady, signal);
        const [
          { runStartupSessionMigration },
          { refreshPreparedModelRuntimeSnapshots, getPreparedModelRuntimeSnapshot },
          { listConfiguredOwnerInputs },
          {
            getActiveSecretsRuntimeSnapshot,
            getActiveSecretsRuntimeSnapshotRevision,
            refreshActiveSecretsRuntimeSnapshotForConfig,
          },
        ] = await Promise.all([
          import("./server-startup-session-migration.js"),
          import("../agents/prepared-model-runtime.js"),
          import("../agents/prepared-model-runtime.configured.js"),
          import("../secrets/runtime.js"),
        ]);
        assertCurrent();
        const beforeConfig = params.getConfig();
        const previousSecretsRevision = getActiveSecretsRuntimeSnapshotRevision();
        const previousSecrets = getActiveSecretsRuntimeSnapshot();
        assertAgentDatabaseConfiguration(beforeConfig, agentId, paths, env);
        if (
          !previousSecrets ||
          !(await refreshActiveSecretsRuntimeSnapshotForConfig({
            sourceConfig: previousSecrets.sourceConfig,
            includeAuthStoreRefs: true,
            assertCurrent: () => {
              signal.throwIfAborted();
              assertCurrent();
              if (
                !params.isCurrent() ||
                params.getConfig() !== beforeConfig ||
                getActiveSecretsRuntimeSnapshotRevision() !== previousSecretsRevision
              ) {
                throw new AgentDatabasePreparationSupersededError(
                  `Agent ${agentId} secrets preparation was superseded`,
                );
              }
            },
          }))
        ) {
          throw new Error(`Agent ${agentId} secrets preparation could not publish`);
        }
        const cfg = params.getConfig();
        const secretsRevision = getActiveSecretsRuntimeSnapshotRevision();
        const secrets = getActiveSecretsRuntimeSnapshot();
        const authDatabasePath = resolveAuthProfileDatabasePath(resolveAgentDir(cfg, agentId, env));
        if (secretsRevision !== previousSecretsRevision + 1) {
          throw new AgentDatabasePreparationSupersededError(
            `Agent ${agentId} secrets preparation was superseded`,
          );
        }
        if (
          !secrets?.authStores.some((entry) =>
            isSameBranchAgentDatabasePath(entry.databasePath, authDatabasePath),
          )
        ) {
          throw new Error(`Agent ${agentId} secrets preparation has not published its auth store`);
        }
        let preparedInput: ReturnType<typeof listConfiguredOwnerInputs>[number] | undefined;
        const assertPreparationCurrent = () => {
          signal.throwIfAborted();
          assertCurrent();
          if (
            !params.isCurrent() ||
            params.getConfig() !== cfg ||
            getActiveSecretsRuntimeSnapshotRevision() !== secretsRevision
          ) {
            throw new AgentDatabasePreparationSupersededError(
              `Agent ${agentId} startup preparation was superseded`,
            );
          }
          if (preparedInput && !getPreparedModelRuntimeSnapshot(preparedInput)) {
            throw new Error(`Agent ${agentId} model preparation has not published`);
          }
        };
        const agentIds = new Set([agentId]);
        assertPreparationCurrent();
        await withAgentDatabasePreparationGuard(assertPreparationCurrent, async () => {
          await runStartupSessionMigration({
            cfg,
            env,
            agentIds,
            assertCurrent: assertPreparationCurrent,
            log: params.log,
          });
          assertPreparationCurrent();
          const pluginMetadataSnapshot = params.getPluginMetadataSnapshot();
          await runStartupModelPublication(assertPreparationCurrent, (isPublicationCurrent) =>
            withPluginRuntimeRegistryScope(params.getPluginRegistry(), () =>
              refreshPreparedModelRuntimeSnapshots(cfg, {
                agentIds,
                catalogMode: "static",
                allowGatewaySubagentBinding: true,
                ...(pluginMetadataSnapshot ? { pluginMetadataSnapshot } : {}),
                isPublicationCurrent,
              }),
            ),
          );
          preparedInput = listConfiguredOwnerInputs(cfg, undefined, true).find(
            (input) => input.agentId === agentId,
          );
          if (!preparedInput) {
            throw new Error(`Agent ${agentId} model preparation is no longer configured`);
          }
          assertPreparationCurrent();
        });
      }),
  });
}

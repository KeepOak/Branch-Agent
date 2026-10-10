import { resolveAgentDir } from "../agents/agent-scope-config.js";
import { resolveAuthProfileDatabasePath } from "../agents/auth-profiles/sqlite.js";
import type { PreparedModelRuntimeInput } from "../agents/prepared-model-runtime.js";
import { resolveConfiguredAgentDatabaseTargets } from "../config/sessions/targets.js";
import type { BranchConfig } from "../config/types.branch.js";
import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
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

const log = createSubsystemLogger("gateway/covering-publication");

/**
 * Runs startup model publication under the preparation's currency check. A config or secrets
 * reload that supersedes the publication supersedes the whole preparation, so startup retries
 * it instead of leaving the agent degraded.
 */
/** Covering publications a startup attempt may repeat after leaving its agent out. */
const MAX_STARTUP_PUBLICATION_ROUNDS = 5;

export async function runStartupModelPublication(
  assertPreparationCurrent: () => void,
  publish: (isPublicationCurrent: () => boolean) => Promise<unknown>,
): Promise<void> {
  let superseded: unknown;
  try {
    await publish(() => {
      try {
        assertPreparationCurrent();
        return true;
      } catch (error) {
        superseded ??= error;
        return false;
      }
    });
  } catch (error) {
    if (superseded instanceof AgentDatabasePreparationSupersededError) {
      throw superseded;
    }
    throw error;
  }
}

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

/**
 * Startup's restart from scratch for one agent: its unsettled model builds, including one whose
 * work never settles, stop holding its next preparation back. Siblings' builds are untouched.
 */
export async function replaceStartupAgentModelPreparation(
  cfg: BranchConfig,
  agentId: string,
  env: NodeJS.ProcessEnv,
  reason: Error,
): Promise<boolean> {
  const { replacePreparedModelRuntimeAgentBuilds } =
    await import("../agents/prepared-model-runtime.js");
  return replacePreparedModelRuntimeAgentBuilds(resolveAgentDir(cfg, agentId, env), reason);
}

/**
 * Another publication that covers this agent (a sibling's preparation, a config or auth refresh)
 * hides its snapshot until that publication commits. Waits for it instead of calling this
 * preparation unpublished. "left-out" when the agent's snapshot is missing after such a
 * publication: a reload lists only admitted agents, so it retires a still-pending one's snapshot.
 */
export async function waitForCoveringModelPublication(
  agentId: string,
  input: PreparedModelRuntimeInput,
  signal: AbortSignal,
): Promise<"published" | "left-out" | "unpublished"> {
  const {
    describePendingPreparedModelRuntimeReplacement,
    getPendingPreparedModelRuntimeReplacement,
    getPreparedModelRuntimeSnapshot,
  } = await import("../agents/prepared-model-runtime.js");
  let covered = false;
  let waits = 0;
  for (
    let replacement = getPendingPreparedModelRuntimeReplacement(agentId);
    replacement && !getPreparedModelRuntimeSnapshot(input);
    replacement = getPendingPreparedModelRuntimeReplacement(agentId)
  ) {
    covered = true;
    waits += 1;
    if (waits === 1) {
      log.info(
        formatCoveringWaitStart(agentId, describePendingPreparedModelRuntimeReplacement(agentId)),
      );
    }
    await racePromiseWithAbortSignal(
      replacement.catch(() => undefined),
      signal,
    );
  }
  const outcome = getPreparedModelRuntimeSnapshot(input)
    ? "published"
    : covered
      ? "left-out"
      : "unpublished";
  if (covered) {
    log.info(formatCoveringWaitOutcome({ agentId, outcome, waits }));
  }
  return outcome;
}

/** Awaits every covering replacement still pending for this agent, so the snapshot it hides is restored. */
async function waitOutPendingReplacements(agentId: string, signal: AbortSignal): Promise<void> {
  const { getPendingPreparedModelRuntimeReplacement } =
    await import("../agents/prepared-model-runtime.js");
  for (
    let pending = getPendingPreparedModelRuntimeReplacement(agentId);
    pending;
    pending = getPendingPreparedModelRuntimeReplacement(agentId)
  ) {
    await racePromiseWithAbortSignal(
      pending.catch(() => undefined),
      signal,
    );
  }
}

async function isSnapshotPublished(input: PreparedModelRuntimeInput): Promise<boolean> {
  const { getPreparedModelRuntimeSnapshot } = await import("../agents/prepared-model-runtime.js");
  return getPreparedModelRuntimeSnapshot(input) !== undefined;
}

/** Trace text when an agent starts awaiting a covering publication. */
export function formatCoveringWaitStart(agentId: string, pending: string | undefined): string {
  return `agent ${agentId} awaits covering model publication; pending ${pending ?? "none"}`;
}

/** Trace text when a covering wait settles: its outcome and how many publications it waited on. */
export function formatCoveringWaitOutcome(params: {
  agentId: string;
  outcome: "published" | "left-out" | "unpublished";
  waits: number;
}): string {
  return `agent ${params.agentId} covering model publication ${params.outcome} after ${params.waits} wait(s)`;
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
  /**
   * Test seam: runs between the covering wait and the final check of a startup attempt.
   * Production leaves it unset, so nothing runs there.
   */
  afterCoveringWait?: (agentId: string) => void | Promise<void>;
}): void {
  const broker = getSpawnBroker();
  params.admission?.activate({
    isCurrent: params.isCurrent,
    replaceAgent: ({ agentId, env, reason }) =>
      replaceStartupAgentModelPreparation(params.getConfig(), agentId, env, reason),
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
          // A covering publication that left this still-pending agent out retired its snapshot;
          // publish it again within this attempt (its watchdog bounds the loop) rather than fail.
          // Each round is capped, so a publication that keeps leaving the agent out fails plainly.
          for (let round = 1; ; round += 1) {
            if (round > MAX_STARTUP_PUBLICATION_ROUNDS) {
              throw new Error(
                `Agent ${agentId} model publication was left out of ${MAX_STARTUP_PUBLICATION_ROUNDS} covering publications in a row`,
              );
            }
            preparedInput = undefined;
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
            const covering = await waitForCoveringModelPublication(agentId, preparedInput, signal);
            await params.afterCoveringWait?.(agentId);
            // A newer covering replacement may start right after this wait settles and hide the
            // snapshot this attempt just observed. Wait it out, then re-check, instead of failing.
            await waitOutPendingReplacements(agentId, signal);
            // A left-out round republishes only while the snapshot is still hidden.
            if (await isSnapshotPublished(preparedInput)) {
              break;
            }
            if (covering === "unpublished") {
              break;
            }
            params.log.info(
              `agent ${agentId} startup model publication was left out of a covering publication; publishing it again`,
            );
          }
          assertPreparationCurrent();
        });
      }),
  });
}

import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import { setConfiguredMcpServer, unsetConfiguredMcpServer } from "../agents/mcp-config-mutation.js";
import { withGroveMcpLifecycleLease } from "../agents/mcp-lifecycle-lease.js";
import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import {
  GROVE_MCP_REF_SCHEMA_VERSION,
  deleteGroveMcpServerRef,
  digestGroveMcpServer,
  planGroveMcpServerRemoval,
  readGroveMcpServerRefs,
  readGroveMcpServerRefsByName,
  upsertGroveMcpServerRef,
  type PersistedGroveMcpServerRef,
} from "./mcp.js";
import type { GroveManifest } from "./types.js";
import type { GroveUpdatePlan } from "./update-plan.js";
import { collectGroveRollbackFailures } from "./update-rollback.js";

export type GroveMcpUpdateExecution = {
  appliedNames: string[];
  rollback: () => Promise<void>;
};

export class GroveMcpUpdateError extends Error {
  constructor(
    message: string,
    readonly partial = false,
  ) {
    super(message);
    this.name = "GroveMcpUpdateError";
  }
}

export async function applyGroveMcpUpdate(
  updatePlan: GroveUpdatePlan,
  targetManifest: GroveManifest,
  options: BranchStateDatabaseOptions & {
    config: BranchConfig;
    sourceMcpServers: Record<string, Record<string, unknown>>;
    nowMs?: number;
    setServer?: typeof setConfiguredMcpServer;
    unsetServer?: typeof unsetConfiguredMcpServer;
    readRefs?: typeof readGroveMcpServerRefs;
    readRefsByName?: typeof readGroveMcpServerRefsByName;
    planRemoval?: (
      ref: PersistedGroveMcpServerRef,
      options: BranchStateDatabaseOptions,
    ) => { action: "remove" | "release" };
    upsertRef?: typeof upsertGroveMcpServerRef;
    deleteRef?: typeof deleteGroveMcpServerRef;
  },
): Promise<GroveMcpUpdateExecution> {
  const actions = updatePlan.actions.filter(
    (action) => action.kind === "mcpServer" && action.action !== "unchanged",
  );
  if (actions.length === 0) {
    return { appliedNames: [], rollback: async () => undefined };
  }
  const setServer = options.setServer ?? setConfiguredMcpServer;
  const unsetServer = options.unsetServer ?? unsetConfiguredMcpServer;
  const readRefs = options.readRefs ?? readGroveMcpServerRefs;
  const readRefsByName = options.readRefsByName ?? readGroveMcpServerRefsByName;
  const planRemoval = options.planRemoval ?? planGroveMcpServerRemoval;
  const upsertRef = options.upsertRef ?? upsertGroveMcpServerRef;
  const deleteRef = options.deleteRef ?? deleteGroveMcpServerRef;
  const currentServers = normalizeConfiguredMcpServers(options.sourceMcpServers);
  const undo: Array<() => Promise<void>> = [];
  const appliedNames: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  let configMutationUncertain = false;

  const rollback = async () => {
    const failures = await collectGroveRollbackFailures(undo.toReversed());
    if (failures.length > 0) {
      throw new GroveMcpUpdateError(failures.join("; "));
    }
  };

  try {
    for (const action of actions) {
      await withGroveMcpLifecycleLease(action.id, options, async () => {
        const name = action.id;
        const previousRef = readRefs(updatePlan.agentId, options).find(
          (candidate) => candidate.name === name,
        );
        const previousServer = currentServers[name];
        if (action.action === "add" && (previousServer || previousRef)) {
          throw new GroveMcpUpdateError(
            `MCP server ${JSON.stringify(name)} appeared after planning and was not claimed.`,
          );
        }
        if (previousServer && !previousRef) {
          throw new GroveMcpUpdateError(
            `MCP server ${JSON.stringify(name)} is not owned by this Grove.`,
          );
        }
        if (action.action === "release") {
          if (!previousRef) {
            throw new GroveMcpUpdateError(`MCP reference ${JSON.stringify(name)} disappeared.`);
          }
          const exactLiveConfig =
            previousServer !== undefined &&
            digestGroveMcpServer(previousServer) === previousRef.configDigest;
          if (exactLiveConfig && planRemoval(previousRef, options).action !== "release") {
            throw new GroveMcpUpdateError(
              `MCP server ${JSON.stringify(name)} is no longer safely releasable.`,
            );
          }
          deleteRef(updatePlan.agentId, name, options);
          undo.push(
            async () =>
              await withGroveMcpLifecycleLease(name, options, async () => {
                upsertRef(previousRef, options);
              }),
          );
          appliedNames.push(name);
          return;
        }
        if (action.action === "remove") {
          if (!previousServer || !previousRef) {
            throw new GroveMcpUpdateError(`MCP server ${JSON.stringify(name)} disappeared.`);
          }
          if (planRemoval(previousRef, options).action !== "remove") {
            throw new GroveMcpUpdateError(
              `MCP server ${JSON.stringify(name)} gained another owner after planning.`,
            );
          }
          upsertRef({ ...previousRef, status: "pending", updatedAtMs: nowMs }, options);
          configMutationUncertain = true;
          const removed = await unsetServer({
            name,
            expectedServer: previousServer,
            recordIndependentOwner: false,
          });
          configMutationUncertain = false;
          if (!removed.ok) {
            configMutationUncertain = true;
            upsertRef(previousRef, options);
            configMutationUncertain = false;
            throw new Error(removed.error);
          }
          undo.push(
            async () =>
              await withGroveMcpLifecycleLease(name, options, async () => {
                const restored = await setServer({
                  name,
                  server: previousServer,
                  createOnly: true,
                  recordIndependentOwner: false,
                });
                if (!restored.ok) {
                  throw new Error(restored.error);
                }
                upsertRef(previousRef, options);
              }),
          );
          deleteRef(updatePlan.agentId, name, options);
          appliedNames.push(name);
          return;
        }

        const targetServer = targetManifest.mcpServers[name];
        if (!targetServer) {
          throw new GroveMcpUpdateError(
            `Target MCP declaration ${JSON.stringify(name)} is missing.`,
          );
        }
        const targetRef: PersistedGroveMcpServerRef = {
          schemaVersion: GROVE_MCP_REF_SCHEMA_VERSION,
          agentId: updatePlan.agentId,
          name,
          configDigest: digestGroveMcpServer(targetServer),
          relationship: previousRef?.relationship ?? "managed",
          origin: previousRef?.origin ?? "grove-introduced",
          independentOwner: previousRef?.independentOwner ?? false,
          status: "pending",
          createdAtMs: previousRef?.createdAtMs ?? nowMs,
          updatedAtMs: nowMs,
        };
        upsertRef(targetRef, options);
        configMutationUncertain = true;
        const written = await setServer({
          name,
          server: targetServer,
          ...(previousServer ? { expectedServer: previousServer } : { createOnly: true }),
          recordIndependentOwner: false,
        });
        configMutationUncertain = false;
        if (!written.ok) {
          configMutationUncertain = true;
          if (previousRef) {
            upsertRef(previousRef, options);
          } else {
            deleteRef(updatePlan.agentId, name, options);
          }
          configMutationUncertain = false;
          throw new Error(written.error);
        }
        undo.push(
          async () =>
            await withGroveMcpLifecycleLease(name, options, async () => {
              const currentRefs = readRefsByName(name, options);
              const currentOwnRef = currentRefs.find(
                (candidate) => candidate.agentId === updatePlan.agentId,
              );
              const otherOwners = currentRefs.filter(
                (candidate) => candidate.agentId !== updatePlan.agentId,
              );
              if (
                otherOwners.length > 0 ||
                (currentOwnRef?.independentOwner && !targetRef.independentOwner)
              ) {
                throw new Error(
                  `MCP server ${JSON.stringify(name)} gained another owner during rollback; current configuration was retained.`,
                );
              }
              if (previousServer && previousRef) {
                const restored = await setServer({
                  name,
                  server: previousServer,
                  expectedServer: targetServer,
                  recordIndependentOwner: false,
                });
                if (!restored.ok) {
                  throw new Error(restored.error);
                }
                upsertRef(previousRef, options);
              } else {
                const removed = await unsetServer({
                  name,
                  expectedServer: targetServer,
                  recordIndependentOwner: false,
                });
                if (!removed.ok) {
                  throw new Error(removed.error);
                }
                deleteRef(updatePlan.agentId, name, options);
              }
            }),
        );
        upsertRef({ ...targetRef, status: "complete" }, options);
        appliedNames.push(name);
      });
    }
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new GroveMcpUpdateError(
        `${coerceErrorMessage(error)}; rollback failed: ${coerceErrorMessage(rollbackError)}`,
        true,
      );
    }
    throw new GroveMcpUpdateError(
      coerceErrorMessage(error),
      configMutationUncertain || (error instanceof GroveMcpUpdateError && error.partial),
    );
  }
  return { appliedNames, rollback };
}

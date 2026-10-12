import { createSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import { prepareBranchAgentDatabaseRegistrySnapshotRead } from "../../state/branch-agent-db-registry-listing.js";
import {
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "../../state/branch-agent-db.js";
import {
  isIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "../../state/branch-agent-db.paths.js";
import { captureBranchAgentDatabaseExecution } from "../../state/branch-agent-execution.js";
import {
  runBranchAgentWorkerWrite,
  runBranchAgentWriteAdmission,
} from "../../state/branch-agent-write-admission.js";
import { cloneEnvWithPlatformSemantics } from "../config-env-vars.js";
import { resolveStateDir } from "../state-dir.js";
import { SessionWorkStartInvalidatedError } from "./lifecycle.js";
import type { SessionAccessScope } from "./session-accessor.sqlite-contract.js";
import { resolveSqliteScope, toDatabaseOptions } from "./session-accessor.sqlite-scope.js";
import {
  SessionReactionLimitError,
  SessionReactionMessageMissingError,
  setSessionReactionInDatabase,
} from "./session-reaction-store.kernel.js";
import { listSessionReactionsInDatabase } from "./session-reaction-store.read.js";
import type {
  SessionReactionWrite,
  SetSessionReactionParams,
  StoredMessageReactionSummary,
} from "./session-reaction-store.types.js";
import { assertSessionStoreReadCandidate } from "./session-store-read-candidates.js";
import { captureSessionStoreReadCandidates } from "./session-store-target-inventory.js";
import { withSessionHistoryWorkerReadCandidates } from "./session-transcript-worker-resources.js";

export { SessionReactionLimitError, SessionReactionMessageMissingError };
export type { StoredMessageReactionSummary } from "./session-reaction-store.types.js";

export async function setSessionReactionAsync(
  scope: SessionAccessScope,
  params: SetSessionReactionParams & { assertCurrent?: () => void },
): Promise<SessionReactionWrite> {
  const { assertCurrent = () => undefined, ...reaction } = params;
  assertCurrent();
  const input = structuredClone(reaction);
  const env = cloneEnvWithPlatformSemantics(scope.env ?? process.env);
  env.BRANCH_STATE_DIR = resolveStateDir(env);
  // Resolve the logical key without consulting a custom store's native registry.
  const logical = resolveSqliteScope({ ...scope, storePath: undefined, env });
  const storePath =
    logical.path ?? scope.storePath ?? resolveBranchAgentSqlitePath(toDatabaseOptions(logical));
  if (isIncognitoBranchAgentSqlitePath(storePath, toDatabaseOptions(logical))) {
    // Process-held databases cannot be reopened in a worker; retain their sole native owner.
    const resolved = resolveSqliteScope({ ...scope, env });
    const options = toDatabaseOptions(resolved);
    return runBranchAgentWriteAdmission(
      options,
      () => {
        assertCurrent();
        return runBranchAgentWriteTransaction(
          (database) => setSessionReactionInDatabase(database, resolved.sessionKey, input),
          options,
          { operationLabel: "session.reaction.set" },
        );
      },
      true,
    );
  }
  const candidates = captureSessionStoreReadCandidates(storePath);
  const registryRead = prepareBranchAgentDatabaseRegistrySnapshotRead({ env });
  try {
    return await withSessionHistoryWorkerReadCandidates(candidates, async (discovery) => {
      const request = { agentId: logical.agentId, storePath, env };
      let selected = await discovery.readStoreTarget({
        ...request,
        registeredDatabases: { status: "deferred" },
      });
      let assertRegistryCurrent: (() => void) | undefined;
      if (selected.kind === "session-target-registry-required") {
        const registry = await registryRead.read();
        assertRegistryCurrent = registry.assertCurrent;
        registry.assertCurrent();
        discovery.assertCurrent();
        assertCurrent();
        selected = await discovery.readStoreTarget({
          ...request,
          registeredDatabases:
            registry.result.status === "available"
              ? registry.result.entries
              : { status: "unavailable" },
        });
      }
      if (selected.kind !== "session-store-target") {
        throw new Error("Reaction store could not resolve its database owner");
      }
      // Promotion invalidates the registry memo; the retained physical owner governs the write.
      assertRegistryCurrent?.();
      const sourcePath = selected.sourcePath;
      const options = { ...selected.database, env };
      const execution = captureBranchAgentDatabaseExecution(options);
      const assertHeld = () => {
        execution.assertCurrent();
        discovery.assertCurrent();
        assertSessionStoreReadCandidate(sourcePath, candidates);
        assertCurrent();
      };
      try {
        assertHeld();
        const result = await runBranchAgentWorkerWrite(options, () =>
          execution.runExisting(
            {
              assertCurrent: assertHeld,
              createAdmission(binding) {
                return () => ({
                  nativeLocations: binding.nativeLocations,
                  admission: createSqliteWorkerOperationAdmission((admissionRequest, grant) => {
                    binding.authorize(admissionRequest);
                    assertHeld();
                    if (!grant()) {
                      throw new Error("Reaction authority expired");
                    }
                  }, binding.attachment),
                });
              },
            },
            (worker) =>
              worker.execute({
                type: "session.reaction.set",
                input: { sessionKey: logical.sessionKey, params: input },
              }),
          ),
        );
        if (!result) {
          throw new SessionWorkStartInvalidatedError("session changed before reaction mutation");
        }
        return result;
      } finally {
        await execution.release();
      }
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "SessionReactionLimitError") {
        throw new SessionReactionLimitError();
      }
      if (error.name === "SessionReactionMessageMissingError") {
        throw new SessionReactionMessageMissingError();
      }
      if (error.name === "SessionWorkStartInvalidatedError") {
        throw new SessionWorkStartInvalidatedError(error.message);
      }
    }
    throw error;
  }
}

export function listSessionReactions(
  scope: SessionAccessScope,
  params: { sessionId: string },
): Record<string, StoredMessageReactionSummary[]> {
  const resolved = resolveSqliteScope(scope);
  return listSessionReactionsInDatabase(
    openBranchAgentDatabase(toDatabaseOptions(resolved)),
    resolved.sessionKey,
    params,
  );
}

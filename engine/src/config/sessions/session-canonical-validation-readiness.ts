import type { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { isGatewayExternallySupervised } from "../../infra/gateway-supervision.js";
import {
  executeSqliteQuerySync,
  getNodeSqliteKysely,
  sqliteStringSet,
} from "../../infra/kysely-sync.js";
import { runSqliteReadOperationSync } from "../../infra/sqlite-schema-facts.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  isBranchAgentDatabasePathCurrent,
  readBranchAgentDatabaseIdentity,
} from "../../state/branch-agent-db-identity.js";
import { retainBranchAgentDatabaseReadOnly } from "../../state/branch-agent-db-readonly.js";
import {
  getBranchAgentDatabaseValidation,
  hasBranchAgentCanonicalValidation,
  markBranchAgentCanonicalValidation,
} from "../../state/branch-agent-db-validation-cache.js";
import type { DB } from "../../state/branch-agent-db.generated.js";
import {
  isIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
  type BranchAgentDatabaseOptions,
} from "../../state/branch-agent-db.js";
import {
  clearBranchSessionRowQuarantines,
  listBranchSessionRowQuarantineKeys,
} from "../../state/branch-session-row-quarantine.js";
import {
  resolveBranchStateDirForDatabasePath,
  resolveBranchStateSqlitePath,
} from "../../state/branch-state-db.paths.js";
import { withSqliteReclamationAuthorization } from "./session-accessor.sqlite-reclamation-commit.js";
import {
  withSqliteReclamationWorker,
  type ClaimedReclamationWorkerUse,
} from "./session-accessor.sqlite-reclamation-worker.js";
import { runExclusiveSqliteSessionWrite } from "./session-accessor.sqlite-scope.js";
import { withSqliteMutationWorkerLifetime } from "./session-accessor.sqlite-worker-request.js";
import { hasPendingCanonicalSessionValidation } from "./session-canonical-validation.js";

const MAX_BATCH_ROWS = 128;
const MAX_BATCH_BYTES = 1024 * 1024;
// Isolated damage is set aside; more than this per database is systemic and refuses.
export const MAX_STARTUP_QUARANTINED_SESSION_ROWS = 8;
const CONTENTION_BACKOFF_MS = [0, 25, 100, 250] as const;
const log = createSubsystemLogger("sessions/canonical-validation");
// Share only active runtime drains; native close/reopen creates a different owner.
const runtimeDrains = new WeakMap<DatabaseSync, Promise<void>>();

/** Certify dirty persisted rows before startup maintenance reads their full entries. */
export async function certifySessionCanonicalValidationPending(
  options: BranchAgentDatabaseOptions,
  withWorker: ClaimedReclamationWorkerUse = withSqliteReclamationWorker,
  assertCurrentOwner?: () => void,
  policy: { quarantineInvalidRows?: boolean } = {},
): Promise<void> {
  assertCurrentOwner?.();
  const sourceEnv = options.env ?? process.env;
  const pathname = resolveBranchAgentSqlitePath(options);
  if (isIncognitoBranchAgentSqlitePath(pathname, options)) {
    return;
  }
  const retained = retainBranchAgentDatabaseReadOnly(options);
  if (!retained.found) {
    return;
  }
  const { database, claim } = retained;
  let oversizedRows = 0;
  let quarantinedRows = 0;
  try {
    const env = {
      BRANCH_STATE_DIR: resolveBranchStateDirForDatabasePath(
        options.database?.path ?? resolveBranchStateSqlitePath(sourceEnv),
      ),
      ...(isGatewayExternallySupervised(sourceEnv) ? { BRANCH_SUPERVISOR_MODE: "external" } : {}),
    };
    const databasePath = readBranchAgentDatabaseIdentity(database).filename;
    // Retained records still consume the database's allowance on every restart.
    // Keep newly quarantined rows separate so the warning describes this drain only.
    let previouslyQuarantinedRows = 0;
    if (policy.quarantineInvalidRows) {
      retireAbsentSessionRowQuarantines(database.db, { env, databasePath });
      try {
        previouslyQuarantinedRows = listBranchSessionRowQuarantineKeys({
          env,
          databasePath,
        }).length;
      } catch {
        // An unreadable store cannot establish an allowance. Admit no new quarantines,
        // preserving the worker's original requires-repair refusal for an invalid row.
        previouslyQuarantinedRows = MAX_STARTUP_QUARANTINED_SESSION_ROWS;
      }
    }
    const readiness = runSqliteReadOperationSync(
      database.db,
      () => {
        const initialize = !hasBranchAgentCanonicalValidation(database);
        return {
          initialize,
          hasWork: initialize || hasPendingCanonicalSessionValidation(database),
        };
      },
      "fresh",
    );
    if (!readiness.hasWork) {
      return;
    }
    let initializeCanonicalValidation = readiness.initialize;
    const databaseOptions = {
      agentId: normalizeAgentId(options.agentId),
      path: databasePath,
      env,
    };
    await withSqliteMutationWorkerLifetime(
      databaseOptions,
      async ({ assertCurrent: assertReadinessCurrent }) => {
        const shareRuntimeDrain =
          withWorker === withSqliteReclamationWorker && assertCurrentOwner === undefined;
        const drain = async () => {
          let contendedBatches = 0;
          let validation = getBranchAgentDatabaseValidation(database);
          while (true) {
            assertCurrentOwner?.();
            assertReadinessCurrent();
            claim.assertCurrent();
            const result = await withSqliteMutationWorkerLifetime(
              databaseOptions,
              async ({ assertCurrent, commitGate, signal }) =>
                await withWorker(
                  databaseOptions,
                  claim,
                  async (worker) => {
                    const assertCommitAllowed = () => {
                      assertCurrentOwner?.();
                      assertReadinessCurrent();
                      assertCurrent();
                      worker.assertCurrent(databaseOptions, claim);
                    };
                    assertCommitAllowed();
                    return await withSqliteReclamationAuthorization(
                      commitGate,
                      database.db,
                      assertCommitAllowed,
                      (authorize) =>
                        worker.runCanonicalValidation({
                          databaseOptions,
                          claim,
                          validationOwner: { database, isCurrent: claim.isCurrent },
                          commitGate,
                          maxRows: MAX_BATCH_ROWS,
                          maxBytes: MAX_BATCH_BYTES,
                          initializeCanonicalValidation,
                          ...(policy.quarantineInvalidRows
                            ? {
                                quarantineInvalidRows: Math.max(
                                  0,
                                  MAX_STARTUP_QUARANTINED_SESSION_ROWS -
                                    previouslyQuarantinedRows -
                                    quarantinedRows,
                                ),
                              }
                            : {}),
                          onCommitRequest: authorize,
                          withWriteAdmission: async (run, reclamationAdmission) =>
                            await runExclusiveSqliteSessionWrite(
                              databaseOptions,
                              async () => {
                                let refusal: { error: unknown } | undefined;
                                try {
                                  assertCommitAllowed();
                                } catch (error) {
                                  refusal = { error };
                                }
                                await run(refusal);
                              },
                              "session.canonical-validation.certify",
                              { reclamationAdmission },
                              "worker",
                              signal,
                            ),
                        }),
                    );
                  },
                  () => {
                    assertCurrentOwner?.();
                    assertReadinessCurrent();
                    assertCurrent();
                    claim.assertCurrent();
                  },
                  signal,
                ),
            );
            assertCurrentOwner?.();
            assertReadinessCurrent();
            claim.assertCurrent();
            const currentValidation = getBranchAgentDatabaseValidation(database);
            if (!currentValidation || (validation && validation !== currentValidation)) {
              throw new Error("SQLite session reclamation database owner is no longer current");
            }
            validation ??= currentValidation;
            oversizedRows += result.oversizedRows;
            quarantinedRows += result.quarantinedRows;
            if (!result.hasMore) {
              if (
                !isBranchAgentDatabasePathCurrent(database) ||
                !markBranchAgentCanonicalValidation(database)
              ) {
                throw new Error("SQLite session reclamation database owner is no longer current");
              }
              return;
            }
            if (initializeCanonicalValidation) {
              initializeCanonicalValidation = false;
              continue;
            }
            if (result.certifiedRows === 0) {
              const waitMs = CONTENTION_BACKOFF_MS[contendedBatches] ?? 250;
              contendedBatches = Math.min(contendedBatches + 1, CONTENTION_BACKOFF_MS.length - 1);
              await delay(waitMs);
            } else {
              contendedBatches = 0;
            }
            // The next batch rejoins both existing FIFOs behind already queued work.
          }
        };
        let completion: Promise<void> | undefined;
        let ownsDrain = false;
        try {
          assertCurrentOwner?.();
          assertReadinessCurrent();
          claim.assertCurrent();
          completion = shareRuntimeDrain ? runtimeDrains.get(database.db) : undefined;
          ownsDrain = completion === undefined;
          if (!completion) {
            completion = drain();
            if (shareRuntimeDrain) {
              runtimeDrains.set(database.db, completion);
            }
          }
          await completion;
          assertCurrentOwner?.();
          assertReadinessCurrent();
          claim.assertCurrent();
          if (
            !isBranchAgentDatabasePathCurrent(database) ||
            !hasBranchAgentCanonicalValidation(database)
          ) {
            throw new Error("SQLite session reclamation database owner is no longer current");
          }
        } finally {
          if (ownsDrain && runtimeDrains.get(database.db) === completion) {
            runtimeDrains.delete(database.db);
          }
          claim.release();
        }
      },
    );
    // Only a completed drain lets startup continue; a refusal above skips this.
    if (quarantinedRows > 0) {
      log.warn(
        "Quarantined invalid persisted session rows; startup continues and branch doctor --fix can repair them",
        {
          path: pathname,
          rows: quarantinedRows,
          sessionKeys: listBranchSessionRowQuarantineKeys({ env, databasePath }).slice(
            0,
            MAX_STARTUP_QUARANTINED_SESSION_ROWS,
          ),
        },
      );
    }
  } finally {
    claim.release();
    if (oversizedRows > 0) {
      log.warn("Canonical session validation processed oversized rows in its Worker", {
        path: pathname,
        rows: oversizedRows,
        batchByteLimit: MAX_BATCH_BYTES,
      });
    }
  }
}

/** Records for rows deleted or archived since they were quarantined no longer name a repair. */
function retireAbsentSessionRowQuarantines(
  db: DatabaseSync,
  target: { env: NodeJS.ProcessEnv; databasePath: string },
): void {
  try {
    const recorded = listBranchSessionRowQuarantineKeys(target);
    if (recorded.length === 0) {
      return;
    }
    const present = new Set(
      runSqliteReadOperationSync(
        db,
        () =>
          executeSqliteQuerySync(
            db,
            getNodeSqliteKysely<Pick<DB, "session_nodes">>(db)
              .selectFrom("session_nodes")
              .select("session_key")
              .where("session_key", "in", sqliteStringSet(recorded)),
          ).rows.map((row) => row.session_key),
        "fresh",
      ),
    );
    clearBranchSessionRowQuarantines({
      ...target,
      sessionKeys: recorded.filter((key) => !present.has(key)),
    });
  } catch {
    // A stale record only over-reports a repaired row; startup readiness still decides.
  }
}

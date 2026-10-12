import type { Result } from "@branch/normalization-core/result";
import {
  assertTransactionUsable,
  runSqliteWorkerTransactionSync,
} from "../infra/sqlite-transaction.js";
import { isSqliteWorkerError, type SqliteWorkerBackend } from "../infra/sqlite-worker-contract.js";
import type { SqliteWorkerDatabaseContext } from "../infra/sqlite-worker-database-context.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "../state/branch-state-db-contract.js";
import {
  encodeBranchStateWorkerError,
  type BranchStateWorkerErrorPayload,
} from "../state/branch-state-worker-error.js";
import {
  prepareSessionProgressCardWrite,
  writePreparedSessionProgressCard,
} from "./progress-card-store.js";

export type ProgressCardWorkerOperations = {
  put: {
    input: Parameters<typeof prepareSessionProgressCardWrite>[0] & { sessionKey: string };
    output: Result<
      ReturnType<typeof writePreparedSessionProgressCard>,
      BranchStateWorkerErrorPayload
    >;
  };
};

/** Borrows the canonical agent writer connection; reset and incognito share its row kernel. */
export function bindSqliteWorkerBackend(
  _input: undefined,
  context: SqliteWorkerDatabaseContext,
): SqliteWorkerBackend<ProgressCardWorkerOperations> {
  const db = context.database;
  return {
    execute(command) {
      const input = prepareSessionProgressCardWrite(command.input);
      try {
        const value = runSqliteWorkerTransactionSync(
          context,
          () => writePreparedSessionProgressCard(db, command.input.sessionKey, input),
          {
            databaseLabel: context.databasePath,
            operationLabel: "progress-card.put",
            busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
          },
        );
        return { ok: true, value };
      } catch (error) {
        // The broker retains the original host error for a refused grant.
        if (isSqliteWorkerError(error, "closed")) {
          throw error;
        }
        // An uncertain native outcome stays with the broker and never becomes a replayable refusal.
        assertTransactionUsable(db);
        if (!db.isOpen || db.isTransaction) {
          throw error;
        }
        const failure = encodeBranchStateWorkerError(error, { includeOrdinary: true });
        if (!failure) {
          throw error;
        }
        return { ok: false, error: failure };
      }
    },
    assertSettled() {
      assertTransactionUsable(db);
      if (db.isTransaction) {
        throw new Error("Progress-card transaction did not settle");
      }
    },
    close() {},
  };
}

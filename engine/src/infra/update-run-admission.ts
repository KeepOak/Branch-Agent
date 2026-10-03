import type { DatabaseSync } from "node:sqlite";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db-contract.js";
import { runExistingBranchStateWriteTransaction } from "../state/branch-state-db-existing-write.js";
import { withExistingBranchStateDatabaseArtifactPreservingReadOnly } from "../state/branch-state-db-readonly.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { isBranchStateWriteContentionError } from "../state/branch-state-ownership.js";
import { formatErrorMessage } from "./errors.js";
import { assertSqliteIntegrity, SqliteRepairableForeignKeyError } from "./sqlite-integrity.js";

export class UpdateRunAdmissionBusyError extends Error {
  readonly reason = "update-ledger-busy";
}

export function runUpdateRunAdmission<T>(
  operation: (db: DatabaseSync, recoveryChanges: string[]) => T,
  options: BranchStateDatabaseOptions,
  contract: {
    schemaSql: string;
    busyTimeoutMs?: number;
    recoverTaskDeliveryOrphans: boolean;
  },
): T {
  if (options.database) {
    throw new Error("Update run admission requires its own writable connection");
  }
  // Admission precedes managed shutdown. An older serving Gateway must not
  // force diagnostic writes through this candidate's runtime migrations.
  // Once a file exists, failures remain failures; never retry via bootstrap.
  // Pre-v19 orphan recovery must remain here: schema-19 table retirement waits
  // for managed shutdown and cannot run just to open the old driver's ledger.
  const inspection = withExistingBranchStateDatabaseArtifactPreservingReadOnly(({ db, path }) => {
    try {
      assertSqliteIntegrity(db, path);
      return { repairable: undefined };
    } catch (error) {
      if (!(error instanceof SqliteRepairableForeignKeyError)) {
        throw error;
      }
      return { repairable: error };
    }
  }, options);
  if (inspection) {
    if (inspection.repairable && !contract.recoverTaskDeliveryOrphans) {
      throw inspection.repairable;
    }
    try {
      return runExistingBranchStateWriteTransaction(
        ({ db, recoveryChanges }) => operation(db, recoveryChanges),
        options,
        {
          schemaSql: contract.schemaSql,
          operationLabel: "update.run",
          busyTimeoutMs: contract.busyTimeoutMs,
          initializeAdditiveSchema: true,
          ...(inspection.repairable ? { recoverTaskDeliveryOrphans: true } : {}),
        },
      );
    } catch (error) {
      if (inspection.repairable) {
        throw new Error(
          `${inspection.repairable.message} Update admission could not complete recovery: ${formatErrorMessage(error)}`,
          { cause: error },
        );
      }
      if (isBranchStateWriteContentionError(error)) {
        throw new UpdateRunAdmissionBusyError(
          "Update history is busy. Admission was deferred; previous history is unchanged. Retry `branch update` after the current database writer finishes.",
          { cause: error },
        );
      }
      throw error;
    }
  }
  return runBranchStateWriteTransaction(
    ({ db }) => {
      // Feature-local, idempotent DDL shares the write transaction; a failed write also rolls back first use.
      db.exec(contract.schemaSql); // sqlite-allow-raw -- Canonical first-use ledger DDL in its write transaction.
      return operation(db, []);
    },
    options,
    { operationLabel: "update.run" },
  );
}

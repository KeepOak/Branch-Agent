import { deferSqlitePostCommitPublication } from "../../infra/sqlite-post-commit.js";
import { requestSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import { getSqliteWorkerStateContext } from "../../infra/sqlite-worker-state-context.js";
import type { BranchStateDatabase } from "../../state/branch-state-db-contract.js";
import { runBranchStateWriteTransaction } from "../../state/branch-state-db.js";
import type { CronStoreFile } from "../types.js";
import { readCronJobNamesInDatabase } from "./job-name.kernel.js";
import { retainCronReceiptAuthorityPublication } from "./receipt-authority-publication.js";
import { readCronStoreFingerprints } from "./row-codec.js";
import { serializeCronSaveError } from "./save-error.js";
import type { CronStoreSaveWorkerOperations } from "./save-worker.types.js";
import { saveCronStoreChangesInDatabase, saveCronStoreInDatabase } from "./save.kernel.js";

type SaveCommand = {
  [Key in keyof CronStoreSaveWorkerOperations]: {
    type: Key;
    input: CronStoreSaveWorkerOperations[Key]["input"];
  };
}[keyof CronStoreSaveWorkerOperations];

export function executeCronStoreSaveCommand(command: SaveCommand, database: BranchStateDatabase) {
  let committed = false;
  try {
    const result = runBranchStateWriteTransaction(
      ({ db }) => {
        requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
        let value: CronStoreFile | undefined;
        if (command.type === "cron.saveChanges") {
          value = saveCronStoreChangesInDatabase(
            db,
            command.input.storeKey,
            command.input.storeKey,
            command.input.changes,
            command.input.options,
          );
        } else {
          saveCronStoreInDatabase(
            database,
            command.input.storeKey,
            command.input.store,
            command.input.options,
          );
        }
        deferSqlitePostCommitPublication(db, () => {
          committed = true;
        });
        retainCronReceiptAuthorityPublication(db);
        return {
          value,
          names: readCronJobNamesInDatabase(db, undefined, command.input.storeKey),
          ...readCronStoreFingerprints(db, command.input.storeKey),
        };
      },
      { database, env: getSqliteWorkerStateContext().environment },
      command.type === "cron.saveChanges" ? { operationLabel: "cron.config-mutation" } : undefined,
    );
    return { ok: true as const, ...result, committed };
  } catch (error) {
    return {
      ok: false as const,
      error: serializeCronSaveError(error, command.input.storeKey),
      committed,
    };
  }
}

import { requestSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../../state/branch-state-db.js";
import {
  insertSandboxRegistryRowIfMissingInDatabase,
  type SandboxRegistryInsert,
} from "./registry.kernel.js";

export function importSandboxRegistryRow(
  row: SandboxRegistryInsert,
  options: BranchStateDatabaseOptions,
): void {
  runBranchStateWriteTransaction(({ db }) => {
    requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
    insertSandboxRegistryRowIfMissingInDatabase(db, row);
    requestSqliteWorkerOperationAdmission({ stage: "commit", facts: undefined });
  }, options);
}

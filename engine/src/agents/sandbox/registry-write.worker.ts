import { requestSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../../state/branch-state-db.js";
import { writeSandboxRegistryInDatabase, type SandboxRegistryWrite } from "./registry.kernel.js";

export function writeSandboxRegistry(
  write: SandboxRegistryWrite,
  options: BranchStateDatabaseOptions,
): void {
  runBranchStateWriteTransaction(
    ({ db }) => {
      requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
      writeSandboxRegistryInDatabase(db, write);
      requestSqliteWorkerOperationAdmission({ stage: "commit", facts: undefined });
    },
    options,
    { operationLabel: `sandbox.registry.${write.operation}` },
  );
}

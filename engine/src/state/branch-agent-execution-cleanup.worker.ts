import type { SqliteWorkerCommand } from "../infra/sqlite-worker-contract.js";
import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { releaseExitedBranchAgentDatabaseLeaseInDatabase } from "./branch-agent-db-lease.js";
import { requireBranchStateDatabaseIdentity } from "./branch-state-db-cache.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";
import { runBranchStateWriteTransaction } from "./branch-state-db.js";
import type { BranchStateWorkerCleanupOperations } from "./branch-state-worker-contract.js";

export function executeAgentDatabaseCleanupCommand(
  command: SqliteWorkerCommand<
    Pick<BranchStateWorkerCleanupOperations, "agentDatabases.releaseExitedLease">
  >,
  database: BranchStateDatabase,
  env: NodeJS.ProcessEnv,
): void {
  runBranchStateWriteTransaction(
    (current) => {
      if (
        current.path !== command.input.sharedStatePath ||
        requireBranchStateDatabaseIdentity(current).key !== command.input.sharedStateIdentity
      ) {
        throw new Error("Retired agent cleanup cannot adopt a replacement shared database");
      }
      releaseExitedBranchAgentDatabaseLeaseInDatabase(current.db, command.input, () =>
        requestSqliteWorkerOperationAdmission({
          stage: "prepare",
          facts: "agent-integrity-invalidated",
        }),
      );
    },
    { database, path: database.path, env },
  );
}

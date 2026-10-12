import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { readSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { withSqlitePostCommitPublications } from "../infra/sqlite-post-commit.js";
import {
  runSqliteImmediateTransaction,
  type SqliteTransactionOptions,
} from "../infra/sqlite-transaction.js";
import {
  assertAgentDeletionDatabaseCleanupAccess,
  getAgentDeletionDatabaseCleanup,
} from "./agent-deletion-cleanup.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";
import {
  agentDatabaseLifecycle as cache,
  retainAgentDatabase,
} from "./branch-agent-db-lifecycle.js";
import { ensureBranchAgentDatabasePermissions } from "./branch-agent-db-permissions.js";
import { getBranchAgentDatabaseIfOpen, openBranchAgentDatabase } from "./branch-agent-db.js";

/** Yield only for BEGIN admission; admitted writes and publications are never replayed. */
export async function runBranchAgentWriteWithYieldingAdmission<T>(
  operation: (database: BranchAgentDatabase) => T,
  options: BranchAgentDatabaseOptions,
  transactionOptions: Pick<
    SqliteTransactionOptions,
    "operationLabel" | "slowTransactionHoldMs"
  > = {},
): Promise<T | undefined> {
  const captured = {
    ...options,
    env: cloneEnvWithPlatformSemantics(options.env ?? process.env),
  };
  const database = openBranchAgentDatabase(captured);
  captured.path = database.path;
  const release = retainAgentDatabase(database.db);
  try {
    return await runSqliteImmediateTransaction(
      database.db,
      async () => () => {
        assertAgentDeletionDatabaseCleanupAccess(database, captured);
        const result = operation(database);
        if (!cache.incognito.has(database)) {
          ensureBranchAgentDatabasePermissions(database.path, captured);
        }
        return result;
      },
      {
        ...transactionOptions,
        busyTimeoutMs: readSqliteBusyTimeout(database.db),
        databaseLabel: database.path,
        operationLabel: transactionOptions.operationLabel ?? "agent.write",
        withCommit: getAgentDeletionDatabaseCleanup(captured)?.withCommit,
      },
      (write) => {
        if (getBranchAgentDatabaseIfOpen(captured) !== database) {
          throw new Error(`Agent database closed or replaced before write: ${database.path}`);
        }
        // BEGIN yields; admitted writes retain the connection's bounded COMMIT wait for readers.
        return withSqlitePostCommitPublications(database.db, write);
      },
    );
  } finally {
    release();
  }
}

import { normalizeAgentId } from "../routing/session-key.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";
import {
  createBranchAgentDatabaseClaim,
  type BranchAgentDatabaseClaim,
} from "./branch-agent-db-identity.js";
import { withCommittedBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly-companion.js";
import {
  readBranchAgentDatabase,
  type BranchAgentDatabaseReadOnlyResult,
  type BranchAgentReadOnlyDatabase,
} from "./branch-agent-db-readonly-open.js";
import {
  retainCachedBranchAgentDatabaseReadOnly,
  withScopedBranchAgentDatabaseReadOnly,
  type BranchAgentDatabaseReadOnlyBehavior,
} from "./branch-agent-db-readonly-scope.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertSupportedAgentSchemaVersion,
} from "./branch-agent-db-schema-read.js";
import {
  borrowBranchAgentDatabase,
  getBranchAgentDatabaseIfOpen,
} from "./branch-agent-db.js";
import {
  isIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.paths.js";

export {
  openBranchAgentDatabaseReadOnly,
  type BranchAgentReadOnlyDatabase,
  type BranchAgentReadOnlyDatabaseHandle,
  type BranchAgentDatabaseReadOnlyOpenResult,
} from "./branch-agent-db-readonly-open.js";

/**
 * Look up a process-held handle without adopting writer-side failures.
 *
 * Read-only reads are meant to survive a latched open failure or an ownership
 * mismatch that only the writable lifecycle cares about; those callers fall
 * back to a fresh connection, which reports the precise reason.
 */
function findOpenAgentDatabase(
  options: BranchAgentDatabaseOptions,
): BranchAgentDatabase | undefined {
  try {
    return getBranchAgentDatabaseIfOpen(options);
  } catch {
    return undefined;
  }
}

/** Retain an existing store across awaits without materializing a writable database. */
export function retainBranchAgentDatabaseReadOnly(
  options: BranchAgentDatabaseOptions,
):
  | { found: true; database: BranchAgentReadOnlyDatabase; claim: BranchAgentDatabaseClaim }
  | { found: false; reason: "database-missing" | "schema-missing" } {
  const opened = findOpenAgentDatabase(options);
  if (opened && !opened.db.isTransaction) {
    const borrowed = borrowBranchAgentDatabase(options);
    return {
      found: true,
      database: opened,
      claim: createBranchAgentDatabaseClaim(opened, borrowed.release),
    };
  }
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveBranchAgentSqlitePath({ ...options, agentId });
  return retainCachedBranchAgentDatabaseReadOnly({ ...options, agentId, path: pathname });
}

/** Read agent state without creating, registering, migrating, or joining its writable lifecycle. */
export function withBranchAgentDatabaseReadOnly<T>(
  operation: (database: BranchAgentReadOnlyDatabase) => T,
  options: BranchAgentDatabaseOptions,
  behavior: BranchAgentDatabaseReadOnlyBehavior = {},
): BranchAgentDatabaseReadOnlyResult<T> {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveBranchAgentSqlitePath({ ...options, agentId });
  if (isIncognitoBranchAgentSqlitePath(pathname, { agentId, env: options.env })) {
    // Read-only misses must not create process-lifetime handles; only creation and
    // write paths may materialize the process-held incognito database.
    const database = getBranchAgentDatabaseIfOpen({ ...options, agentId });
    if (database && behavior.allowExtension) {
      throw new Error("Extension-capable read-only access is unavailable for incognito databases.");
    }
    return database
      ? readBranchAgentDatabase(database, operation)
      : { found: false, reason: "database-missing" };
  }
  // Borrow only outside a transaction so readers see committed rows.
  // The writer owns reused handles; this call closes only fresh connections.
  const processOpened = behavior.allowExtension
    ? undefined
    : findOpenAgentDatabase({ ...options, agentId });
  if (processOpened?.db.isTransaction) {
    return withCommittedBranchAgentDatabaseReadOnly(processOpened, operation, {
      ...options,
      agentId,
    });
  }
  if (!processOpened) {
    return withScopedBranchAgentDatabaseReadOnly(
      operation,
      { ...options, agentId, path: pathname },
      behavior,
    );
  }
  // The handle's admission owner refreshes these facts after DDL or a foreign commit.
  const userVersion = assertSupportedAgentSchemaVersion(processOpened.db, pathname);
  assertCanonicalAgentPersistenceVersion(processOpened.db, pathname, userVersion);
  return readBranchAgentDatabase(processOpened, operation);
}

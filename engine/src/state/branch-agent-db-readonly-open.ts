import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { normalizeAgentId } from "@branch/normalization-core/agent-id";
import { isDeletedAgentDatabasePath } from "../infra/agent-database-readers.js";
import { enableNodeSqliteKyselyStatementCache } from "../infra/kysely-sync-cache-state.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { sqlitePrimaryResultCode } from "../infra/sqlite-error-diagnostics.js";
import { admitSqliteSchema, runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { assertCanonicalSessionValidationSchema } from "./branch-agent-canonical-validation-schema.js";
import type { BranchAgentDatabaseOptions } from "./branch-agent-db-contract.js";
import { registerBranchAgentDatabaseIdentity } from "./branch-agent-db-identity.js";
import {
  classifyBranchAgentDatabaseReadError,
  recordBranchAgentDatabaseReadOpenFailure,
} from "./branch-agent-db-read-error.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertExistingAgentSchemaOwner,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./branch-agent-db-schema-read.js";
import { assertAgentDatabaseTerminalOpenAllowed } from "./branch-agent-db-terminal.js";
import {
  isIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.paths.js";
import { readBranchDatabaseQuarantineFailure } from "./branch-quarantine-store.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db-contract.js";

export type BranchAgentReadOnlyDatabase = {
  agentId: string;
  db: DatabaseSync;
  path: string;
};

export type BranchAgentReadOnlyDatabaseHandle = BranchAgentReadOnlyDatabase & {
  close: () => void;
};

export type BranchAgentDatabaseReadOnlyOpenResult =
  | { found: true; database: BranchAgentReadOnlyDatabaseHandle }
  | { found: false; reason: "database-missing" | "schema-missing" };

export type BranchAgentDatabaseReadOnlyResult<T> =
  | { found: true; value: T }
  | { found: false; reason: "database-missing" | "schema-missing" };

export function readBranchAgentDatabase<T>(
  database: BranchAgentReadOnlyDatabase,
  operation: (database: BranchAgentReadOnlyDatabase) => T,
): { found: true; value: T } {
  try {
    return { found: true, value: operation(database) };
  } catch (error) {
    throw sqlitePrimaryResultCode(error) === 1
      ? classifyBranchAgentDatabaseReadError(database.db, error)
      : error;
  }
}

/** Recheck committed admission facts before using an existing read-only connection. */
export function hasBranchAgentReadOnlySchema(database: BranchAgentReadOnlyDatabase): boolean {
  return runSqliteReadOperationSync(
    database.db,
    () => {
      const userVersion = assertSupportedAgentSchemaVersion(database.db, database.path);
      assertCanonicalAgentPersistenceVersion(database.db, database.path, userVersion);
      const schemaMeta = readExistingAgentSchemaMeta(database.db);
      if (!schemaMeta) {
        return false;
      }
      assertExistingAgentSchemaOwner(schemaMeta, database.agentId, database.path);
      assertCanonicalSessionValidationSchema(database.db);
      return true;
    },
    "fresh",
  );
}

/** Fresh-only callers do not need the writable runtime's process-held connection cache. */
export function withFreshBranchAgentDatabaseReadOnly<T>(
  operation: (database: BranchAgentReadOnlyDatabase) => T,
  options: BranchAgentDatabaseOptions,
  behavior: { allowExtension?: boolean } = {},
): BranchAgentDatabaseReadOnlyResult<T> {
  const opened = openBranchAgentDatabaseReadOnly(options, behavior);
  if (!opened.found) {
    return opened;
  }
  try {
    return readBranchAgentDatabase(opened.database, operation);
  } finally {
    opened.database.close();
  }
}

/** Open one existing agent database without creating, registering, migrating, or adopting it. */
export function openBranchAgentDatabaseReadOnly(
  options: BranchAgentDatabaseOptions,
  behavior: { allowExtension?: boolean } = {},
): BranchAgentDatabaseReadOnlyOpenResult {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveBranchAgentSqlitePath({ ...options, agentId });
  if (isIncognitoBranchAgentSqlitePath(pathname, { agentId, env: options.env })) {
    return { found: false, reason: "database-missing" };
  }
  if (isDeletedAgentDatabasePath(pathname) || !fs.existsSync(pathname)) {
    return { found: false, reason: "database-missing" };
  }
  // Verified-corrupt generations stay quarantined for reads as well as writes:
  // the process terminal latch and the persisted generation-aware quarantine
  // row must both clear before any fresh read-only physical open proceeds.
  assertAgentDatabaseTerminalOpenAllowed(pathname);
  const persistedQuarantine = readBranchDatabaseQuarantineFailure("agent", pathname, {
    env: options.env,
  });
  if (persistedQuarantine) {
    recordBranchAgentDatabaseReadOpenFailure(persistedQuarantine);
    throw persistedQuarantine;
  }
  // Lock policy belongs to the open: node:sqlite has no busy handler until one
  // is set, so a later PRAGMA leaves every earlier statement unprotected.
  let db: DatabaseSync;
  try {
    db = openNodeSqliteDatabase(pathname, {
      readOnly: true,
      timeout: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
      ...(behavior.allowExtension ? { allowExtension: true } : {}),
    });
  } catch (error) {
    recordBranchAgentDatabaseReadOpenFailure(error);
    throw error;
  }
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    if (db.isOpen) {
      db.close();
    }
    closed = true;
  };
  try {
    enableNodeSqliteKyselyStatementCache(db);
    registerBranchAgentDatabaseIdentity(db);
    const database = { agentId, db, path: pathname, close };
    admitSqliteSchema(db);
    if (!hasBranchAgentReadOnlySchema(database)) {
      close();
      return { found: false, reason: "schema-missing" };
    }
    return { found: true, database };
  } catch (error) {
    close();
    recordBranchAgentDatabaseReadOpenFailure(error);
    throw error;
  }
}

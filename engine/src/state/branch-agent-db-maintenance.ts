import type { DatabaseSync } from "node:sqlite";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  enableNodeSqliteKyselyStatementCache,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { repairDoctorSqliteIndexCorruption } from "../infra/sqlite-index-recovery.js";
import { runSqliteIntegrityOperationInWorker } from "../infra/sqlite-integrity-operation.js";
import { configureSqliteMaintenanceCache } from "../infra/sqlite-maintenance-cache.js";
import { SqliteSchemaMismatchError } from "../infra/sqlite-schema-issues.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  AGENT_MEDIA_SCHEMA_VERSION,
  BRANCH_AGENT_SCHEMA_VERSION,
} from "./branch-agent-db-contract.js";
import {
  assertAgentDatabaseMaintenanceAuthority,
  invalidateBranchAgentDatabaseIntegrityBeforeMutation,
} from "./branch-agent-db-lease.js";
import {
  assertExistingAgentSchemaOwner,
  assertBranchAgentSchemaContains,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./branch-agent-db-schema-helpers.js";
import { ensureBranchAgentDatabaseSchemaSteps } from "./branch-agent-db-schema.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "./branch-agent-schema.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db.js";
import type { BranchStateLeaseContext } from "./branch-state-lease.js";

const agentDbLog = createSubsystemLogger("state/agent-db");

/** Require exact agent ownership without requiring the latest schema. */
export function assertBranchAgentDatabaseOwner(
  database: DatabaseSync,
  options: { agentId: string; pathname: string },
): NonNullable<ReturnType<typeof readExistingAgentSchemaMeta>> {
  const agentId = normalizeAgentId(options.agentId);
  const metadata = readExistingAgentSchemaMeta(database);
  if (!metadata) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${options.pathname} has no schema ownership metadata. Run branch doctor --fix to inspect and repair its ownership.`,
    );
  }
  assertExistingAgentSchemaOwner(metadata, agentId, options.pathname);
  if (metadata.agentId !== agentId) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${options.pathname} belongs to agent ${metadata.agentId}; requested agent ${agentId}.`,
    );
  }
  return metadata;
}

/** Require the exact agent owner and schema before offline file maintenance. */
export function assertBranchAgentDatabaseForMaintenance(
  database: DatabaseSync,
  options: { agentId: string; pathname: string; allowStartupIndexRepair?: boolean },
): void {
  const metadata = assertBranchAgentDatabaseOwner(database, options);

  const userVersion = assertSupportedAgentSchemaVersion(database, options.pathname);
  if (userVersion !== BRANCH_AGENT_SCHEMA_VERSION) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${options.pathname} uses schema version ${userVersion}; run branch doctor --fix before compacting it.`,
    );
  }
  if (metadata.schemaVersion !== BRANCH_AGENT_SCHEMA_VERSION) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${options.pathname} metadata schema version ${metadata.schemaVersion ?? "invalid"} does not match ${BRANCH_AGENT_SCHEMA_VERSION}; run branch doctor --fix before compacting it.`,
    );
  }
  assertBranchAgentSchemaContains(
    database,
    options.pathname,
    BRANCH_AGENT_SCHEMA_SQL,
    "current",
    options.allowStartupIndexRepair,
  );
}

/** Upgrade or repair a supported owned schema before strict offline maintenance. */
export async function migrateBranchAgentDatabaseForMaintenance(
  options: { agentId: string; pathname: string },
  maintenance: BranchStateLeaseContext,
): Promise<void> {
  const agentId = normalizeAgentId(options.agentId);
  const pathname = options.pathname;
  const env = { ...process.env };
  const assertOwned = () => {
    maintenance.signal.throwIfAborted();
    assertAgentDatabaseMaintenanceAuthority(maintenance);
  };
  assertOwned();
  invalidateBranchAgentDatabaseIntegrityBeforeMutation(pathname, env);
  const database = openNodeSqliteDatabase(pathname);
  try {
    configureSqliteMaintenanceCache(database);
    enableNodeSqliteKyselyStatementCache(database);
    database.exec(`PRAGMA busy_timeout = ${BRANCH_SQLITE_BUSY_TIMEOUT_MS};`);
    const metadata = readExistingAgentSchemaMeta(database);
    if (!metadata) {
      return;
    }
    assertExistingAgentSchemaOwner(metadata, agentId, pathname);
    assertSupportedAgentSchemaVersion(database, pathname);
    const userVersion = readSqliteUserVersion(database);
    const metadataVersion = metadata.schemaVersion;
    const hasCurrentVersion =
      userVersion === BRANCH_AGENT_SCHEMA_VERSION &&
      metadataVersion === BRANCH_AGENT_SCHEMA_VERSION;
    const hasSupportedOlderVersion =
      userVersion >= 1 &&
      userVersion < BRANCH_AGENT_SCHEMA_VERSION &&
      metadataVersion === userVersion;
    if (!hasCurrentVersion && !hasSupportedOlderVersion) {
      return;
    }
    const repairIndexes = () => {
      const changes = repairDoctorSqliteIndexCorruption(database, pathname, {
        label: `agent ${agentId}`,
        assertCurrent: () => {
          assertOwned();
          assertBranchAgentDatabaseOwner(database, { agentId, pathname });
          assertSupportedAgentSchemaVersion(database, pathname);
        },
      });
      for (const change of changes) {
        agentDbLog.warn(change);
      }
      return changes.length > 0;
    };
    if (userVersion === AGENT_MEDIA_SCHEMA_VERSION) {
      // v17 checks integrity inside its additive-schema transaction; repair only
      // physical indexes here so rejected migrations still roll schema changes back.
      repairIndexes();
    }
    const operation = ensureBranchAgentDatabaseSchemaSteps(database, {
      agentId,
      path: pathname,
      env,
    });
    await runSqliteIntegrityOperationInWorker(operation, {
      busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
      signal: maintenance.signal,
      beforeResume: () => {
        assertOwned();
        assertExistingAgentSchemaOwner(readExistingAgentSchemaMeta(database), agentId, pathname);
        assertSupportedAgentSchemaVersion(database, pathname);
      },
      repairIntegrityError: repairIndexes,
    });
    assertOwned();
    assertBranchAgentDatabaseForMaintenance(database, {
      agentId,
      pathname,
    });
  } finally {
    clearNodeSqliteKyselyCacheForDatabase(database);
    database.close();
  }
}

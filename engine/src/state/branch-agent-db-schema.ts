import type { DatabaseSync } from "node:sqlite";
import {
  ensureMemoryChunkProvenance,
  ensureMemoryRecallMetadataSchema,
  migrateMemoryIndexSourcesIdentity,
  migrateMemoryIndexStorage,
} from "../../packages/memory-host-sdk/src/host/memory-schema.js";
import { migrateSessionCostUsageRollupStorage } from "../infra/session-cost-usage-cache-migration.js";
import {
  repairCanonicalSqliteIndexes,
  verifyAndRepairCanonicalSqliteIndexes,
  verifyAndRepairCanonicalSqliteIndexSteps,
} from "../infra/sqlite-index-schema.js";
import {
  assertSqliteIntegrity,
  runSqliteIntegrityOperationSync,
  sqliteIntegrityCheckSteps,
  type SqliteIntegrityDiagnostics,
  type SqliteIntegrityOperation,
} from "../infra/sqlite-integrity.js";
import { migrateSqliteSchemaToStrictInTransaction } from "../infra/sqlite-strict.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { configureSqlitePreSchemaPragmas } from "../infra/sqlite-wal.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { assertAgentDeletionRecoveryAllowsMutation } from "./agent-deletion-journal-recovery.js";
import {
  assertAgentDeletionPathFence,
  prepareAgentDeletionPathFence,
} from "./agent-deletion-journal.js";
import { ensureBranchAgentBoardSchemaInTransaction } from "./branch-agent-board-schema.js";
import {
  canonicalSessionValidationSchemaSql,
  withoutCanonicalSessionValidationSchema,
} from "./branch-agent-canonical-validation-schema.js";
import {
  AGENT_MEDIA_SCHEMA_VERSION,
  AGENT_STORAGE_SCHEMA_VERSION,
  CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION,
  BRANCH_AGENT_SCHEMA_VERSION,
  TRANSCRIPT_FTS_ROW_SCHEMA_VERSION,
  type BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";
import * as maintenanceAuthority from "./branch-agent-db-lease.js";
import {
  backfillBranchAgentSchema,
  migrateBranchAgentSchema,
} from "./branch-agent-db-legacy-schema.js";
import { persistAgentSchemaMetadata } from "./branch-agent-db-metadata-write.js";
import { ensureBranchAgentDatabasePermissions } from "./branch-agent-db-permissions.js";
import { registerBranchAgentDatabase } from "./branch-agent-db-registry.js";
import {
  getBranchAgentMigrationSchema,
  assertExistingAgentSchemaOwner,
  assertBranchAgentCurrentRuntimeSchema,
  assertSupportedAgentSchemaVersion,
  assertAgentSchemaVersion,
  hasPendingCurrentVersionAgentDatabaseMigration,
  hasPendingMemoryChunkMetadataMigration,
  migrateRetiredAgentStateLeaseSchema,
  ensureSessionKeyContractSchemaInTransaction,
  ensureSessionReactionsSchemaInTransaction,
  readExistingAgentSchemaMeta,
  repairAndAssertBranchAgentV14SchemaForMigration,
} from "./branch-agent-db-schema-helpers.js";
import {
  backfillSessionConversations,
  dropLegacyRuntimeJournalSchemas,
  dropLegacySessionTranscriptSearchSchema,
  ensureSessionAdditiveColumns,
  ensureSessionEntryValidityProjection,
  migrateConversationDeliveryTargetColumn,
  migrateSessionCreatorNamespaces,
  migrateSessionTranscriptActiveProjection,
  migrateSessionTranscriptGenerations,
} from "./branch-agent-db-session-migrations.js";
import { migrateSessionNodesAndWindows } from "./branch-agent-db-session-nodes-migration.js";
import { backfillSessionEntryProvenance } from "./branch-agent-db-session-provenance.js";
import {
  isPersistentBranchAgentDatabasePath,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.paths.js";
import {
  migrateSessionParticipantsSchema,
  withLegacySessionParticipantsSchema,
} from "./branch-agent-participants-migration.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "./branch-agent-schema.js";
import { migrateSessionEntrySnapshotsInTransaction } from "./branch-agent-session-snapshots-migration.js";
import {
  SESSION_ENTRY_SNAPSHOTS_SCHEMA_VERSION,
  withoutSessionEntrySnapshotsSchema,
} from "./branch-agent-session-snapshots-schema.js";
import { withLegacyAgentStorageSchema } from "./branch-agent-storage-schema.js";
import { migrateDeployedTranscriptFtsRowsInTransaction } from "./branch-agent-transcript-fts-schema.js";
import { migrateTranscriptPayloadStorageInTransaction } from "./branch-agent-transcript-payload-migration.js";
import {
  canReuseBranchAgentIntegrityVerification,
  type BranchAgentIntegrityVerification,
} from "./branch-quarantine-store.js";
import { getBranchDatabaseMaintenanceScope } from "./branch-state-db-async-lifecycle.js";
import {
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  runBranchStateWriteTransaction,
} from "./branch-state-db.js";

const agentDbLog = createSubsystemLogger("state/agent-db");

function dropLegacyMemoryIndexSchema(db: DatabaseSync): void {
  const columns = db.prepare("PRAGMA table_info(memory_index_sources)").all();
  const hasLegacySourceColumns = columns.some((row) => row.name === "source_kind");
  if (!hasLegacySourceColumns) {
    return;
  }
  // Memory indexes are derived cache data; v1 used a different key shape.
  db.exec(`
    DROP TABLE IF EXISTS memory_index_chunks_fts;
    DROP TABLE IF EXISTS memory_index_chunks;
    DROP TABLE IF EXISTS memory_index_sources;
  `);
}

function migrateMemoryChunkMetadataSchema(db: DatabaseSync): void {
  ensureMemoryRecallMetadataSchema(db);
  ensureMemoryChunkProvenance(db);
}

export function* agentDatabaseIntegrityBeforeMutationSteps(
  database: DatabaseSync,
  agentId: string,
  pathname: string,
  diagnostics?: SqliteIntegrityDiagnostics,
  verification?: BranchAgentIntegrityVerification,
  reuseRuntimeIntegrity = false,
  runtimeAdmission = false,
): SqliteIntegrityOperation<boolean> {
  database.exec(`PRAGMA busy_timeout = ${BRANCH_SQLITE_BUSY_TIMEOUT_MS};`);
  const userVersion = readSqliteUserVersion(database);
  const hasApplicationSchema = database
    .prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1")
    .get();
  const migrationPending =
    (userVersion === 0 && hasApplicationSchema !== undefined) ||
    (userVersion > 0 && userVersion < BRANCH_AGENT_SCHEMA_VERSION);
  if (migrationPending) {
    agentDbLog.info("agent database schema migration pending; verifying integrity first", {
      fromVersion: userVersion,
      path: pathname,
      toVersion: BRANCH_AGENT_SCHEMA_VERSION,
    });
  }
  const hasPendingCurrentVersionMigration =
    userVersion === BRANCH_AGENT_SCHEMA_VERSION &&
    hasPendingCurrentVersionAgentDatabaseMigration(database);
  if (userVersion === BRANCH_AGENT_SCHEMA_VERSION && !hasPendingCurrentVersionMigration) {
    const startedAt = performance.now();
    const reuseIntegrity =
      reuseRuntimeIntegrity ||
      canReuseBranchAgentIntegrityVerification(
        pathname,
        verification,
        migrationPending || hasPendingCurrentVersionMigration,
      );
    const rebuiltIndexes = yield* verifyAndRepairCanonicalSqliteIndexSteps(
      database,
      pathname,
      BRANCH_AGENT_SCHEMA_SQL,
      {
        allowMissingColumns: true,
        validateAfterRepair: () =>
          assertBranchAgentCurrentRuntimeSchema(database, { agentId, pathname }),
        diagnostics,
        // Include sqlite_schema for the freelist check and every discovered shadow/extension table.
        integrityTables:
          runtimeAdmission && !reuseIntegrity
            ? [
                { name: "sqlite_schema" },
                ...database
                  .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
                  .all(),
              ].map(({ name }) => ({
                table: String(name),
                check: name === "transcript_events" ? "quick_check" : "integrity_check",
              }))
            : undefined,
        reuseIntegrity,
      },
    );
    if (rebuiltIndexes.length > 0) {
      agentDbLog.warn(
        `Rebuilt canonical agent SQLite indexes for ${agentId} (${pathname}): ${rebuiltIndexes.join(", ")}`,
        {
          agentId,
          path: pathname,
          indexes: rebuiltIndexes,
          elapsedMs: Math.floor(performance.now() - startedAt),
        },
      );
    }
    assertBranchAgentCurrentRuntimeSchema(database, { agentId, pathname });
  } else if (
    userVersion === 0 &&
    !hasApplicationSchema &&
    database.prepare("PRAGMA page_count").get()?.page_count === 0
  ) {
    // Publish a fresh empty database's owner before another local caller resolves its store.
    // Yielding first leaves an occupied, unowned file that custom selectors must avoid.
    assertSqliteIntegrity(database, pathname);
  } else {
    // Pending migrations cannot inherit an earlier runtime verification.
    yield* sqliteIntegrityCheckSteps(database, pathname, diagnostics);
  }
  return hasPendingCurrentVersionMigration;
}

function seedCanonicalSessionValidationPending(db: DatabaseSync): void {
  // Migration records work only; the canonical owner validates and certifies row contents.
  db.exec(`
    INSERT INTO session_canonical_validation_pending (session_key)
    SELECT node.session_key FROM session_nodes AS node
    WHERE NOT EXISTS (
      SELECT 1 FROM session_canonical_validation_pending AS pending
      WHERE pending.session_key = node.session_key
    );
  `);
}

function migrateAgentStorageInTransaction(
  db: DatabaseSync,
  schemaSql: string,
  previousVersion: number,
): void {
  maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
  if (previousVersion === TRANSCRIPT_FTS_ROW_SCHEMA_VERSION) {
    migrateDeployedTranscriptFtsRowsInTransaction(db, schemaSql);
  } else if (
    db.prepare("SELECT 1 FROM sqlite_schema WHERE name = ?").get("session_transcript_fts_rows")
  ) {
    throw new Error(
      "Transcript FTS row map already exists before the schema-23 storage migration.",
    );
  }
  maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
  migrateTranscriptPayloadStorageInTransaction(db);
  maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
  migrateMemoryIndexStorage(db, {
    renewAuthority: maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent,
  });
  maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
  migrateSessionCostUsageRollupStorage(
    db,
    maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent,
  );
  maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
  db.exec(schemaSql);
  // Keep native 64-bit rowids, duplicate message IDs and FTS tie ordering intact.
  if (previousVersion !== TRANSCRIPT_FTS_ROW_SCHEMA_VERSION) {
    db.exec(`
    INSERT INTO session_transcript_fts_rows (id, session_id, message_id)
    SELECT rowid, session_id, message_id FROM session_transcript_fts;
  `);
  }
}

function finishAgentSchemaMigration(
  db: DatabaseSync,
  agentId: string,
  pathname: string,
  targetVersion: number,
  schemaSql: string,
  requiresMaintenance: boolean,
  assertMigration: () => void,
): void {
  repairCanonicalSqliteIndexes(db, pathname, schemaSql, {
    verifyPhysicalIntegrity: false,
  });
  db.exec(`PRAGMA user_version = ${targetVersion};`);
  persistAgentSchemaMetadata(db, agentId, targetVersion);
  assertAgentSchemaVersion(db, { agentId, pathname, version: targetVersion }, schemaSql);
  if (requiresMaintenance && db.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error(`Agent schema migration failed foreign key validation for ${pathname}.`);
  }
  assertMigration();
}

type AgentSchemaMutationGuard = <T>(run: () => T) => T;

function ensureAgentSchema(
  db: DatabaseSync,
  agentId: string,
  pathname: string,
  targetVersion = BRANCH_AGENT_SCHEMA_VERSION,
  withMutation: AgentSchemaMutationGuard = (run) => run(),
): void {
  const schemaSql = getBranchAgentMigrationSchema(targetVersion);
  const originalVersion = readSqliteUserVersion(db);
  const schemaMigration =
    originalVersion < targetVersion &&
    (originalVersion > 0 || readExistingAgentSchemaMeta(db) !== null);
  const identityMigration = targetVersion >= 18 && schemaMigration;
  const assertMigration = () => {
    if (!schemaMigration) {
      return;
    }
    if (identityMigration) {
      maintenanceAuthority.assertAgentDatabaseMaintenanceAuthority();
    }
    getBranchDatabaseMaintenanceScope()?.assertAgentSchemaMigration({
      agentId,
      path: pathname,
      foundVersion: originalVersion,
      supportedVersion: targetVersion,
    });
  };
  assertMigration();
  // FK enforcement must be off before BEGIN: PRAGMA foreign_keys is a silent
  // no-op inside a transaction, and legacy owner-table rebuilds would otherwise
  // cascade-delete their children. Steady-state enforcement is restored below.
  db.exec("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = OFF;");
  try {
    const mutate = () => {
      // Repeat preflight ownership/version gates inside the write transaction;
      // concurrent openers must not overwrite another agent after the scan.
      // Role/ownership gates before version: user_version is only meaningful
      // within one schema role, and the global state DB now carries version 3.
      assertExistingAgentSchemaOwner(readExistingAgentSchemaMeta(db), agentId, pathname);
      assertSupportedAgentSchemaVersion(db, pathname);
      const previousVersion = readSqliteUserVersion(db);
      if (identityMigration && readExistingAgentSchemaMeta(db)?.schemaVersion !== previousVersion) {
        throw new Error(
          `Agent schema markers disagree for ${pathname}; repair ownership metadata before migration.`,
        );
      }
      if (previousVersion > targetVersion) {
        throw new Error(
          `Branch Agent agent database ${pathname} uses schema version ${previousVersion}; expected at most ${targetVersion} for this migration.`,
        );
      }
      const isEmptyDatabase =
        previousVersion === 0 &&
        readExistingAgentSchemaMeta(db) === null &&
        !db.prepare("SELECT 1 FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
      const requiresStorageMigration =
        !isEmptyDatabase &&
        previousVersion < AGENT_STORAGE_SCHEMA_VERSION &&
        targetVersion >= AGENT_STORAGE_SCHEMA_VERSION;
      const requiresSnapshotMigration =
        !isEmptyDatabase &&
        previousVersion < SESSION_ENTRY_SNAPSHOTS_SCHEMA_VERSION &&
        targetVersion >= SESSION_ENTRY_SNAPSHOTS_SCHEMA_VERSION;
      const storageSchemaSql = requiresSnapshotMigration
        ? withoutSessionEntrySnapshotsSchema(schemaSql)
        : schemaSql;
      const migrationSchemaSql = requiresStorageMigration
        ? withLegacyAgentStorageSchema(storageSchemaSql, previousVersion)
        : storageSchemaSql;
      if (
        previousVersion < targetVersion &&
        previousVersion >= CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION - 1 &&
        previousVersion < SESSION_ENTRY_SNAPSHOTS_SCHEMA_VERSION &&
        targetVersion >= CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION
      ) {
        if (previousVersion >= CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION) {
          // Keep schema-21's admitted additive repairs before its exact-shape
          // preflight; the storage cutover must not retire those upgrade paths.
          migrateRetiredAgentStateLeaseSchema(db, pathname, targetVersion);
          ensureSessionAdditiveColumns(db);
          ensureSessionEntryValidityProjection(db);
          ensureSessionKeyContractSchemaInTransaction(db);
          if (hasPendingMemoryChunkMetadataMigration(db)) {
            migrateMemoryChunkMetadataSchema(db);
          }
        }
        const previousSchema =
          previousVersion < CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION
            ? withoutCanonicalSessionValidationSchema(migrationSchemaSql)
            : migrationSchemaSql;
        repairCanonicalSqliteIndexes(db, pathname, previousSchema, {
          verifyPhysicalIntegrity: false,
        });
        assertAgentSchemaVersion(
          db,
          { agentId, pathname, version: previousVersion },
          previousSchema,
        );
        if (previousVersion < CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION) {
          db.exec(canonicalSessionValidationSchemaSql(migrationSchemaSql));
          seedCanonicalSessionValidationPending(db);
        }
        if (requiresStorageMigration) {
          migrateAgentStorageInTransaction(db, storageSchemaSql, previousVersion);
        }
        if (requiresSnapshotMigration) {
          migrateSessionEntrySnapshotsInTransaction(db);
        }
        finishAgentSchemaMigration(
          db,
          agentId,
          pathname,
          targetVersion,
          schemaSql,
          identityMigration,
          assertMigration,
        );
        return;
      }
      if (previousVersion === AGENT_MEDIA_SCHEMA_VERSION) {
        const legacySql = withLegacySessionParticipantsSchema(
          withLegacyAgentStorageSchema(BRANCH_AGENT_SCHEMA_SQL),
        );
        ensureSessionAdditiveColumns(db);
        verifyAndRepairCanonicalSqliteIndexes(db, pathname, legacySql, {
          validateAfterRepair: () => {
            assertAgentSchemaVersion(
              db,
              { agentId, pathname, version: AGENT_MEDIA_SCHEMA_VERSION },
              legacySql,
            );
          },
        });
      }
      migrateRetiredAgentStateLeaseSchema(db, pathname, targetVersion);
      if (previousVersion === targetVersion) {
        ensureSessionAdditiveColumns(db);
        ensureSessionEntryValidityProjection(db);
        ensureSessionKeyContractSchemaInTransaction(db);
        ensureSessionReactionsSchemaInTransaction(db);
        if (hasPendingMemoryChunkMetadataMigration(db)) {
          migrateMemoryChunkMetadataSchema(db);
          db.exec(schemaSql);
        }
        // Repeat index repair before the transactional schema assertion so a
        // concurrent opener cannot turn repairable drift into a hard refusal.
        repairCanonicalSqliteIndexes(db, pathname, schemaSql, {
          verifyPhysicalIntegrity: false,
        });
        persistAgentSchemaMetadata(db, agentId, targetVersion);
        assertAgentSchemaVersion(db, { agentId, pathname, version: targetVersion }, schemaSql);
        maintenanceAuthority.assertAgentDatabaseMaintenanceAuthorityIfPresent();
        return;
      } else if (previousVersion === 14) {
        repairAndAssertBranchAgentV14SchemaForMigration(db, { agentId, pathname });
      }
      // Structure-gated helpers converge both legacy memory schema lineages.
      dropLegacyMemoryIndexSchema(db);
      dropLegacySessionTranscriptSearchSchema(db);
      dropLegacyRuntimeJournalSchemas(db);
      maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
      migrateMemoryIndexSourcesIdentity(db);
      migrateBranchAgentSchema(db);
      migrateConversationDeliveryTargetColumn(db);
      backfillBranchAgentSchema(db, previousVersion);
      // Remove after 2026-10-01: drop the pre-v11 conversation backfill once schema 11 is the support floor.
      if (previousVersion < 11) {
        backfillSessionConversations(db);
      }
      backfillSessionEntryProvenance(db, previousVersion);
      migrateSessionNodesAndWindows(db, previousVersion);
      maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
      ensureSessionAdditiveColumns(db);
      ensureSessionEntryValidityProjection(db);
      if (targetVersion >= 18 && previousVersion < 18) {
        migrateSessionParticipantsSchema(db, pathname);
      }
      if (targetVersion >= 19) {
        migrateSessionCreatorNamespaces(db, previousVersion);
      }
      maintenanceAuthority.renewAgentDatabaseMaintenanceAuthorityIfPresent();
      db.exec(migrationSchemaSql);
      migrateMemoryChunkMetadataSchema(db);
      if (previousVersion < targetVersion) {
        ensureBranchAgentBoardSchemaInTransaction(db);
      }
      migrateSessionTranscriptGenerations(db, previousVersion);
      migrateSessionTranscriptActiveProjection(db, previousVersion);
      if (previousVersion < 11) {
        migrateSqliteSchemaToStrictInTransaction(db, migrationSchemaSql, {
          databaseLabel: pathname,
        });
      }
      if (
        previousVersion < CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION &&
        targetVersion >= CANONICAL_SESSION_VALIDATION_SCHEMA_VERSION
      ) {
        seedCanonicalSessionValidationPending(db);
      }
      if (requiresStorageMigration) {
        migrateAgentStorageInTransaction(db, storageSchemaSql, previousVersion);
      }
      if (requiresSnapshotMigration) {
        migrateSessionEntrySnapshotsInTransaction(db);
      }
      finishAgentSchemaMigration(
        db,
        agentId,
        pathname,
        targetVersion,
        schemaSql,
        identityMigration,
        assertMigration,
      );
    };
    runSqliteImmediateTransactionSync(db, () => withMutation(mutate), {
      databaseLabel: pathname,
      operationLabel: "agent.schema.ensure",
      withCommit: withMutation,
    });
  } finally {
    if (db.isOpen) {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

/** Initialize agent schema/ownership metadata on an independently managed connection. */
export function ensureBranchAgentDatabaseSchema(
  db: DatabaseSync,
  options: BranchAgentDatabaseOptions & { register?: boolean },
): void {
  runSqliteIntegrityOperationSync(ensureBranchAgentDatabaseSchemaSteps(db, options));
}

/** Share one schema sequence between synchronous callers and leased maintenance. */
export function* ensureBranchAgentDatabaseSchemaSteps(
  db: DatabaseSync,
  options: BranchAgentDatabaseOptions & { register?: boolean },
): SqliteIntegrityOperation<void> {
  const agentId = normalizeAgentId(options.agentId);
  const databaseOptions = { ...options, agentId };
  const pathname = resolveBranchAgentSqlitePath(databaseOptions);
  const deletionFence =
    databaseOptions.register === true &&
    isPersistentBranchAgentDatabasePath(pathname, databaseOptions.env)
      ? prepareAgentDeletionPathFence(
          { agentId, path: pathname },
          { env: databaseOptions.env },
          "maintenance",
        )
      : undefined;
  const withRegistrationFence = <T>(run: () => T): T => {
    if (!deletionFence) {
      return run();
    }
    return runBranchStateWriteTransaction(
      (database) => {
        assertAgentDeletionRecoveryAllowsMutation(database, pathname);
        assertAgentDeletionPathFence(database, deletionFence);
        return run();
      },
      { env: databaseOptions.env, initializationAgentPaths: [pathname] },
    );
  };
  // Validate history before touching an independent store, without holding shared -> agent locks.
  withRegistrationFence(() => undefined);
  if (db.location()) {
    maintenanceAuthority.invalidateBranchAgentDatabaseIntegrityBeforeMutation(
      pathname,
      databaseOptions.env,
    );
  }
  ensureBranchAgentDatabasePermissions(pathname, databaseOptions);
  db.exec(`PRAGMA busy_timeout = ${BRANCH_SQLITE_BUSY_TIMEOUT_MS};`);
  assertSupportedAgentSchemaVersion(db, pathname);
  assertExistingAgentSchemaOwner(readExistingAgentSchemaMeta(db), agentId, pathname);
  const withIntegrityMutation: AgentSchemaMutationGuard = (run) =>
    deletionFence
      ? runSqliteImmediateTransactionSync(db, () => withRegistrationFence(run), {
          databaseLabel: pathname,
          operationLabel: "agent.schema.integrity",
          withCommit: withRegistrationFence,
        })
      : run();
  if (readSqliteUserVersion(db) !== AGENT_MEDIA_SCHEMA_VERSION) {
    const integrity = agentDatabaseIntegrityBeforeMutationSteps(db, agentId, pathname);
    try {
      let step = withIntegrityMutation(() => integrity.next());
      while (!step.done) {
        let failure: { error: unknown } | undefined;
        try {
          yield step.value;
        } catch (error) {
          failure = { error };
        }
        // Resuming integrity can repair indexes before the outer schema phase runs.
        step = withIntegrityMutation(() =>
          failure ? integrity.throw(failure.error) : integrity.next(),
        );
      }
    } finally {
      integrity.return(false);
    }
  }
  configureSqlitePreSchemaPragmas(db, { busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS });
  ensureAgentSchema(db, agentId, pathname, BRANCH_AGENT_SCHEMA_VERSION, withRegistrationFence);
  ensureBranchAgentDatabasePermissions(pathname, databaseOptions);
  if (databaseOptions.register === true) {
    registerBranchAgentDatabase({ agentId, path: pathname, env: databaseOptions.env });
  }
}

/** Upgrade older owned databases to the structural schema required by the media cutover. */
export function* migrateBranchAgentDatabaseToMediaPrerequisiteSchemaSteps(
  db: DatabaseSync,
  options: BranchAgentDatabaseOptions,
): SqliteIntegrityOperation<void> {
  const targetVersion = AGENT_MEDIA_SCHEMA_VERSION - 1;
  if (readSqliteUserVersion(db) > targetVersion) {
    return;
  }
  const agentId = normalizeAgentId(options.agentId);
  const pathname = resolveBranchAgentSqlitePath({ ...options, agentId });
  if (db.location()) {
    maintenanceAuthority.invalidateBranchAgentDatabaseIntegrityBeforeMutation(
      pathname,
      options.env,
    );
  }
  yield* agentDatabaseIntegrityBeforeMutationSteps(db, agentId, pathname);
  configureSqlitePreSchemaPragmas(db, {
    busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  });
  ensureAgentSchema(db, agentId, pathname, targetVersion);
}

export { ensureAgentSchema as ensureBranchAgentSchema };

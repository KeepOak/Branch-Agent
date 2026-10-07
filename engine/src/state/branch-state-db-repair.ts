import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { repairDoctorSqliteIndexCorruption } from "../infra/sqlite-index-recovery.js";
import {
  repairCanonicalSqliteIndexes,
  verifyAndRepairCanonicalSqliteIndexes,
} from "../infra/sqlite-index-schema.js";
import { assertSqliteIntegrity, assertSqliteTableIntegrity } from "../infra/sqlite-integrity.js";
import { BranchStateOwnershipError } from "../infra/sqlite-lifecycle-errors.js";
import { configureSqliteMaintenanceCache } from "../infra/sqlite-maintenance-cache.js";
import { assertSqliteSchemaTablesPresent } from "../infra/sqlite-schema-contract.js";
import { migrateSqliteSchemaToStrictInTransaction } from "../infra/sqlite-strict.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { migrateLegacyCronRunLogsToTaskRuns } from "../infra/state-migrations.cron-run-logs.js";
import { hasPreJournalStateSchema } from "./agent-deletion-journal-history.js";
import {
  clearBranchDatabaseQuarantine,
  readBranchDatabaseQuarantineFailure,
} from "./branch-quarantine-store.js";
import { repairAuditEventsSchema } from "./branch-state-db-audit-migration.js";
import {
  clearBranchStateDatabaseOpenFailure,
  branchStateDatabaseCache,
} from "./branch-state-db-cache.js";
import {
  LAZY_ADDITIVE_STATE_TABLES,
  DOCTOR_OWNED_STATE_TABLES,
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  BRANCH_STATE_SCHEMA_VERSION,
  BRANCH_STATE_STRICT_SCHEMA_VERSION,
} from "./branch-state-db-contract.js";
import {
  hasDanglingSkillWorkshopCollectionReviewIndex,
  openDoctorStateSchemaReadAdmission,
} from "./branch-state-db-doctor-schema.js";
import { assertCurrentStateRuntimeSchema } from "./branch-state-db-fast-path.js";
import {
  assertBranchStateDatabaseOwner,
  markCurrentStateSchemaVersion,
  branchStateMigrationAssertions,
  versionedStateMigrations,
  runStateSchemaMigrationTransaction,
  executeCanonicalStateSchema,
  prepareStateDatabaseSchemaRepair,
} from "./branch-state-db-maintenance.js";
import * as operatorApprovalMigration from "./branch-state-db-operator-approval-migration.js";
import { ensureBranchStatePermissions } from "./branch-state-db-permissions.js";
import {
  ensureAdditiveStateColumns,
  ensureFirstUseAdditiveStateColumnsForStrictMigration,
} from "./branch-state-db-schema-additive.js";
import { tableExists } from "./branch-state-db-schema-helpers.js";
import { assertBranchStateSchemaRepairAllowed } from "./branch-state-db-schema-policy.js";
import {
  assertCanonicalAgentDatabasesPrimaryKey,
  assertCanonicalStateSchemaShape,
  dropLegacyStateTables,
  migrateAgentDatabaseRelativePaths as migrateAgentPaths,
  migrateWorkerPlacementExecutionModeSchema,
  repairLegacyGatewayRestartHandoffsForStrictMigration,
} from "./branch-state-db-schema-repair.js";
import { ensureBranchStateRuntimeSchema } from "./branch-state-db-schema-runtime.js";
import { migrateSingletonStateFoldInV12 } from "./branch-state-db-schema-v12-foldin.js";
import {
  readStateSchemaContentVersion,
  readStateSchemaMigrationVersion,
} from "./branch-state-db-schema-version.js";
import * as sessionWatchMigration from "./branch-state-db-session-watch-migration.js";
import * as retirements from "./branch-state-db-table-retirements.js";
import { recoverOrphanTaskDeliveryRows } from "./branch-state-db-task-delivery-recovery.js";
import { describeAgentPathMigration } from "./branch-state-db.paths.js";
import { assertBranchStateWriteAllowed } from "./branch-state-ownership.js";
import { getBranchStateRuntimeSchema } from "./branch-state-schema-compatibility.js";
import { BRANCH_STATE_SCHEMA_SQL } from "./branch-state-schema.js";
import { UpdateSchemaRefusalError } from "./branch-update-schema-refusal.js";

export function repairStateSchema(
  pathname: string,
  env: NodeJS.ProcessEnv,
  scope: "automatic" | "doctor" | "readability" | "indexes",
): {
  changes: string[];
  warnings: string[];
} {
  assertBranchStateSchemaRepairAllowed(pathname);
  // This private handle rebuilds referenced tables and is closed after repair.
  const db = openNodeSqliteDatabase(pathname, { enableForeignKeyConstraints: false });
  const rebuiltIndexNames = new Set<string>();
  let indexChanges: string[] = [];
  let ownershipRefused = false;
  try {
    setSqliteBusyTimeout(db, BRANCH_SQLITE_BUSY_TIMEOUT_MS);
    const closeReadAdmission =
      scope === "automatic" ? undefined : openDoctorStateSchemaReadAdmission(db);
    try {
      assertBranchStateWriteAllowed({ database: db, databasePath: pathname, env });
      assertCanonicalAgentDatabasesPrimaryKey(db, pathname);
    } finally {
      closeReadAdmission?.();
    }
    ensureBranchStatePermissions(pathname, env);
    if (scope === "automatic") {
      return {
        changes: ensureBranchStateRuntimeSchema(db, pathname, env, {
          kind: "existing",
        }),
        warnings: [],
      };
    }
    const repairAdmittedSchema = prepareStateDatabaseSchemaRepair(db, pathname, env);
    const canInspectIndexes =
      scope !== "readability" && !hasDanglingSkillWorkshopCollectionReviewIndex(db);
    const assertIndexRepairCurrent = () => {
      assertBranchStateDatabaseOwner(db, { pathname });
      assertBranchStateWriteAllowed({ database: db, databasePath: pathname, env });
    };
    indexChanges = canInspectIndexes
      ? repairDoctorSqliteIndexCorruption(db, pathname, {
          label: "shared-state",
          assertCurrent: assertIndexRepairCurrent,
        })
      : [];
    if (scope === "indexes") {
      if (
        canInspectIndexes &&
        (indexChanges.length > 0 ||
          branchStateDatabaseCache.getBranchStateDatabaseRecordedFailure(pathname) ||
          readBranchDatabaseQuarantineFailure("state", pathname, { env }))
      ) {
        runSqliteImmediateTransactionSync(
          db,
          () => {
            // A previous REINDEX can commit before quarantine cleanup succeeds.
            if (indexChanges.length === 0) {
              assertSqliteIntegrity(db, pathname);
            }
            assertIndexRepairCurrent();
            if (!clearBranchDatabaseQuarantine(pathname, { env })) {
              throw new Error(
                `Repaired ${pathname}, but its quarantine record could not be cleared.`,
              );
            }
            clearBranchStateDatabaseOpenFailure(pathname);
          },
          {
            databaseLabel: pathname,
            operationLabel: "state.schema.quarantine-clear",
          },
        );
      }
      return { changes: indexChanges, warnings: [] };
    }
    if (scope === "readability") {
      const changes = runSqliteImmediateTransactionSync(
        db,
        () => {
          const schemaChanges = repairAdmittedSchema();
          if (schemaChanges.length > 0) {
            assertBranchStateDatabaseOwner(db, { pathname });
            assertSqliteTableIntegrity(db, pathname, "skill_workshop_collection_reviews");
          }
          return schemaChanges;
        },
        {
          busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
          databaseLabel: pathname,
          operationLabel: "state.schema.readability-repair",
        },
      );
      // Recovery snapshots committed source bytes in another process. Publish
      // catalog readability before its preservation transaction inspects them.
      changes.push(
        ...runSqliteImmediateTransactionSync(
          db,
          () => {
            assertBranchStateWriteAllowed({ database: db, databasePath: pathname, env });
            return recoverOrphanTaskDeliveryRows(db, pathname);
          },
          {
            busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
            databaseLabel: pathname,
            operationLabel: "state.schema.readability-recovery",
          },
        ),
      );
      return { changes, warnings: [] };
    }
    const applied: string[] = [...indexChanges];
    const changes = runStateSchemaMigrationTransaction(
      db,
      pathname,
      () => {
        applied.push(...recoverOrphanTaskDeliveryRows(db, pathname));
        const previousVersion = readStateSchemaMigrationVersion(db);
        const includeAgentDeletionJournal =
          tableExists(db, "agent_deletion_journal") || hasPreJournalStateSchema(db);
        const preAuditSchema = previousVersion === 1 && !tableExists(db, "audit_events");
        if (preAuditSchema) {
          assertBranchStateDatabaseOwner(db, { pathname });
        }
        if (previousVersion === BRANCH_STATE_SCHEMA_VERSION) {
          for (const name of verifyAndRepairCanonicalSqliteIndexes(
            db,
            pathname,
            BRANCH_STATE_SCHEMA_SQL,
            { allowMissingColumns: true },
          )) {
            rebuiltIndexNames.add(name);
          }
          // Current-schema doctor repair may normalize recognized columns or
          // table options, but it must never recreate a missing table empty.
          assertSqliteSchemaTablesPresent(db, pathname, BRANCH_STATE_SCHEMA_SQL, {
            allowedMissingTables: [...LAZY_ADDITIVE_STATE_TABLES, ...DOCTOR_OWNED_STATE_TABLES],
          });
        } else {
          branchStateMigrationAssertions.get(previousVersion)?.(db, { pathname });
          assertSqliteIntegrity(db, pathname);
        }
        dropLegacyStateTables(db);
        applied.push(...retirements.runRetiredStateTableMigrations(db, previousVersion));
        if (migrateSingletonStateFoldInV12(db, previousVersion)) {
          applied.push("Folded singleton state tables into config_machine_state (v12)");
        }
        if (migrateWorkerPlacementExecutionModeSchema(db, previousVersion)) {
          applied.push("Migrated cloud worker placements to execution modes");
        }
        applied.push(
          ...describeAgentPathMigration(migrateAgentPaths(db, previousVersion, pathname)),
        );
        if (repairAuditEventsSchema(db)) {
          applied.push(
            `Migrated shared state audit event ledger → versioned message lifecycle schema`,
          );
        }
        applied.push(...operatorApprovalMigration.repairOperatorApprovalSchema(db));
        const needsSessionWatchMigration =
          sessionWatchMigration.needsSessionWatchCursorProvenanceMigration(db, previousVersion);
        const sessionWatchResult = sessionWatchMigration.migrateSessionWatchCursorProvenance(db);
        if (needsSessionWatchMigration) {
          applied.push(
            `Migrated shared state session watch cursors → provenance column (${sessionWatchResult.migratedAmbientWatches} ambient, ${sessionWatchResult.removedLegacySentinels} sentinels removed)`,
          );
        }
        assertCanonicalStateSchemaShape(db, pathname);
        // Recognized schema-1 stores predate audit; Doctor must finish their schema
        // before its later read-only workspace and agent readers can consume it.
        if (preAuditSchema || tableExists(db, "audit_events")) {
          ensureAdditiveStateColumns(db, "repair");
          for (const migration of versionedStateMigrations) {
            if (migration.migrate(db, previousVersion)) {
              applied.push(migration.applied);
            }
          }
          executeCanonicalStateSchema(db, {
            includeVersionLazyAdditiveTables: previousVersion !== BRANCH_STATE_SCHEMA_VERSION,
            includeAgentDeletionJournal,
          });
          migrateLegacyCronRunLogsToTaskRuns(db);
          if (previousVersion < BRANCH_STATE_STRICT_SCHEMA_VERSION) {
            repairLegacyGatewayRestartHandoffsForStrictMigration(db);
            ensureFirstUseAdditiveStateColumnsForStrictMigration(db);
          }
          const strictMigration = migrateSqliteSchemaToStrictInTransaction(
            db,
            getBranchStateRuntimeSchema({
              includeVersionLazyAdditiveTables: previousVersion !== BRANCH_STATE_SCHEMA_VERSION,
              includeAgentDeletionJournal: tableExists(db, "agent_deletion_journal"),
            }),
            { databaseLabel: pathname },
          );
          if (strictMigration.migratedTables.length > 0) {
            applied.push(
              `Migrated shared state tables to SQLite STRICT typing (${strictMigration.migratedTables.length})`,
            );
          }
          for (const name of repairCanonicalSqliteIndexes(db, pathname, BRANCH_STATE_SCHEMA_SQL, {
            verifyPhysicalIntegrity: false,
          })) {
            rebuiltIndexNames.add(name);
          }
        }
        markCurrentStateSchemaVersion(db, {
          createMetadataIfMissing: previousVersion < BRANCH_STATE_SCHEMA_VERSION,
        });
        if (readStateSchemaContentVersion(db) === BRANCH_STATE_SCHEMA_VERSION) {
          assertCurrentStateRuntimeSchema(db, pathname);
        }
        if (rebuiltIndexNames.size > 0) {
          applied.push(`Rebuilt canonical shared-state SQLite indexes (${rebuiltIndexNames.size})`);
        }
        return applied;
      },
      {
        busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
        databaseLabel: pathname,
        operationLabel: "state.schema.repair",
      },
      () => {
        applied.push(...repairAdmittedSchema());
        configureSqliteMaintenanceCache(db);
      },
    );
    const quarantineCleared = clearBranchDatabaseQuarantine(pathname, { env });
    clearBranchStateDatabaseOpenFailure(pathname);
    return {
      changes,
      warnings: quarantineCleared
        ? []
        : [
            `Persisted quarantine record for ${pathname} could not be cleared; rerun branch doctor --fix so the repaired database is not refused again.`,
          ],
    };
  } catch (err) {
    if (err instanceof UpdateSchemaRefusalError) {
      throw err;
    }
    if (err instanceof BranchStateOwnershipError) {
      ownershipRefused = true;
      throw err;
    }
    // Reaching this catch inside doctor means repair itself refused or failed,
    // so the runtime asserts' "run branch doctor --fix" advice is circular here.
    const reason =
      scope === "automatic"
        ? String(err)
        : String(err).replace(
            /has a legacy ([a-z ]+) schema; run branch doctor --fix to migrate it\./u,
            "has a legacy $1 schema; automatic repair refused the unrecognized schema shape.",
          );
    return {
      changes: indexChanges,
      warnings: [`Failed migrating shared state database schema at ${pathname}: ${reason}`],
    };
  } finally {
    if (db.isOpen) {
      clearNodeSqliteKyselyCacheForDatabase(db);
      // Rollback cleanup may have closed the handle after an unrecoverable
      // transaction failure; double-close throws ERR_INVALID_STATE and would
      // discard the diagnostic warnings returned by the catch above.
      db.close();
    }
    if (!ownershipRefused) {
      ensureBranchStatePermissions(pathname, env);
    }
  }
}

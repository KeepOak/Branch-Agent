import type { DatabaseSync } from "node:sqlite";
import {
  repairCanonicalSqliteIndexes,
  verifyAndRepairCanonicalSqliteIndexes,
} from "../infra/sqlite-index-schema.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { migrateSqliteSchemaToStrictInTransaction } from "../infra/sqlite-strict.js";
import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";
import { withStateDatabaseSchemaMaintenance } from "../infra/state-database-maintenance.js";
import { migrateLegacyCronRunLogsToTaskRuns } from "../infra/state-migrations.cron-run-logs.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { hasPreJournalStateSchema } from "./agent-deletion-journal-history.js";
import {
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  BRANCH_STATE_SCHEMA_VERSION,
  BRANCH_STATE_STRICT_SCHEMA_VERSION,
} from "./branch-state-db-contract.js";
import { assertExistingBranchStateRuntimeSchema } from "./branch-state-db-existing-schema.js";
import {
  assertCurrentStateRuntimeSchema,
  assertNoLegacyStateRuntimeRepair,
  isBranchStateSchemaFastPathEligible,
} from "./branch-state-db-fast-path.js";
import type { StateDatabaseInitialization } from "./branch-state-db-initialization.js";
import {
  assertBranchStateDatabaseForMaintenance,
  executeCanonicalStateSchema,
  branchStateMigrationAssertions,
  runStateSchemaMigrationTransaction,
  versionedStateMigrations,
  writeCurrentStateSchemaMetadata,
} from "./branch-state-db-maintenance.js";
import {
  ensureAdditiveStateColumns,
  ensureFirstUseAdditiveStateColumnsForStrictMigration,
} from "./branch-state-db-schema-additive.js";
import { tableExists } from "./branch-state-db-schema-helpers.js";
import { isExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import {
  assertCanonicalStateSchemaShape,
  dropLegacyStateTables,
  migrateAgentDatabaseRelativePaths,
  migrateWorkerPlacementExecutionModeSchema,
  repairLegacyGatewayRestartHandoffsForStrictMigration,
} from "./branch-state-db-schema-repair.js";
import { migrateSingletonStateFoldInV12 } from "./branch-state-db-schema-v12-foldin.js";
import {
  assertSupportedStateSchemaVersion,
  readStateSchemaMigrationVersion,
} from "./branch-state-db-schema-version.js";
import { migrateSessionWatchCursorProvenance } from "./branch-state-db-session-watch-migration.js";
import { isUninitializedNativeStartupDatabase } from "./branch-state-db-startup-checkpoint.js";
import * as retirements from "./branch-state-db-table-retirements.js";
import { describeAgentPathMigration, warnAgentPathMigration } from "./branch-state-db.paths.js";
import { assertBranchStateWriteAllowed } from "./branch-state-ownership.js";
import { getBranchStateRuntimeSchema } from "./branch-state-schema-compatibility.js";
import { BRANCH_STATE_SCHEMA_SQL } from "./branch-state-schema.js";

const stateDbLog = createSubsystemLogger("state/db");

/** Runtime converges schema; historical row repair belongs to explicit Doctor maintenance. */
export function ensureBranchStateRuntimeSchema(
  db: DatabaseSync,
  pathname: string,
  env: NodeJS.ProcessEnv,
  initialization: StateDatabaseInitialization,
  busyTimeoutMs = BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  initializeNativeOnly = false,
): string[] {
  if (isExistingBranchStateSchema(pathname, db)) {
    assertExistingBranchStateRuntimeSchema(db, pathname);
    assertBranchStateWriteAllowed({ database: db, databasePath: pathname, env });
    return [];
  }
  try {
    if (isBranchStateSchemaFastPathEligible(db, pathname)) {
      // A claim made during validation must not retain a writable handle.
      assertBranchStateWriteAllowed({ database: db, databasePath: pathname, env });
      return [];
    }
  } catch (error) {
    if (!db.isOpen || error instanceof StartupMaintenanceRequiredError) {
      throw error;
    }
    // Preserve transactional schema convergence and its diagnostics after a clean rollback.
  }

  return withStateDatabaseSchemaMaintenance({ databasePath: pathname, busyTimeoutMs }, () => {
    const now = Date.now();
    const retiredTableChanges: string[] = [];
    const applied = runStateSchemaMigrationTransaction(
      db,
      pathname,
      () => {
        assertBranchStateWriteAllowed({ database: db, databasePath: pathname, env });
        assertSupportedStateSchemaVersion(db, pathname);
        if (initializeNativeOnly && !isUninitializedNativeStartupDatabase(db)) {
          return [];
        }
        const previousVersion = readStateSchemaMigrationVersion(db);
        const includeAgentDeletionJournal =
          tableExists(db, "agent_deletion_journal") ||
          hasPreJournalStateSchema(db) ||
          (initialization.kind === "fresh" && isUninitializedNativeStartupDatabase(db));
        if (previousVersion === BRANCH_STATE_SCHEMA_VERSION) {
          assertNoLegacyStateRuntimeRepair(db, pathname);
          const indexes = verifyAndRepairCanonicalSqliteIndexes(
            db,
            pathname,
            BRANCH_STATE_SCHEMA_SQL,
            {
              allowMissingColumns: true,
              validateAfterRepair: () => {
                // Index repair precedes additive-column convergence in this transaction.
                assertCanonicalStateSchemaShape(db, pathname);
                assertBranchStateDatabaseForMaintenance(db, { pathname });
              },
            },
          );
          ensureAdditiveStateColumns(db, "runtime");
          assertCurrentStateRuntimeSchema(db, pathname);
          writeCurrentStateSchemaMetadata(db, now);
          return indexes.length > 0
            ? [`Rebuilt canonical shared-state SQLite indexes (${indexes.length})`]
            : [];
        }

        // Older schemas still need atomic content transforms before retiring their columns.
        branchStateMigrationAssertions.get(previousVersion)?.(db, { pathname });
        // Automatic preparation enters without the physical opener's integrity preflight.
        assertSqliteIntegrity(db, pathname);
        dropLegacyStateTables(db);
        const changes = retirements.runRetiredStateTableMigrations(db, previousVersion);
        retiredTableChanges.push(...changes);
        if (migrateSingletonStateFoldInV12(db, previousVersion)) {
          changes.push("Folded singleton state tables into config_machine_state (v12)");
        }
        if (migrateWorkerPlacementExecutionModeSchema(db, previousVersion)) {
          changes.push("Migrated cloud worker placements to execution modes");
        }
        const pathMigration = migrateAgentDatabaseRelativePaths(db, previousVersion, pathname);
        changes.push(...describeAgentPathMigration(pathMigration));
        ensureAdditiveStateColumns(db, "repair");
        for (const migration of versionedStateMigrations) {
          if (migration.migrate(db, previousVersion)) {
            changes.push(migration.applied);
          }
        }
        migrateSessionWatchCursorProvenance(db);
        assertCanonicalStateSchemaShape(db, pathname);
        executeCanonicalStateSchema(db, {
          includeVersionLazyAdditiveTables: true,
          includeAgentDeletionJournal,
        });
        migrateLegacyCronRunLogsToTaskRuns(db);
        if (previousVersion < BRANCH_STATE_STRICT_SCHEMA_VERSION) {
          repairLegacyGatewayRestartHandoffsForStrictMigration(db);
          ensureFirstUseAdditiveStateColumnsForStrictMigration(db);
          const strict = migrateSqliteSchemaToStrictInTransaction(
            db,
            getBranchStateRuntimeSchema({
              includeVersionLazyAdditiveTables: true,
              includeAgentDeletionJournal,
            }),
            { databaseLabel: pathname },
          );
          if (strict.migratedTables.length > 0) {
            changes.push(
              `Migrated shared state tables to SQLite STRICT typing (${strict.migratedTables.length})`,
            );
          }
        }
        repairCanonicalSqliteIndexes(db, pathname, BRANCH_STATE_SCHEMA_SQL, {
          verifyPhysicalIntegrity: false,
        });
        writeCurrentStateSchemaMetadata(db, now);
        assertBranchStateDatabaseForMaintenance(db, { pathname });
        warnAgentPathMigration(stateDbLog, pathMigration, pathname);
        return changes;
      },
      { busyTimeoutMs, databaseLabel: pathname, operationLabel: "state.schema.ensure" },
    );
    retiredTableChanges.forEach(retirements.logRetiredStateTableMigration);
    return applied;
  });
}

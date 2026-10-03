import type { DatabaseSync } from "node:sqlite";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import {
  collectSqliteSchemaIssues,
  createSqliteTableContractReader,
  type SqliteTableContractReader,
} from "../infra/sqlite-schema-contract.js";
import { runSqliteDeferredTransactionSync } from "../infra/sqlite-transaction.js";
import { hasLegacyCronRunLogs } from "../infra/state-migrations.cron-run-logs.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import { assertBranchStateDatabaseForMaintenance } from "./branch-state-db-maintenance.js";
import { BranchStateDatabaseSchemaMigrationRequiredError } from "./branch-state-db-schema-migration-required.js";
import {
  assertCanonicalStateSchemaShape,
  detectBranchStateDatabaseSchemaMigrationsFromDatabase,
} from "./branch-state-db-schema-repair.js";
import {
  assertSupportedStateSchemaVersion,
  readStateSchemaMigrationVersion,
} from "./branch-state-db-schema-version.js";
import {
  getBranchStateRuntimeSchema,
  isBranchStateStartupRepairableSchemaIssue,
  STATE_PERSISTENT_SCHEMA_COMPATIBILITY,
} from "./branch-state-schema-compatibility.js";

export function needsBranchStateDatabaseSchemaRepair(
  pathname: string,
  scope: "automatic" | "doctor" = "automatic",
): boolean {
  let database: DatabaseSync | undefined;
  try {
    database = openNodeSqliteDatabase(pathname, { readOnly: true });
    assertSupportedStateSchemaVersion(database, pathname);
    const needsRepair =
      readStateSchemaMigrationVersion(database) !== BRANCH_STATE_SCHEMA_VERSION ||
      hasLegacyCronRunLogs(database) ||
      detectBranchStateDatabaseSchemaMigrationsFromDatabase(database, pathname).length > 0;
    if (!needsRepair) {
      assertCurrentStateRuntimeSchema(database, pathname);
      if (scope === "doctor") {
        assertSqliteIntegrity(database, pathname);
      }
    }
    return needsRepair;
  } catch {
    // Preserve the repair path's existing diagnostics for unreadable or noncanonical databases.
    return true;
  } finally {
    database?.close();
  }
}

export function assertCurrentStateRuntimeSchema(
  database: DatabaseSync,
  pathname: string,
  readTable?: SqliteTableContractReader,
): void {
  assertCanonicalStateSchemaShape(database, pathname);
  assertBranchStateDatabaseForMaintenance(database, { pathname }, readTable);
}

/** Catalog presence is enough to refuse retired history without reading or rewriting its rows. */
export function assertNoLegacyStateRuntimeRepair(database: DatabaseSync, pathname: string): void {
  if (hasLegacyCronRunLogs(database)) {
    throw new BranchStateDatabaseSchemaMigrationRequiredError("legacy-cron-run-logs", pathname);
  }
}

export function isBranchStateSchemaFastPathEligible(
  database: DatabaseSync,
  pathname: string,
): boolean {
  return runSqliteDeferredTransactionSync(database, () => {
    assertSupportedStateSchemaVersion(database, pathname);
    if (readStateSchemaMigrationVersion(database) !== BRANCH_STATE_SCHEMA_VERSION) {
      return false;
    }
    assertSqliteIntegrity(database, pathname);
    // Both policies see this read transaction; repair must collect fresh facts after it ends.
    const readTable = createSqliteTableContractReader(database);
    assertCurrentStateRuntimeSchema(database, pathname, readTable);
    const startupRepairRequired = collectSqliteSchemaIssues(
      database,
      getBranchStateRuntimeSchema({ includeVersionLazyAdditiveTables: false }),
      STATE_PERSISTENT_SCHEMA_COMPATIBILITY,
      readTable,
    ).some(isBranchStateStartupRepairableSchemaIssue);
    if (startupRepairRequired) {
      return false;
    }
    assertNoLegacyStateRuntimeRepair(database, pathname);
    return true;
  });
}

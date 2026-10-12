import type { DatabaseSync } from "node:sqlite";
import { BRANCH_DATABASE_SCHEMA_DOCS_URL } from "../state/branch-state-db-contract.js";
import { resolveRuntimeServiceCommit, VERSION } from "../version.js";
import { executeWithCachedStatement } from "./kysely-sync-cache-state.js";
import { resolveBranchPackageRootSync } from "./branch-root.js";
import { StartupMaintenanceRequiredError } from "./startup-maintenance-required.js";

const SQLITE_SCHEMA_VERSION_ERROR_NAME = "SqliteSchemaVersionError";

export class SqliteSchemaVersionError extends StartupMaintenanceRequiredError {
  override name = SQLITE_SCHEMA_VERSION_ERROR_NAME;

  constructor(message: string) {
    super("newer-schema", message);
  }
}

export function isSqliteSchemaVersionError(error: unknown): error is Error {
  return (
    error instanceof SqliteSchemaVersionError ||
    (error instanceof Error && error.name === SQLITE_SCHEMA_VERSION_ERROR_NAME)
  );
}

export function readSqliteUserVersion(db: DatabaseSync): number {
  const row = executeWithCachedStatement(db, "PRAGMA user_version", [], (statement) =>
    statement.get(),
  );
  return Number(row?.user_version ?? 0);
}

/**
 * Name the refusing build from immutable loaded metadata, plus its install root.
 * The path remains actionable when multiple installs share a version or build.
 */
export function describeRunningBranchBuild(): string {
  const commit = resolveRuntimeServiceCommit();
  const root = resolveBranchPackageRootSync({ moduleUrl: import.meta.url });
  const identity = commit ? `Branch Agent ${VERSION} (${commit})` : `Branch Agent ${VERSION}`;
  return root ? `${identity} installed at ${root}` : identity;
}

export function createNewerSqliteSchemaVersionError(
  databaseLabel: string,
  pathname: string,
  schemaVersion: number,
  supportedVersion: number,
): Error {
  return new SqliteSchemaVersionError(
    "This Branch Agent build cannot open your existing data.\n" +
      `${databaseLabel} ${pathname} uses newer schema version ${schemaVersion}; this build supports ${supportedVersion}.\n` +
      `Refused by ${describeRunningBranchBuild()}.\n` +
      `Use a build that supports schema ${schemaVersion} or newer with this state directory. To use an older build, restore your pre-update backup created with branch backup create.\n` +
      `See ${BRANCH_DATABASE_SCHEMA_DOCS_URL}.`,
  );
}

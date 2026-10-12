import { existsSync } from "node:fs";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import type {
  BranchStateDatabaseOptions,
  BranchStateDatabaseSchemaMigration,
} from "./branch-state-db-contract.js";
import { withExistingBranchStateDatabaseArtifactPreservingReadOnly } from "./branch-state-db-readonly.js";
import { detectBranchStateDatabaseSchemaMigrationsFromDatabase } from "./branch-state-db-schema-repair.js";
import { resolveDatabasePath } from "./branch-state-db.paths.js";

export function detectBranchStateDatabaseSchemaMigrations(
  options: BranchStateDatabaseOptions = {},
  behavior: { artifactPreservingReadOnly?: boolean } = {},
): BranchStateDatabaseSchemaMigration[] {
  const pathname = resolveDatabasePath(options);
  if (!existsSync(pathname)) {
    return [];
  }
  if (behavior.artifactPreservingReadOnly) {
    return (
      withExistingBranchStateDatabaseArtifactPreservingReadOnly(
        ({ db }) => detectBranchStateDatabaseSchemaMigrationsFromDatabase(db, pathname),
        { ...options, path: pathname },
      ) ?? []
    );
  }
  const db = openNodeSqliteDatabase(pathname, { readOnly: true });
  try {
    return detectBranchStateDatabaseSchemaMigrationsFromDatabase(db, pathname);
  } finally {
    db.close();
  }
}

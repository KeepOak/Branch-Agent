import type { DatabaseSync } from "node:sqlite";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import { BRANCH_STATE_SCHEMA_SQL } from "./branch-state-schema.js";

/** Prepare canonical DDL without opening a database; each feature keeps its own handle cache. */
export function createBranchStateSchemaEnsurer(params: {
  table: string;
  endMarker?: string;
  operationLabel: string;
}): (options?: BranchStateDatabaseOptions) => void {
  const schema = extractSqliteTableSchema(BRANCH_STATE_SCHEMA_SQL, params.table, {
    endMarker: params.endMarker ?? "\n) STRICT;\n",
    errorMessage: `Canonical state schema markers are missing for ${params.table}`,
  });
  const ensuredDatabases = new WeakSet<DatabaseSync>();
  return (options = {}) => {
    const database = openBranchStateDatabase(options);
    if (ensuredDatabases.has(database.db)) {
      return;
    }
    runBranchStateWriteTransaction(
      ({ db }) => {
        db.exec(schema); // sqlite-allow-raw -- Canonical feature-local additive DDL only.
      },
      options,
      { operationLabel: params.operationLabel },
    );
    // Preserve successful wrapper-return timing, including nested savepoints.
    ensuredDatabases.add(database.db);
  };
}

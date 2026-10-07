import type { DatabaseSync } from "node:sqlite";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db-contract.js";
import { runExistingBranchStateWriteTransaction } from "./branch-state-db-existing-write.js";
import type { BranchStateLeaseContext } from "./branch-state-lease-context.js";
import { BRANCH_STATE_SCHEMA_SQL } from "./branch-state-schema.js";

const existingAgentLeaseSchema = ["schema_meta", "state_leases", "agent_database_leases"]
  .map((table) =>
    extractSqliteTableSchema(BRANCH_STATE_SCHEMA_SQL, table, {
      endMarker: ") STRICT;",
      errorMessage: "Existing agent lease schema is unavailable.",
    }),
  )
  .join("\n");

export function withExistingAgentLeaseWrite<T>(
  maintenance: BranchStateLeaseContext,
  options: BranchStateDatabaseOptions,
  operation: (db: DatabaseSync) => T,
): T {
  return runExistingBranchStateWriteTransaction(
    ({ db }) => {
      maintenance.assertOwnedInTransaction(db);
      const result = operation(db);
      maintenance.assertOwnedInTransaction(db);
      return result;
    },
    options,
    {
      operationLabel: "agent.database.maintenance.admission",
      schemaSql: existingAgentLeaseSchema,
      // Maintenance must drain published lease schemas before first-use provenance is added.
      schemaCompatibility: { allowedMissingColumns: ["agent_database_leases.provenance"] },
    },
  );
}

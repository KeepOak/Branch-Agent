import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";
import type { DB } from "../state/branch-state-db.generated.js";

export type GroveInstallSchemaVersionRow = {
  agentId: string;
  schemaVersion: string;
  agentConfigDigest: string;
};

export function readGroveInstallSchemaVersionRows(db: DatabaseSync): GroveInstallSchemaVersionRow[] {
  if (!tableExists(db, "grove_installs")) {
    return [];
  }
  return executeSqliteQuerySync(
    db,
    getNodeSqliteKysely<Pick<DB, "grove_installs">>(db)
      .selectFrom("grove_installs")
      .select([
        "agent_id as agentId",
        "schema_version as schemaVersion",
        "agent_config_digest as agentConfigDigest",
      ]),
  ).rows;
}

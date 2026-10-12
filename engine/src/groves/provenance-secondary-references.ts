import type { DatabaseSync } from "node:sqlite";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";

const GROVE_SECONDARY_REFERENCE_TABLES = [
  "grove_package_refs",
  "grove_mcp_server_refs",
  "grove_cron_refs",
] as const;

export function readGroveSecondaryReferenceTables(db: DatabaseSync, agentId: string): string[] {
  return GROVE_SECONDARY_REFERENCE_TABLES.filter((table) => {
    if (!tableExists(db, table)) {
      return false;
    }
    return Boolean(
      db /* sqlite-allow-raw: read-only point check for secondary Grove ownership before migration. */
        .prepare(`SELECT 1 FROM ${table} WHERE agent_id = ? LIMIT 1`)
        .get(agentId),
    );
  });
}

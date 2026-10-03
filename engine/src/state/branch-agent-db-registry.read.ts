import type { DatabaseSync } from "node:sqlite";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { BranchRegisteredAgentDatabase } from "./branch-agent-db-contract.js";
import { detectBranchStateDatabaseSchemaMigrationsFromDatabase } from "./branch-state-db-schema-repair.js";
import type { DB as BranchStateKyselyDatabase } from "./branch-state-db.generated.js";
import { resolveBranchRegisteredAgentDatabasePath } from "./branch-state-db.paths.js";

type BranchAgentRegistryDatabase = Pick<BranchStateKyselyDatabase, "agent_databases"> & {
  sqlite_master: { name: string; type: string };
};

/** Read durable registrations from an already opened live or captured database. */
export function readBranchAgentDatabaseRegistryRows(database: DatabaseSync, pathname: string) {
  const db = getNodeSqliteKysely<BranchAgentRegistryDatabase>(database);
  const registryTable = executeSqliteQueryTakeFirstSync(
    database,
    db.selectFrom("sqlite_master").select("type").where("name", "=", "agent_databases"),
  );
  if (!registryTable) {
    return [];
  }
  if (registryTable.type !== "table") {
    throw new Error(`Branch Agent state database ${pathname} has an invalid agent registry.`);
  }
  return executeSqliteQuerySync(
    database,
    db.selectFrom("agent_databases").selectAll().orderBy("agent_id", "asc").orderBy("path", "asc"),
  ).rows;
}

export function readAgentDatabasePreflightTargets(database: DatabaseSync, registryPath: string) {
  return readBranchAgentDatabaseRegistryRows(database, registryPath).flatMap((row) =>
    typeof row.agent_id === "string" && typeof row.path === "string"
      ? [
          {
            agentId: row.agent_id,
            path: resolveBranchRegisteredAgentDatabasePath(registryPath, row.path),
          },
        ]
      : [],
  );
}

export function readRegisteredAgentDatabaseRows(
  database: DatabaseSync,
  pathname: string,
  artifactPreserving: boolean,
): BranchRegisteredAgentDatabase[] {
  const schemaMigrations = detectBranchStateDatabaseSchemaMigrationsFromDatabase(
    database,
    pathname,
  );
  if (!artifactPreserving && schemaMigrations.length > 0) {
    throw new Error(
      `Branch Agent state database ${pathname} has a legacy agent database registry schema; run branch doctor --fix to migrate it.`,
    );
  }
  return readBranchAgentDatabaseRegistryRows(database, pathname).map((row) => ({
    agentId: normalizeAgentId(row.agent_id),
    path: resolveBranchRegisteredAgentDatabasePath(pathname, row.path),
    schemaVersion: row.schema_version,
    lastSeenAt: row.last_seen_at,
    sizeBytes: row.size_bytes,
  }));
}

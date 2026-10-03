import type { DatabaseSync } from "node:sqlite";
import { normalizeAgentId } from "@branch/normalization-core/agent-id";
import { getAdmittedSqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import { SqliteSchemaMismatchError } from "../infra/sqlite-schema-issues.js";
import {
  createNewerSqliteSchemaVersionError,
  readSqliteUserVersion,
} from "../infra/sqlite-user-version.js";
import {
  AGENT_MEDIA_SCHEMA_VERSION,
  BRANCH_AGENT_SCHEMA_VERSION,
} from "./branch-agent-db-contract.js";
import {
  readExistingAgentSchemaMeta,
  type ExistingAgentSchemaMeta,
} from "./branch-agent-db-metadata.js";
import { BranchAgentDatabaseMediaMigrationRequiredError } from "./branch-agent-db-migration-required.js";

export { readExistingAgentSchemaMeta } from "./branch-agent-db-metadata.js";

export function assertSupportedAgentSchemaVersion(db: DatabaseSync, pathname: string): number {
  const userVersion = getAdmittedSqliteSchemaFacts(db)?.userVersion ?? readSqliteUserVersion(db);
  if (userVersion > BRANCH_AGENT_SCHEMA_VERSION) {
    throw createNewerSqliteSchemaVersionError(
      "Branch Agent agent database",
      pathname,
      userVersion,
      BRANCH_AGENT_SCHEMA_VERSION,
    );
  }
  return userVersion;
}

/** Readers may pass their immediate check; writers reread the version after integrity work. */
export function assertCanonicalAgentPersistenceVersion(
  db: DatabaseSync,
  pathname: string,
  userVersion = getAdmittedSqliteSchemaFacts(db)?.userVersion ?? readSqliteUserVersion(db),
): void {
  const hasApplicationSchema =
    userVersion === 0 &&
    db.prepare("SELECT 1 FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_' LIMIT 1").get();
  const isNewUnownedDatabase =
    userVersion === 0 && readExistingAgentSchemaMeta(db) === null && !hasApplicationSchema;
  if (userVersion < AGENT_MEDIA_SCHEMA_VERSION && !isNewUnownedDatabase) {
    throw new BranchAgentDatabaseMediaMigrationRequiredError(pathname, userVersion);
  }
  if (userVersion < BRANCH_AGENT_SCHEMA_VERSION && !isNewUnownedDatabase) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${pathname} uses schema version ${userVersion}; stop active agents and run branch doctor --fix to migrate session identities before using it.`,
    );
  }
}

export function assertExistingAgentSchemaOwner(
  existing: ExistingAgentSchemaMeta | null,
  agentId: string,
  pathname: string,
): void {
  if (!existing) {
    return;
  }
  // Agent DB files are not interchangeable; opening another role/id would corrupt ownership.
  if (existing.role !== "agent") {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${pathname} has schema role ${existing.role ?? "unknown"}; expected agent. Run branch doctor --fix to inspect and repair its ownership.`,
    );
  }
  if (!existing.agentId) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${pathname} has no agent owner. Run branch doctor --fix to inspect and repair its ownership.`,
    );
  }
  if (normalizeAgentId(existing.agentId) !== agentId) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent agent database ${pathname} belongs to agent ${existing.agentId}; requested agent ${agentId}.`,
    );
  }
}

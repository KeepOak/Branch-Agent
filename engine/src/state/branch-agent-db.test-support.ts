import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { canonicalSessionValidationSchemaSql } from "./branch-agent-canonical-validation-schema.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "./branch-agent-db-contract.js";
import { agentDatabaseLifecycle as cache } from "./branch-agent-db-lifecycle.js";
import { persistAgentSchemaMetadata } from "./branch-agent-db-metadata-write.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "./branch-agent-schema.js";
import { resolveQuarantineStorePath } from "./branch-state-db.paths.js";

/** Materialize distinct current databases without runtime handles, leases, or registrations. */
export function createCurrentBranchAgentDatabaseFixtures(
  templatePath: string,
  fixtures: ReadonlyArray<{ path: string; agentId: string }>,
): void {
  const template = openNodeSqliteDatabase(templatePath);
  try {
    runSqliteImmediateTransactionSync(template, () => {
      template.exec(BRANCH_AGENT_SCHEMA_SQL);
      template.exec(`PRAGMA user_version = ${BRANCH_AGENT_SCHEMA_VERSION}`);
      persistAgentSchemaMetadata(template, "fixture-template", BRANCH_AGENT_SCHEMA_VERSION);
    });
  } finally {
    template.close();
  }
  for (const fixture of fixtures) {
    fs.mkdirSync(path.dirname(fixture.path), { recursive: true });
    fs.copyFileSync(templatePath, fixture.path, fs.constants.COPYFILE_EXCL);
    const database = openNodeSqliteDatabase(fixture.path);
    try {
      persistAgentSchemaMetadata(database, fixture.agentId, BRANCH_AGENT_SCHEMA_VERSION);
    } finally {
      database.close();
    }
  }
}

/** Remove only the schema owner's future projection before carving a historical database. */
export function removeCanonicalValidationFromHistoricalAgentFixture(database: DatabaseSync): void {
  const definitions = [
    ...canonicalSessionValidationSchemaSql().matchAll(
      /^CREATE (TABLE|TRIGGER) IF NOT EXISTS ([a-z_]+)\b/gm,
    ),
  ];
  // Drop triggers before their pending table; unrelated fixture dependents remain intact.
  for (const match of definitions.toReversed()) {
    const kind = match[1];
    const name = match[2];
    if ((kind !== "TABLE" && kind !== "TRIGGER") || typeof name !== "string") {
      throw new Error("Invalid canonical-validation schema fixture definition");
    }
    database.exec(`DROP ${kind} IF EXISTS "${name}"`);
  }
}

/** List process-held agent databases without opening or inspecting fixture state. */
export function listBranchAgentDatabasesForTest(): Array<{ agentId: string; path: string }> {
  return [...cache.databases.values()]
    .filter((database) => database.db.isOpen)
    .map((database) => ({ agentId: database.agentId, path: database.path }))
    .toSorted(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) || left.path.localeCompare(right.path),
    );
}

/** Model missing restart metadata without invoking the runtime invalidation owner. */
export function removeAgentIntegrityMetadataForTest(env: NodeJS.ProcessEnv): void {
  const store = openNodeSqliteDatabase(resolveQuarantineStorePath(env));
  try {
    store.exec("DELETE FROM agent_integrity_verifications");
  } finally {
    store.close();
  }
}

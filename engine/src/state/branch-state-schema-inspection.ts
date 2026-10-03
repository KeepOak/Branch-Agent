import type { DatabaseSync } from "node:sqlite";
import {
  collectSqliteSchemaIssues,
  createSqliteTableContractReader,
  type SqliteSchemaIssue,
} from "../infra/sqlite-schema-contract.js";
import { SqliteSchemaMismatchError } from "../infra/sqlite-schema-issues.js";
import { assertBranchStateDatabaseOwner } from "./branch-state-db-maintenance.js";
import {
  getBranchStateRuntimeSchema,
  isBranchStateFirstUseSchemaIssue,
  isBranchStateStartupRepairableSchemaIssue,
  BRANCH_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY,
  STATE_PERSISTENT_SCHEMA_COMPATIBILITY,
} from "./branch-state-schema-compatibility.js";
import { BRANCH_STATE_SCHEMA_SQL } from "./branch-state-schema.js";

function deduplicateSchemaIssues(issues: readonly SqliteSchemaIssue[]): SqliteSchemaIssue[] {
  return [
    ...new Map(
      issues.map((issue) => [`${issue.code}\0${issue.objectName}`, issue] as const),
    ).values(),
  ];
}

export function inspectCurrentStateStartupSchema(
  database: DatabaseSync,
  databasePath: string,
  foundVersion: number,
) {
  const metadata = assertBranchStateDatabaseOwner(database, { pathname: databasePath });
  if (metadata?.schema_version !== foundVersion) {
    throw new SqliteSchemaMismatchError(
      `Branch Agent state database ${databasePath} metadata schema version ${typeof metadata?.schema_version === "number" ? metadata.schema_version : "invalid"} does not match ${foundVersion}.`,
    );
  }
  // Both policies inspect the same private or immutable snapshot; later opens read fresh facts.
  const readTable = createSqliteTableContractReader(database);
  const issues = deduplicateSchemaIssues([
    ...collectSqliteSchemaIssues(
      database,
      BRANCH_STATE_SCHEMA_SQL,
      BRANCH_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY,
      readTable,
    ),
    ...collectSqliteSchemaIssues(
      database,
      getBranchStateRuntimeSchema({ includeVersionLazyAdditiveTables: false }),
      STATE_PERSISTENT_SCHEMA_COMPATIBILITY,
      readTable,
    ),
  ]);
  return {
    blockingIssues: issues.filter(
      (issue) =>
        !isBranchStateStartupRepairableSchemaIssue(issue) &&
        !isBranchStateFirstUseSchemaIssue(issue),
    ),
    startupRepairableIssues: issues.filter(isBranchStateStartupRepairableSchemaIssue),
  };
}

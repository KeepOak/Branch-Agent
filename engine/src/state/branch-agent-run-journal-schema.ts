import type { DatabaseSync } from "node:sqlite";
import { createSqliteSchemaEnsurer } from "../infra/sqlite-schema-ensure.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "./branch-agent-schema.js";

export const RUN_JOURNAL_TABLE = "run_journal";
const schema = createSqliteSchemaEnsurer(() =>
  extractSqliteTableSchema(BRANCH_AGENT_SCHEMA_SQL, RUN_JOURNAL_TABLE, {
    endMarker: "CREATE TABLE IF NOT EXISTS session_nodes (",
    includeEndMarker: false,
    errorMessage: "Branch Agent run journal schema markers are missing.",
  }),
);

/** Additive migration, on the existing per-Trunk writer, before its first run. */
export function ensureRunJournalSchema(database: DatabaseSync): void {
  schema.ensure(database);
}

export const recordRunJournalSchemaCommitted = schema.recordCommitted;

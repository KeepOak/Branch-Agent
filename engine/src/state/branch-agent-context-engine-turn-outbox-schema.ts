import type { DatabaseSync } from "node:sqlite";
import { createSqliteSchemaEnsurer } from "../infra/sqlite-schema-ensure.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "./branch-agent-schema.js";

export const CONTEXT_ENGINE_TURN_OUTBOX_TABLE = "context_engine_turn_outbox";

const schema = createSqliteSchemaEnsurer(() =>
  extractSqliteTableSchema(BRANCH_AGENT_SCHEMA_SQL, CONTEXT_ENGINE_TURN_OUTBOX_TABLE, {
    endMarker: "CREATE TABLE IF NOT EXISTS cache_entries (",
    includeEndMarker: false,
    errorMessage: "Branch Agent context-engine turn outbox schema markers are missing.",
  }),
);

/**
 * Records that a caller-owned transaction which ran the lazy DDL committed, so
 * later commands on this connection skip it.
 */
export const recordContextEngineTurnOutboxSchemaCommitted = schema.recordCommitted;

/** Lazily installs the additive context-engine turn outbox on first use. */
export function ensureContextEngineTurnOutboxSchema(db: DatabaseSync): void {
  schema.ensure(db);
}

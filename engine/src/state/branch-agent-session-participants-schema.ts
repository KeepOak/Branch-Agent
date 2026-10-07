import { createSqliteSchemaEnsurer } from "../infra/sqlite-schema-ensure.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import { SESSION_PARTICIPANTS_TABLE } from "./branch-agent-db-contract.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "./branch-agent-schema.js";

export function sessionParticipantsSchemaSql(): string {
  return extractSqliteTableSchema(BRANCH_AGENT_SCHEMA_SQL, SESSION_PARTICIPANTS_TABLE, {
    endMarker: "CREATE TABLE IF NOT EXISTS session_key_contract (",
    includeEndMarker: false,
    errorMessage: "Branch Agent session participant schema markers are missing.",
  });
}

export const {
  ensure: ensureSessionParticipantsSchema,
  recordCommitted: confirmSessionParticipantsSchemaEnsured,
} = createSqliteSchemaEnsurer(sessionParticipantsSchemaSql);

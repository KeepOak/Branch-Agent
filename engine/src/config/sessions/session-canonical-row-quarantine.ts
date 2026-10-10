import { executeSqliteQueryTakeFirstSync } from "../../infra/kysely-sync.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { BranchAgentDatabase } from "../../state/branch-agent-db.js";
import { recordBranchSessionRowQuarantine } from "../../state/branch-quarantine-store.js";
import { readExactSessionEntryRowForCanonicalRepair } from "./session-accessor.sqlite-canonical-repair.js";
import { writeSessionEntry } from "./session-accessor.sqlite-entry-store.js";
import { getSessionKysely } from "./session-accessor.sqlite-scope.js";
import type { InvalidCanonicalSessionRow } from "./session-canonical-validation.js";

const log = createSubsystemLogger("sessions/canonical-validation");

/**
 * Sets one invalid session row aside so its agent can still start (#360): the stored row is
 * recorded in the quarantine store, then rewritten from its own entry the way Doctor's import
 * repairs a malformed row. The transcript, windows and other rows that reference the key stay.
 * Runs inside the caller's write transaction; the rewrite certifies the row or throws.
 */
export function quarantineInvalidCanonicalSessionRow(
  database: BranchAgentDatabase,
  invalid: InvalidCanonicalSessionRow,
  env: NodeJS.ProcessEnv,
): void {
  const sessionKey = invalid.row.session_key;
  const stored = executeSqliteQueryTakeFirstSync(
    database.db,
    getSessionKysely(database.db)
      .selectFrom("session_nodes")
      .selectAll()
      .where("session_key", "=", sessionKey),
  );
  const repairable = readExactSessionEntryRowForCanonicalRepair(database, sessionKey, {
    allowMalformedRowRepair: true,
  });
  if (!stored || !repairable) {
    throw new Error(`Invalid session row ${sessionKey} changed before its repair`);
  }
  // Record first: a rewrite whose original was not kept must not happen.
  recordBranchSessionRowQuarantine({
    env,
    path: database.path,
    sessionKey,
    row: { ...stored },
    reason: invalid.reason,
  });
  writeSessionEntry(database, sessionKey, repairable.entry, {
    allowStoredAliases: true,
    preserveNodeSuggestions: true,
    previousEntry: repairable.entry,
  });
  log.warn("invalid session row set aside and rewritten from its entry; the original is in the quarantine store", {
    agentId: database.agentId,
    sessionKey,
    reason: invalid.reason,
  });
}

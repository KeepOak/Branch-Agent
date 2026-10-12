import { executeSqliteQuerySync } from "../../infra/kysely-sync.js";
import type { BranchAgentDatabase } from "../../state/branch-agent-db.js";
import { isInternalSessionEffectsKey } from "./internal-session-key.js";
import { validateDeliveryCanonicalSessionEntry } from "./session-accessor.sqlite-entry-read.js";
import { parseSessionEntryJson, selectSessionEntryRows } from "./session-accessor.sqlite-status.js";
import { assertCanonicalSqliteSessionKeysCurrent } from "./session-canonical-key.js";

export function readSessionGroupCategoryKeys(
  database: Pick<BranchAgentDatabase, "agentId" | "db">,
  name: string,
): string[] {
  assertCanonicalSqliteSessionKeysCurrent(database);
  return executeSqliteQuerySync(
    database.db,
    selectSessionEntryRows(database, "list").orderBy("session_key"),
  ).rows.flatMap((row) => {
    if (isInternalSessionEffectsKey(row.session_key)) {
      return [];
    }
    const entry = parseSessionEntryJson(row, "list");
    if (!entry) {
      return [];
    }
    validateDeliveryCanonicalSessionEntry(row.session_key, entry);
    return entry.category?.trim() === name ? [row.session_key] : [];
  });
}

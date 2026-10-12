import type { DatabaseSync } from "node:sqlite";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db-contract.js";
import { withExistingBranchStateDatabaseArtifactPreservingReadOnly } from "../state/branch-state-db-readonly.js";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";
import type { DB } from "../state/branch-state-db.generated.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "./kysely-sync.js";
import { UPDATE_RECOVERY_KEY_END, UPDATE_RECOVERY_KEY_PREFIX } from "./update-run-recovery-keys.js";
import {
  decodeUpdateRecovery,
  inspectUpdateRecovery,
  type UpdateRecoveryInspection,
  type UpdateRecoveryRecord,
} from "./update-run-recovery-schema.js";

type RecoveryDatabase = Pick<DB, "update_runs" | "config_machine_state">;

function readRecoveryRows(db: DatabaseSync) {
  if (!tableExists(db, "config_machine_state")) {
    return [];
  }
  return executeSqliteQuerySync(
    db,
    getNodeSqliteKysely<RecoveryDatabase>(db)
      .selectFrom("config_machine_state")
      .select(["state_key", "value_json"])
      .where("state_key", ">=", UPDATE_RECOVERY_KEY_PREFIX)
      .where("state_key", "<", UPDATE_RECOVERY_KEY_END)
      .orderBy("state_key", "asc"),
  ).rows;
}
export function readRecoveries(db: DatabaseSync): UpdateRecoveryRecord[] {
  return readRecoveryRows(db).map((row) =>
    decodeUpdateRecovery(row.value_json, row.state_key.slice(UPDATE_RECOVERY_KEY_PREFIX.length)),
  );
}
function inspectRecoveries(db: DatabaseSync): UpdateRecoveryInspection[] {
  return readRecoveryRows(db).map((row) =>
    inspectUpdateRecovery(row.value_json, row.state_key.slice(UPDATE_RECOVERY_KEY_PREFIX.length)),
  );
}
/** Private read-only compatibility surface for diagnostics and retained-pair
 * inspection. Legacy receipts remain exact historical evidence, never authority.
 * Execution loaders below deliberately reject them instead of upgrading them. */
export function inspectUpdateRecoveries(
  options: BranchStateDatabaseOptions = {},
): UpdateRecoveryInspection[] {
  return (
    withExistingBranchStateDatabaseArtifactPreservingReadOnly(
      ({ db }) => inspectRecoveries(db),
      options,
    ) ?? []
  );
}

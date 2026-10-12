import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { getBranchDatabaseMaintenanceScope } from "../state/branch-state-db-async-lifecycle.js";
import { withExistingBranchStateDatabaseArtifactPreservingReadOnly } from "../state/branch-state-db-readonly.js";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";
import type { DB } from "../state/branch-state-db.generated.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { sanitizeBranchStateLeaseRows } from "../state/branch-state-snapshot-sanitizer.js";
import { parseLegacyExecApprovals, parsePersistedExecApprovals } from "./exec-approvals-config.js";
import { writeExecApprovalsConfigRow } from "./exec-approvals-sqlite.js";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "./kysely-sync.js";
import { createVerifiedSqliteSnapshot } from "./sqlite-snapshot.js";
import { readDatabasePathIdentitySync } from "./sqlite-worker-identity.js";
import type { MigrationMessages } from "./state-migrations.types.js";

function readRow(db: DatabaseSync) {
  return executeSqliteQueryTakeFirstSync(
    db,
    getNodeSqliteKysely<Pick<DB, "exec_approvals_config">>(db)
      .selectFrom("exec_approvals_config")
      .selectAll()
      .where("config_key", "=", "current"),
  );
}

function readCanonicalRow(env: NodeJS.ProcessEnv) {
  return withExistingBranchStateDatabaseArtifactPreservingReadOnly(
    ({ db }) => (tableExists(db, "exec_approvals_config") ? readRow(db) : undefined),
    { env },
  );
}

export function hasLegacySqliteExecApprovals(env: NodeJS.ProcessEnv): boolean {
  const row = readCanonicalRow(env);
  return Boolean(
    row &&
    !parsePersistedExecApprovals(row.raw_json).ok &&
    parseLegacyExecApprovals(row.raw_json).ok,
  );
}

/** The existing exec-policy Doctor owner holds exclusive maintenance for the entire repair. */
export async function repairLegacySqliteExecApprovals(
  env: NodeJS.ProcessEnv,
): Promise<MigrationMessages> {
  const sourcePath = resolveBranchStateSqlitePath(env);
  const identity = readDatabasePathIdentitySync(sourcePath);
  const row = readCanonicalRow(env);
  if (!row || parsePersistedExecApprovals(row.raw_json).ok) {
    return { changes: [], warnings: [] };
  }
  const parsed = parseLegacyExecApprovals(row.raw_json);
  if (!parsed.ok) {
    return { changes: [], warnings: [] };
  }
  const authority = getBranchDatabaseMaintenanceScope();
  if (!authority?.ownsSchemaMaintenance) {
    throw new Error("Exec approval policy repair requires Doctor maintenance ownership.");
  }
  const assertCurrent = () => {
    authority.assertAdmission();
    if (!isDeepStrictEqual(readDatabasePathIdentitySync(sourcePath), identity)) {
      throw new Error("Exec approval database changed during Doctor repair; source retained.");
    }
  };
  assertCurrent();
  const backup = await createVerifiedSqliteSnapshot({
    sourcePath,
    targetPath: `${sourcePath}.pre-exec-approvals-migration-${randomUUID()}.bak`,
    preserveRowIds: true,
    transform: sanitizeBranchStateLeaseRows,
    validate: (snapshot) => {
      if (!isDeepStrictEqual(readRow(snapshot), row)) {
        throw new Error("Exec approval backup does not match the planned policy; source retained.");
      }
    },
    beforePublish: assertCurrent,
  });
  assertCurrent();
  runBranchStateWriteTransaction(
    ({ db }) => {
      assertCurrent();
      const current = readRow(db);
      if (!isDeepStrictEqual(current, row)) {
        throw new Error("Exec approval policy changed during Doctor repair; source retained.");
      }
      writeExecApprovalsConfigRow({ db, file: parsed.value, now: row.updated_at_ms });
    },
    { env },
  );
  return {
    changes: ["Normalized legacy SQLite exec approvals before runtime access."],
    warnings: [],
    notices: [`Preserved original exec approval policy in ${backup.path}.`],
  };
}

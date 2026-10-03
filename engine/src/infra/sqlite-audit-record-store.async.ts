import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import {
  prepareSqliteAuditRecord,
  type SqliteAuditRecordEntry,
} from "./sqlite-audit-record.kernel.js";

/** Serialize the audit record and capture its store before yielding to the shared actor. */
export async function registerSqliteAuditRecordAsync<T>(
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> & {
    scope: string;
    maxEntries: number;
    assertCurrent?: () => void;
  },
  record: SqliteAuditRecordEntry<T>,
): Promise<void> {
  const input = {
    scope: options.scope,
    maxEntries: Math.max(1, Math.floor(options.maxEntries)),
    record: prepareSqliteAuditRecord(options.scope, record),
  };
  const context = captureBranchStateWorkerContext(options);
  await runBranchStateWorkerOperation(
    context,
    (store) => store.execute({ type: "diagnostic.register", input }),
    { assertCurrent: options.assertCurrent },
  );
}

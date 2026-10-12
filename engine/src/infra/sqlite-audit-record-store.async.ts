import { executeExistingBranchStateRead } from "../state/branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import {
  captureBranchStateReadWorkerContext,
  captureBranchStateWorkerContext,
} from "../state/branch-state-worker-context.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import {
  prepareSqliteAuditRecord,
  type SequencedSqliteAuditRecordEntry,
  type SqliteAuditRecordEntry,
} from "./sqlite-audit-record.kernel.js";

export function createSqliteAuditRecordReader<T>(
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> & { scope: string },
) {
  const context = captureBranchStateReadWorkerContext(options);
  const source = { path: context.admission.databasePath, env: context.environment };
  const scope = options.scope;
  return {
    async latest(params: {
      limit: number;
      beforeSequence?: number;
    }): Promise<SequencedSqliteAuditRecordEntry<T>[]> {
      const limit = Math.max(0, Math.floor(params.limit));
      if (limit === 0) {
        return [];
      }
      const result = await executeExistingBranchStateRead(
        source,
        {
          type: "diagnostic.latest",
          input: { scope, limit, beforeSequence: params.beforeSequence },
        },
        { context },
      );
      context.admission.assertCurrent();
      if (!result?.ok || result.type !== "diagnostic.latest") {
        return [];
      }
      // SAFETY: This scope retains the native store's generic JSON payload contract.
      return result.entries as SequencedSqliteAuditRecordEntry<T>[];
    },
  };
}

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

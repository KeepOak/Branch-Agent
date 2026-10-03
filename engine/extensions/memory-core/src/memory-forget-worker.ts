import type { DatabaseSync } from "node:sqlite";
import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import { resolveRuntimeWorkerUrl } from "branch/plugin-sdk/process-runtime";
import {
  openBranchAgentSqliteWorkerStore,
  runBranchAgentWriteAdmission,
  type SqliteWorkerStore,
} from "branch/plugin-sdk/sqlite-runtime";
import type {
  MemoryEntryOriginBinding,
  MemoryEntryOriginOperations,
} from "./memory-entry-origins-task.js";

const loadEntrypoints = createLazyRuntimeModule(
  () => import("./memory/manager-cpu-entrypoints.js"),
);

/** Keep Forget's supplied borrow; the canonical worker checks it at every grant. */
export async function withMemoryForgetWorker<T>(
  options: Parameters<typeof openBranchAgentSqliteWorkerStore>[0],
  db: DatabaseSync,
  input: Extract<MemoryEntryOriginBinding, { kind: "forget" }>,
  operation: (scope: Pick<SqliteWorkerStore<MemoryEntryOriginOperations>, "execute">) => Promise<T>,
): Promise<T> {
  const { memoryCpuProcessEntrypoints } = await loadEntrypoints();
  return runBranchAgentWriteAdmission(
    options,
    async (_identity, assertAdmission) => {
      const worker = await openBranchAgentSqliteWorkerStore<MemoryEntryOriginOperations>(
        options,
        db,
        {
          moduleUrl: resolveRuntimeWorkerUrl(memoryCpuProcessEntrypoints.entryOrigins),
          input,
        },
      );
      try {
        return await worker.run(operation, assertAdmission);
      } finally {
        await worker.close();
      }
    },
    true,
  );
}

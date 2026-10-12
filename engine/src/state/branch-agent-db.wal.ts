import { registerSqliteWalWorkerMaintenance } from "../infra/sqlite-wal-write-admission.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import type { BranchAgentDatabase } from "./branch-agent-db-contract.js";
import { readBranchAgentDatabaseIdentity } from "./branch-agent-db-identity.js";
import { agentDatabaseLifecycle, retainAgentDatabase } from "./branch-agent-db-lifecycle.js";
import { registerBranchAgentDatabaseAsyncResource } from "./branch-agent-db-resources.js";
import { runBranchAgentWorkerWrite } from "./branch-agent-write-admission.js";

/** Keep the published timer's exact native owner pinned through worker settlement. */
export function registerBranchAgentWalMaintenance(
  database: BranchAgentDatabase,
  env: NodeJS.ProcessEnv,
): void {
  const options = { agentId: database.agentId, path: database.path, env };
  const identity = readBranchAgentDatabaseIdentity(database);
  if (typeof identity.identity !== "string") {
    return;
  }
  const expectedIdentity = {
    kind: "file" as const,
    physicalIdentity: identity.identity,
    birthtime: identity.birthtime,
    nativeLocation: identity.filename,
  };
  const controller = new AbortController();
  let pending: Promise<unknown> | undefined;
  let unregister: (() => void) | undefined;
  const cancel = () => {
    controller.abort();
  };
  const assertCurrent = () => {
    controller.signal.throwIfAborted();
    if (agentDatabaseLifecycle.databases.get(database.path) !== database || !database.db.isOpen) {
      throw new Error("Agent WAL maintenance owner changed");
    }
  };
  registerSqliteWalWorkerMaintenance(
    database.db,
    async (request) => {
      if (controller.signal.aborted) {
        return undefined;
      }
      const release = retainAgentDatabase(database.db);
      const active = runBranchAgentWorkerWrite(
        options,
        async () => {
          assertCurrent();
          unregister = registerBranchAgentDatabaseAsyncResource({
            ...options,
            revoke: cancel,
            async close() {
              cancel();
              await pending?.catch(() => {});
            },
          });
          const { captureBranchAgentDatabaseExecution } =
            await import("./branch-agent-execution.js");
          assertCurrent();
          const execution = captureBranchAgentDatabaseExecution(options, { expectedIdentity });
          try {
            const result = await execution.runExisting(
              {
                assertCurrent,
                createAdmission: (binding) => () => ({
                  nativeLocations: binding.nativeLocations,
                  admission: createSqliteWorkerOperationAdmission((authority, grant) => {
                    binding.authorize(authority);
                    assertCurrent();
                    if (!grant()) {
                      throw new Error("Agent WAL maintenance authority expired");
                    }
                  }, binding.attachment),
                }),
              },
              (worker) => worker.execute({ type: "database.walMaintenance", input: request }),
            );
            assertCurrent();
            execution.assertCurrent();
            return result;
          } finally {
            await execution.release();
          }
        },
        undefined,
        controller.signal,
      );
      pending = active;
      try {
        return await active;
      } finally {
        release();
        pending = undefined;
        unregister?.();
        unregister = undefined;
      }
    },
    cancel,
  );
}

import { throwSqliteLifecycleErrors } from "../infra/sqlite-lifecycle-errors.js";
import { readDatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { runSqliteWorkerStoreOperation } from "../infra/sqlite-worker-store.js";
import type { BranchAgentDatabaseWorkerLeaseReceipt } from "./branch-agent-db-lease.js";
import { invalidateBranchAgentDatabaseValidation } from "./branch-agent-db-validation-cache.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";
import { openBranchStateWorkerCleanupStore } from "./branch-state-worker-store.js";

/** Release only this owner's prepared lease after the broker certifies native retirement. */
export async function cleanupRetiredAgentDatabaseLease(params: {
  context: BranchStateWorkerContext;
  stopped: Promise<void>;
  assertOwned(): void;
  lease: BranchAgentDatabaseWorkerLeaseReceipt;
}): Promise<void> {
  params.assertOwned();
  await params.stopped;
  params.assertOwned();
  const observed = await readDatabasePathIdentity(params.lease.sharedStatePath);
  if (observed.key !== params.lease.sharedStateIdentity) {
    throw new Error("Retired agent cleanup cannot adopt a replacement shared database");
  }
  const context = {
    environment: params.context.environment,
    existingSchemaPath: params.context.existingSchemaPath,
  };
  const store = await openBranchStateWorkerCleanupStore(
    params.lease.sharedStatePath,
    context,
    () => params.assertOwned(),
  ).catch((error: unknown) => {
    if (error instanceof Error) {
      error.message += ` (leaseId=${params.lease.leaseId}, path=${params.lease.path})`;
      error.stack = `${error.name}: ${error.message}\n${error.stack ?? ""}`;
    }
    throw error;
  });
  if (!store) {
    throw new Error("Retired agent cleanup lost its original shared database");
  }
  const errors: unknown[] = [];
  try {
    await runSqliteWorkerStoreOperation(
      store,
      (scope) => scope.execute({ type: "agentDatabases.releaseExitedLease", input: params.lease }),
      context,
      () => params.assertOwned(),
      () => ({
        nativeLocations: [params.lease.sharedStatePath],
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          params.assertOwned();
          if (request.stage === "prepare" && request.facts === "agent-integrity-invalidated") {
            invalidateBranchAgentDatabaseValidation(params.lease.path);
          }
          grant();
        }),
      }),
    );
  } catch (error) {
    errors.push(error);
  }
  try {
    await store.close();
  } catch (error) {
    errors.push(error);
  }
  throwSqliteLifecycleErrors(errors, "Retired agent lease cleanup and Worker close failed");
}

import { AsyncLocalStorage } from "node:async_hooks";
import type { SqliteWorkerAdmissionFactory } from "../infra/sqlite-worker-operation-admission.js";
import {
  getSqliteWorkerActorIdentity,
  runSqliteWorkerStoreOperation,
} from "../infra/sqlite-worker-store.js";
import { StateDatabaseReadAdmissionInvalidatedError } from "./branch-state-db-async-lifecycle.js";
import { branchStateDatabaseCache } from "./branch-state-db-cache.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";
import type {
  OpeningAdmission,
  Store,
  StoreOperations,
} from "./branch-state-worker-store.types.js";

/** A live alias cannot authorize a worker still bound to a vanished opening path. */
export function assertBranchStateWorkerActorPath(
  actor: ReturnType<typeof getSqliteWorkerActorIdentity>,
): void {
  const identity = branchStateDatabaseCache.getKnownBranchStateDatabaseIdentity(
    actor.databasePath,
  );
  if (identity?.key !== actor.key) {
    throw new StateDatabaseReadAdmissionInvalidatedError(
      "Shared-state worker opening path changed",
    );
  }
}

export function runWithCapturedWorkerContext<T>(
  context: BranchStateWorkerContext,
  operation: () => Promise<T>,
): Promise<T> {
  const maintenance = context.maintenanceScope;
  const run = () =>
    maintenance ? maintenance.run(() => maintenance.track(operation())) : operation();
  return context.runInCapturedSchemaScope ? context.runInCapturedSchemaScope(run) : run();
}

export function runWithBranchStateWorkerStore<T>(
  store: Store,
  context: BranchStateWorkerContext,
  operation: (scope: Pick<Store, "execute">) => Promise<T>,
  assertCurrent?: (commandType?: PropertyKey) => void,
  createAdmission?: SqliteWorkerAdmissionFactory,
): Promise<T> {
  const { admission } = context;
  const actor = getSqliteWorkerActorIdentity(store);
  return runSqliteWorkerStoreOperation<StoreOperations, T>(
    store,
    operation,
    context,
    (commandType) => {
      admission.assertCurrent();
      assertBranchStateWorkerActorPath(actor);
      assertCurrent?.(commandType);
    },
    createAdmission,
  );
}

/** Only native opening owns the caller scope; a cached actor must not retain it. */
export function captureBranchStateWorkerOpeningGuard(
  context: BranchStateWorkerContext,
  assertCurrent?: () => void,
) {
  const databaseAdmission = context.admission;
  const admission: OpeningAdmission = {
    assertCurrent,
  };
  let captured: (() => void) | undefined = AsyncLocalStorage.bind(() => {
    databaseAdmission.assertCurrent();
    try {
      admission.assertCurrent?.();
    } catch (error) {
      admission.refusal = { error };
      throw error;
    }
  });
  return {
    admission,
    assertCurrent: () => {
      if (!captured) {
        throw new Error("Shared-state worker opening admission is closed");
      }
      captured();
    },
    releaseContext() {
      captured = undefined;
    },
  };
}

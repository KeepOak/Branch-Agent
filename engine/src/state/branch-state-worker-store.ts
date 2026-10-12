import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import type { SqliteWorkerStateContext } from "../infra/sqlite-worker-state-context.js";
import {
  getBranchStateDatabaseTerminalFailureAsync,
  recordBranchStateDatabaseOpenFailure,
  branchStateDatabaseCache,
} from "./branch-state-db-cache.js";
import { findBranchStateDatabaseFailure } from "./branch-state-db-failure.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";
import type {
  BranchStateWorkerOperations,
  BranchStateWorkerInspectionOperations,
  BranchStateWorkerOperationOptions as OperationOptions,
} from "./branch-state-worker-contract.js";
import { hydrateBranchStateWorkerError } from "./branch-state-worker-error.js";
import {
  retainBranchStateWorkerLease,
  type BranchStateWorkerLease,
} from "./branch-state-worker-lease.js";
import {
  runWithCapturedWorkerContext,
  runWithBranchStateWorkerStore,
} from "./branch-state-worker-operation.js";
import { getBranchStateWorkerOwner as owner } from "./branch-state-worker-owner.js";
import type { DomainScope } from "./branch-state-worker-store.types.js";

export type { BranchStateWorkerLease } from "./branch-state-worker-lease.js";

/** Retired cleanup uses the retained owner's backend without renewing read admission. */
export function openBranchStateWorkerCleanupStore(
  databasePath: string,
  context: SqliteWorkerStateContext,
  assertOwned: () => void,
  identity: DatabasePathIdentity,
) {
  return owner().openCleanup(databasePath, context, assertOwned, identity);
}

export async function executeBranchStateWorker<Key extends keyof BranchStateWorkerOperations>(
  context: BranchStateWorkerContext,
  command: { type: Key; input: BranchStateWorkerOperations[Key]["input"] },
): Promise<BranchStateWorkerOperations[Key]["output"]> {
  const result = await runBranchStateWorkerOperation(context, (scope) => scope.execute(command));
  context.admission.assertCurrent();
  return result;
}

/** Retain the canonical actor for capture callbacks and their terminal writes. */
export function createBranchStateWorkerLease(
  context: BranchStateWorkerContext,
  finalize?: (scope: DomainScope) => Promise<void>,
): BranchStateWorkerLease {
  return retainBranchStateWorkerLease(
    context,
    {
      open: (captured) => owner().open(captured),
      retainOperation: (store) => owner().retainOperation(store),
    },
    finalize,
  );
}

/** Retain the actor through its durable result and main-process reconciliation. */
export function runBranchStateWorkerOperation<T>(
  context: BranchStateWorkerContext,
  operation: (scope: DomainScope) => Promise<T>,
  options?: OperationOptions & { existingOnly?: false },
): Promise<T>;
export function runBranchStateWorkerOperation<T>(
  context: BranchStateWorkerContext,
  operation: (scope: DomainScope) => Promise<T>,
  options: OperationOptions & { existingOnly: boolean },
): Promise<T | undefined>;
export async function runBranchStateWorkerOperation<T>(
  context: BranchStateWorkerContext,
  operation: (scope: DomainScope) => Promise<T>,
  options?: OperationOptions,
): Promise<T | undefined> {
  return runWithCapturedWorkerContext(context, async () => {
    try {
      context.admission.assertCurrent();
      options?.assertCurrent?.();
      const failure = await getBranchStateDatabaseTerminalFailureAsync(context);
      if (failure) {
        throw failure;
      }
      context.admission.assertCurrent();
      options?.assertCurrent?.();
      const store = await owner().open(context, options);
      context.admission.assertCurrent();
      if (!store) {
        if (options?.existingOnly) {
          return undefined;
        }
        throw new Error("Canonical shared-state worker did not open its database");
      }
      const releaseOperation = owner().retainOperation(store);
      try {
        context.admission.assertCurrent();
        options?.assertCurrent?.();
        return await runWithBranchStateWorkerStore(
          store,
          context,
          operation,
          options?.assertCurrent,
          options?.createAdmission,
        );
      } finally {
        // The owner observes retirement; other clients may await this operation's result.
        void releaseOperation();
      }
    } catch (error) {
      const hydrated = hydrateBranchStateWorkerError(error);
      const failure = findBranchStateDatabaseFailure(hydrated, context.admission.databasePath);
      if (
        failure &&
        !branchStateDatabaseCache.getBranchStateDatabaseRecordedFailure(
          context.admission.databasePath,
        )
      ) {
        try {
          context.admission.assertCurrent();
        } catch {
          // A retired generation cannot publish a refusal against its replacement.
          throw hydrated;
        }
        recordBranchStateDatabaseOpenFailure(context.admission.databasePath, failure);
      }
      throw hydrated;
    }
  });
}

/** Inspect the existing file without recursively admitting a domain operation. */
export async function inspectBranchStateDatabase(
  context: BranchStateWorkerContext,
  command: {
    type: "database.generationMatches";
    input: BranchStateWorkerInspectionOperations["database.generationMatches"]["input"];
  },
): Promise<boolean | undefined> {
  return runWithCapturedWorkerContext(context, async () => {
    try {
      const store = await owner().open(context, { existingOnly: true });
      context.admission.assertCurrent();
      if (!store) {
        return undefined;
      }
      const releaseOperation = owner().retainOperation(store);
      try {
        context.admission.assertCurrent();
        return await runWithBranchStateWorkerStore(store, context, (scope) =>
          scope.execute(command),
        );
      } finally {
        void releaseOperation();
      }
    } catch (error) {
      throw hydrateBranchStateWorkerError(error);
    }
  });
}

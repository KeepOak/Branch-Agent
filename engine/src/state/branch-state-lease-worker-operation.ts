import type { BranchStateWorkerLeaseContext } from "./branch-state-lease-context.js";
import {
  withBranchStateLeaseWorkerAdmission,
  withBranchStateLeasesWorkerAdmission,
  type BranchStateLeaseWorkerAuthority,
} from "./branch-state-lease-worker-owner.js";
import { prepareBranchStateLeaseStorageRuntime } from "./branch-state-lease-worker-storage.js";
import type { BranchStateLeaseIdentity } from "./branch-state-lease.types.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";
import type { DomainScope } from "./branch-state-worker-store.types.js";

/** Both importers must resolve their transport before package replacement. */
export async function prepareBranchStateLeaseWorkerRuntime(): Promise<void> {
  await Promise.all([
    prepareBranchStateLeaseStorageRuntime(),
    import("./branch-state-worker-store.js"),
  ]);
}

/** Retain the actual lease until every admitted worker transaction has settled. */
export function runWithBranchStateLeaseWorker<T>(
  lease: BranchStateWorkerLeaseContext,
  context: BranchStateWorkerContext,
  operation: (scope: DomainScope, identity: BranchStateLeaseIdentity) => Promise<T>,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<T> {
  return withBranchStateLeaseWorkerAdmission(
    lease,
    context.admission.databasePath,
    async (admission) => {
      const { runBranchStateWorkerOperation } = await import("./branch-state-worker-store.js");
      return runBranchStateWorkerOperation(
        context,
        (scope) => operation(scope, admission.identity),
        { assertCurrent: admission.assertCurrent, createAdmission: admission.createAdmission },
      );
    },
    authority,
  );
}

/** Share one actor operation while every original lease retains its native settlement. */
export function runWithBranchStateLeasesWorker<T>(
  leases: readonly BranchStateWorkerLeaseContext[],
  context: BranchStateWorkerContext,
  operation: (scope: DomainScope, identities: readonly BranchStateLeaseIdentity[]) => Promise<T>,
  authority?: BranchStateLeaseWorkerAuthority,
): Promise<T> {
  return withBranchStateLeasesWorkerAdmission(
    leases,
    context,
    async (admission) => {
      const { runBranchStateWorkerOperation } = await import("./branch-state-worker-store.js");
      admission.assertCurrent();
      return runBranchStateWorkerOperation(
        context,
        (scope) => operation(scope, admission.identities),
        {
          assertCurrent: admission.assertCurrent,
          createAdmission: admission.createAdmission,
        },
      );
    },
    authority,
  );
}

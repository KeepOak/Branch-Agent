import { vi } from "vitest";
import * as workerAdmission from "../../infra/sqlite-worker-operation-admission.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";
import { releaseBranchStateLeaseInTransaction } from "../../state/branch-state-lease-store.js";
import { withBranchStateLeasesWorkerAdmission } from "../../state/branch-state-lease-worker-owner.js";
import { WORKTREE_CAPACITY_RESERVATION_SCOPE } from "./capacity-contract.js";
import * as transport from "./capacity-store.js";
import { reserveWorktreeCapacityInWorker } from "./capacity.worker.js";

/** Synthetic filesystem quotas use the real admission kernel in the fixture's process. */
export function useInProcessWorktreeCapacityTransport() {
  vi.spyOn(transport, "reserveWorktreeCapacity").mockImplementation(async (params) =>
    withBranchStateLeasesWorkerAdmission(
      params.leaseSet.leases,
      params.leaseSet.context,
      async (authority) => {
        params.assertCurrent();
        const options = {
          path: params.leaseSet.context.admission.databasePath,
          env: params.leaseSet.context.environment,
        };
        const database = openBranchStateDatabase(options);
        const admission = vi
          .spyOn(workerAdmission, "requestSqliteWorkerOperationAdmission")
          .mockImplementation(() => {
            params.leaseSet.context.admission.assertCurrent();
            params.assertCurrent();
            authority.assertCurrent();
          });
        try {
          return reserveWorktreeCapacityInWorker(
            { ...params.request, leases: authority.identities, predicates: params.predicates },
            { open: () => database, stateOptions: () => options },
          );
        } finally {
          admission.mockRestore();
        }
      },
    ),
  );
  vi.spyOn(transport, "releaseWorktreeCapacity").mockImplementation(async (params) =>
    runBranchStateWriteTransaction(
      ({ db }) => {
        params.assertCurrent();
        releaseBranchStateLeaseInTransaction(db, {
          scope: WORKTREE_CAPACITY_RESERVATION_SCOPE,
          key: params.key,
          owner: params.key,
        });
        params.assertCurrent();
      },
      { path: params.context.admission.databasePath, env: params.context.environment },
    ),
  );
}

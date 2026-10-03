import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { withSqliteIntegrityWorkerScope } from "../infra/sqlite-integrity-worker.js";
import { throwSqliteLifecycleErrors } from "../infra/sqlite-lifecycle-errors.js";
import {
  AGENT_DATABASE_MAINTENANCE_LEASE,
  assertNoBranchAgentDatabaseLeases,
  runWithAgentDatabaseMaintenanceAuthority,
} from "./branch-agent-db-lease.js";
import { closeBranchAgentDatabasesAsync } from "./branch-agent-db-lifecycle.js";
import { clearBranchAgentDatabaseValidationCache } from "./branch-agent-db-validation-cache.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db-contract.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";
import { withBranchStateLease, type BranchStateLeaseContext } from "./branch-state-lease.js";

type MaintenanceScope = {
  databasePath: string;
  owner: BranchStateLeaseContext;
  ancestors: readonly MaintenanceScope[];
  active: boolean;
  accepting: boolean;
  pending: Promise<unknown>[];
  ownership: { failure?: { error: unknown } };
};
const activeMaintenance = new AsyncLocalStorage<MaintenanceScope>();

async function runMaintenanceScope<T>(
  databasePath: string,
  owner: BranchStateLeaseContext,
  run: (lease: BranchStateLeaseContext) => Promise<T>,
  ancestors: readonly MaintenanceScope[] = [],
): Promise<T> {
  const scope: MaintenanceScope = {
    databasePath,
    owner,
    ancestors,
    active: true,
    accepting: true,
    pending: [],
    ownership: ancestors[0]?.ownership ?? {},
  };
  const assertCurrent = () => {
    if (!scope.active || ancestors.some((parent) => !parent.active)) {
      throw new Error("Agent database maintenance scope is closed");
    }
    if (scope.ownership.failure) {
      throw scope.ownership.failure.error;
    }
    try {
      owner.assertOwned();
    } catch (error) {
      // One failed ownership observation retires every scope under the same owner.
      scope.ownership.failure = { error };
      throw error;
    }
  };
  const assertAdmission = () => {
    assertCurrent();
    if (!scope.accepting) {
      throw new Error("Agent database maintenance admission is closed");
    }
  };
  const lease: BranchStateLeaseContext = {
    signal: owner.signal,
    assertOwned: assertCurrent,
    assertOwnedInTransaction(database) {
      assertCurrent();
      owner.assertOwnedInTransaction(database);
    },
    ...(owner.renew
      ? {
          renew() {
            assertAdmission();
            owner.renew!();
          },
        }
      : {}),
  };
  try {
    return await withSqliteIntegrityWorkerScope(assertCurrent, () =>
      activeMaintenance.run(scope, () =>
        runWithAgentDatabaseMaintenanceAuthority(lease, databasePath, async () => {
          let outcome: { value: T } | { error: unknown };
          try {
            assertCurrent();
            outcome = { value: await run(lease) };
          } catch (error) {
            outcome = { error };
          }
          scope.accepting = false;
          const errors: unknown[] = "error" in outcome ? [outcome.error] : [];
          let joined = 0;
          while (joined < scope.pending.length) {
            const admitted = scope.pending.slice(joined);
            joined += admitted.length;
            for (const result of await Promise.allSettled(admitted)) {
              if (result.status === "rejected" && !errors.includes(result.reason)) {
                errors.push(result.reason);
              }
            }
          }
          try {
            assertCurrent();
          } catch (error) {
            if (!errors.includes(error)) {
              errors.push(error);
            }
          }
          throwSqliteLifecycleErrors(errors, "Agent maintenance and nested work failed");
          if ("error" in outcome) {
            throw outcome.error;
          }
          return outcome.value;
        }),
      ),
    );
  } finally {
    scope.active = false;
  }
}

/** Retain one real lease through nested Doctor work; serialized selectors grant no authority. */
export function withAgentDatabaseMaintenanceLease<T>(
  options: Pick<BranchStateDatabaseOptions, "env"> & {
    schemaPolicy?: "existing";
    leaseMs?: number;
    processBound?: boolean;
  },
  run: (maintenance: BranchStateLeaseContext) => Promise<T>,
): Promise<T> {
  const databasePath = path.resolve(resolveBranchStateSqlitePath(options.env));
  const active = activeMaintenance.getStore();
  if (active) {
    if (!active.active || !active.accepting) {
      return Promise.reject(new Error("Agent database maintenance admission is closed"));
    }
    if (active.databasePath !== databasePath) {
      return Promise.reject(new Error("Nested agent maintenance cannot switch its state database"));
    }
    const admitted = runMaintenanceScope(databasePath, active.owner, run, [
      ...active.ancestors,
      active,
    ]);
    active.pending.push(admitted);
    void admitted.catch(() => undefined);
    return admitted;
  }
  return withBranchStateLease(
    {
      ...AGENT_DATABASE_MAINTENANCE_LEASE,
      database: { scope: "shared", options, schemaPolicy: options.schemaPolicy },
      leaseMs: options.leaseMs ?? 60_000,
      waitMs: 5_000,
      prepareDatabase: true,
      heartbeat: "worker",
      processBound: options.processBound,
      leaseLabel: "agent database maintenance lease",
      operationLabel: "agent.database.maintenance.lease",
    },
    (maintenance) =>
      runMaintenanceScope(databasePath, maintenance, async (lease) => {
        await closeBranchAgentDatabasesAsync();
        assertNoBranchAgentDatabaseLeases(lease, options);
        clearBranchAgentDatabaseValidationCache();
        return run(lease);
      }),
  );
}

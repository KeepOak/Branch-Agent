import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { observeHostDataSql } from "../../../test/helpers/sqlite-statement-execution-counter.js";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import { withExistingBranchStateSchema } from "../../state/branch-state-db-schema-policy.js";
import type { DB } from "../../state/branch-state-db.generated.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../../state/branch-state-db.js";
import * as leaseWorker from "../../state/branch-state-lease-worker-operation.js";
import * as stateLeases from "../../state/branch-state-lease.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import { withWorktreeAllocationLease, withWorktreeMutationLease } from "./allocation.js";
import { WORKTREE_CREATE_LEASE_SCOPE, WORKTREE_MUTATION_LEASE_SCOPE } from "./capacity-contract.js";
import {
  createWorktreeDiskAdmission,
  WorktreeCapacityContentionError,
  WORKTREE_CAPACITY_RESERVATION_SCOPE,
} from "./capacity.js";

const roots = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeBranchStateDatabaseAsync();
    closeBranchStateDatabaseForTest();
    cleanup();
  }),
);

function fixture() {
  const root = roots.make("worktree-capacity-worker-");
  const env = { ...process.env, BRANCH_STATE_DIR: root };
  const database = openBranchStateDatabase({ env });
  const debts = () =>
    executeSqliteQuerySync(
      database.db,
      getNodeSqliteKysely<Pick<DB, "state_leases">>(database.db)
        .selectFrom("state_leases")
        .select("lease_key")
        .where("scope", "=", WORKTREE_CAPACITY_RESERVATION_SCOPE),
    ).rows;
  return { root, env, database, debts };
}

it("admits disk debt off-thread and releases it after caller and schema admission end", async () => {
  const f = fixture();
  const caller = new AbortController();
  await withExistingBranchStateSchema({ path: f.database.path }, () => {
    const leaseContext = captureBranchStateWorkerContext({ env: f.env });
    return stateLeases.withBranchStateLeaseAsync(
      {
        scope: WORKTREE_MUTATION_LEASE_SCOPE,
        key: "retirement",
        leaseMs: 60_000,
        waitMs: 0,
        heartbeat: "worker",
      },
      leaseContext,
      async (lease) => {
        const { capacity: retainedCapacity, context: expiredContext } =
          await withExistingBranchStateSchema({ path: f.database.path }, async () => {
            const context = captureBranchStateWorkerContext({ env: f.env });
            const capacity = createWorktreeDiskAdmission({
              env: f.env,
              workerAuthority: {
                leaseSet: { context: leaseContext, leases: [lease] },
                assertCurrent: () => caller.signal.throwIfAborted(),
              },
              assertCurrent: () => caller.signal.throwIfAborted(),
            });
            const sql = observeHostDataSql();
            const disk = vi.spyOn(fs, "statfsSync");
            try {
              await capacity.requireDiskSpace(
                [{ path: f.root, bytes: 1 }],
                "snapshot fixture",
                true,
              );
              expect(sql.queries).toEqual([]);
              expect(disk).not.toHaveBeenCalled();
            } finally {
              disk.mockRestore();
              sql.restore();
            }
            return { capacity, context };
          });
        expect(f.debts()).toHaveLength(1);
        caller.abort(new Error("caller cancelled"));
        expect(() => expiredContext.admission.assertCurrent()).toThrow(
          "schema admission has ended",
        );
        const releaseSql = observeHostDataSql();
        try {
          await retainedCapacity.release();
          expect(releaseSql.queries).toEqual([]);
        } finally {
          releaseSql.restore();
        }
        expect(f.debts()).toEqual([]);
      },
    );
  });
});

it("rolls back disk admission when its live owner is revoked at the worker commit grant", async () => {
  const f = fixture();
  const caller = new AbortController();
  const run = leaseWorker.runWithBranchStateLeasesWorker;
  vi.spyOn(leaseWorker, "runWithBranchStateLeasesWorker").mockImplementation(
    (leases, context, operation, authority) =>
      run(leases, context, operation, {
        ...authority,
        assertCurrent: () => authority?.assertCurrent(),
        beforeCommit: () => {
          caller.abort(new Error("caller revoked at commit"));
          authority?.beforeCommit?.();
        },
      }),
  );
  await expect(
    withWorktreeMutationLease(
      { env: f.env, id: "refused", signal: caller.signal },
      async (guard) => {
        await guard.requireDiskSpace([{ path: f.root, bytes: 1 }], "snapshot fixture", true);
      },
    ),
  ).rejects.toMatchObject({ code: "BRANCH_STATE_LEASE_ABORTED" });
  expect(caller.signal.aborted).toBe(true);
  expect(f.debts()).toEqual([]);
});

it.for(["parent", "child"] as const)(
  "rolls back nested capacity admission when the %s lease expires at commit",
  async (expired) => {
    const f = fixture();
    const expiredScope =
      expired === "parent" ? WORKTREE_CREATE_LEASE_SCOPE : WORKTREE_MUTATION_LEASE_SCOPE;
    const acquire = stateLeases.withBranchStateLeaseAsync;
    vi.spyOn(stateLeases, "withBranchStateLeaseAsync").mockImplementation(
      (options, context, body) =>
        acquire(
          { ...options, leaseMs: options.scope === expiredScope ? 60_000 : 120_000 },
          context,
          body,
        ),
    );
    const runWorker = leaseWorker.runWithBranchStateLeasesWorker;
    let restoreClock: (() => void) | undefined;
    vi.spyOn(leaseWorker, "runWithBranchStateLeasesWorker").mockImplementation(
      (leases, context, operation, authority) =>
        runWorker(leases, context, operation, {
          assertCurrent: () => authority?.assertCurrent(),
          beforeCommit: () => {
            const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 90_000);
            restoreClock = () => clock.mockRestore();
            authority?.beforeCommit?.();
          },
        }),
    );
    await withWorktreeAllocationLease({ env: f.env, id: "nested-restore" }, async (guard) => {
      const capacity = createWorktreeDiskAdmission({
        env: f.env,
        workerAuthority: guard.workerAuthority,
        // Exercise the worker commit grant; native filesystem admission is covered separately.
        assertCurrent: () => {},
      });
      try {
        await expect(
          capacity.requireDiskSpace([{ path: f.root, bytes: 1 }], "nested snapshot fixture", true),
        ).rejects.toMatchObject({ code: "BRANCH_STATE_LEASE_LOST" });
        expect(restoreClock).toBeDefined();
        expect(f.debts()).toEqual([]);
      } finally {
        restoreClock?.();
        await capacity.release();
      }
    });
  },
);

it("preserves typed capacity contention across the worker result boundary", async () => {
  const f = fixture();
  await withWorktreeMutationLease({ env: f.env, id: "removal" }, async (guard) => {
    await guard.requireDiskSpace([{ path: f.root, bytes: 1 }], "snapshot fixture", true);
    const [held] = f.debts();
    await expect(
      withWorktreeAllocationLease({ env: f.env }, async (creation) => {
        await creation.requireDiskSpace(
          [{ path: f.root, bytes: Number.MAX_SAFE_INTEGER }],
          "creation fixture",
        );
      }),
    ).rejects.toMatchObject({
      name: WorktreeCapacityContentionError.name,
      reservationKey: held?.lease_key,
    });
    expect(f.debts()).toEqual([held]);
  });
  expect(f.debts()).toEqual([]);
});

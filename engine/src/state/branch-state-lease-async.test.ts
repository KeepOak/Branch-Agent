import { toErrorObject } from "@branch/normalization-core/error-coercion";
import { describe, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { createDeferredCore } from "../shared/deferred.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { closeBranchStateDatabaseAsync, openBranchStateDatabase } from "./branch-state-db.js";
import {
  withBranchStateLeaseAsync,
  type BranchStateAsyncLeaseContext,
} from "./branch-state-lease.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";

describe("worker state lease lifecycle", () => {
  it("drains an accepted callback and releases its lease during canonical close", async () => {
    await withBranchTestState({ label: "async-lease-canonical-close" }, async (state) => {
      const entered = createDeferredCore<BranchStateAsyncLeaseContext>();
      const finish = createDeferredCore();
      const operation = withBranchStateLeaseAsync(
        { scope: "core:test", key: "close", leaseMs: 30_000, waitMs: 0 },
        captureBranchStateWorkerContext({ env: state.env }),
        async (lease) => {
          entered.resolve(lease);
          await finish.promise;
        },
      );
      const outcome = operation.catch((error: unknown) => error);
      const lease = await Promise.race([
        entered.promise,
        outcome.then((error) => {
          throw toErrorObject(error, "Lease completed before callback entry");
        }),
      ]);
      let closed = false;
      const closing = closeBranchStateDatabaseAsync().then(() => {
        closed = true;
      });
      try {
        if (!lease.signal.aborted) {
          await new Promise<void>((resolve) => {
            lease.signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        expect(closed).toBe(false);
        await expect(lease.renew()).rejects.toMatchObject({
          code: "STATE_DATABASE_READ_ADMISSION_INVALIDATED",
        });
        finish.resolve();
        expect(await outcome).toBeInstanceOf(Error);
        await closing;
        const database = openBranchStateDatabase({ env: state.env });
        expect(
          database.db
            .prepare("SELECT owner FROM state_leases WHERE scope = ? AND lease_key = ?")
            .all("core:test", "close"),
        ).toEqual([]);
      } finally {
        finish.resolve();
        await outcome;
        await closing;
      }
    });
  });

  it.each([
    { heartbeat: undefined, leaseMs: 30_000 },
    { heartbeat: "worker", leaseMs: 30_000 },
    { heartbeat: "worker", leaseMs: 1_000 },
  ] as const)(
    "runs the complete $heartbeat heartbeat lifecycle with a $leaseMs ms lease without parent SQL or waits",
    async ({ heartbeat, leaseMs }) => {
      await withBranchTestState({ label: "async-lease-lifecycle" }, async (state) => {
        const { DatabaseSync, StatementSync } = requireNodeSqlite();
        openBranchStateDatabase({ env: state.env });
        await closeBranchStateDatabaseAsync();
        const parentCalls = {
          prepare: vi.spyOn(DatabaseSync.prototype, "prepare"),
          exec: vi.spyOn(DatabaseSync.prototype, "exec"),
          close: vi.spyOn(DatabaseSync.prototype, "close"),
          get: vi.spyOn(StatementSync.prototype, "get"),
          all: vi.spyOn(StatementSync.prototype, "all"),
          run: vi.spyOn(StatementSync.prototype, "run"),
          iterate: vi.spyOn(StatementSync.prototype, "iterate"),
          wait: vi.spyOn(Atomics, "wait"),
        };
        let retired: BranchStateAsyncLeaseContext | undefined;
        try {
          const context = captureBranchStateWorkerContext({ env: state.env });
          const options = {
            scope: "core:test",
            key: "async-lifecycle",
            leaseMs,
            waitMs: 0,
            heartbeat,
          };
          const blocked = vi.fn(async () => {});
          await withBranchStateLeaseAsync(options, context, async (lease) => {
            retired = lease;
            await lease.assertOwned();
            await lease.renew();
            await expect(
              withBranchStateLeaseAsync(options, context, blocked),
            ).rejects.toMatchObject({
              code: "BRANCH_STATE_LEASE_HELD",
              outcome: {
                kind: "held",
                holder: { owner: expect.any(String), epoch: expect.any(Number) },
              },
            });
            await lease.assertOwned();
          });
          expect(blocked).not.toHaveBeenCalled();
          await expect(retired?.assertOwned()).rejects.toThrow();
          await closeBranchStateDatabaseAsync();
          expect(
            Object.fromEntries(
              Object.entries(parentCalls).map(([name, spy]) => [name, spy.mock.calls.length]),
            ),
          ).toEqual({ prepare: 0, exec: 0, close: 0, get: 0, all: 0, run: 0, iterate: 0, wait: 0 });
        } finally {
          try {
            await closeBranchStateDatabaseAsync();
          } finally {
            for (const spy of Object.values(parentCalls)) {
              spy.mockRestore();
            }
          }
        }
        const database = openBranchStateDatabase({ env: state.env });
        expect(
          database.db
            .prepare("SELECT owner FROM state_leases WHERE scope = ? AND lease_key = ?")
            .all("core:test", "async-lifecycle"),
        ).toEqual([]);
      });
    },
  );
});

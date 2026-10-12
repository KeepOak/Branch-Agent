import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withBranchStateLeaseWorkerAdmission } from "./branch-state-lease-worker-owner.js";
import { BranchStateLeaseError, withBranchStateLease } from "./branch-state-lease.js";

const fixture = vi.hoisted(() => ({
  expiresAt: 10_000,
  forbiddenSqlite: vi.fn(() => {
    throw new Error("Native admission boundary controls must not open SQLite");
  }),
}));

vi.mock("../infra/node-sqlite.js", () => ({
  openNodeSqliteDatabase: fixture.forbiddenSqlite,
}));
vi.mock("./branch-state-lease-worker-storage.js", () => ({
  acquireLease: async () => ({ kind: "acquired", expiresAt: fixture.expiresAt }),
  createBranchStateLeaseWorkerStorage: fixture.forbiddenSqlite,
}));
vi.mock("./branch-state-lease-storage.js", () => ({
  prepareLeaseDatabase: fixture.forbiddenSqlite,
  resolveLeaseDatabasePath: () => "/synthetic-state/lease.sqlite",
  verifyBranchStateLeaseOwnership: () => {
    if (Date.now() >= fixture.expiresAt) {
      throw new BranchStateLeaseError("Synthetic lease ownership expired", {
        code: "BRANCH_STATE_LEASE_LOST",
      });
    }
    return fixture.expiresAt;
  },
  renewBranchStateLease: () => {
    fixture.expiresAt = Date.now() + 1_000;
    return fixture.expiresAt;
  },
  releaseBranchStateLeaseBestEffort: async () => {},
  releaseBranchStateLease: () => {},
}));
vi.mock("./branch-state-lease-heartbeat.js", () => ({
  startBranchStateLeaseHeartbeat: () => {
    throw new Error("Native timer controls must not start a heartbeat worker");
  },
}));

beforeEach(() => {
  fixture.expiresAt = 10_000;
  vi.useFakeTimers();
  vi.setSystemTime(9_000);
});

afterEach(() => {
  expect(fixture.forbiddenSqlite).not.toHaveBeenCalled();
  vi.useRealTimers();
});

it.each(["live", "expired", "renewed"] as const)(
  "admits the next effect only while the original native lease is %s",
  async (state) => {
    const effect = vi.fn();
    const operation = withBranchStateLease(
      {
        scope: "projects.checkout",
        key: "synthetic-checkout",
        database: { scope: "shared" },
        leaseMs: 1_000,
        waitMs: 0,
      },
      async (lease) =>
        withBranchStateLeaseWorkerAdmission(
          lease,
          "/synthetic-state/lease.sqlite",
          async (admission) => {
            if (state === "renewed") {
              vi.setSystemTime(9_500);
              lease.renew?.();
            }
            // Change only the clock; the queued expiry callback has not run.
            vi.setSystemTime(state === "live" ? 9_999 : 10_000);
            admission.assertCurrent();
            effect();
          },
        ),
    );
    if (state === "expired") {
      await expect(operation).rejects.toMatchObject({ code: "BRANCH_STATE_LEASE_LOST" });
    } else {
      await operation;
    }
    expect(effect).toHaveBeenCalledTimes(state === "expired" ? 0 : 1);
  },
);

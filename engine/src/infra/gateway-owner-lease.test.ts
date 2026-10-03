import { existsSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as pidAlive from "../shared/pid-alive.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
  repairBranchStateDatabaseSchema,
  withBranchStateStartupMigrationCheckpointDatabase,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import * as leaseHeartbeat from "../state/branch-state-lease-heartbeat.js";
import { renewBranchStateLeaseInTransaction } from "../state/branch-state-lease-store.js";
import { acquireGatewayLock } from "./gateway-lock.js";
import {
  acquireGatewayOwnerLease,
  readGatewayOwnerLease,
  type GatewayOwnerLease,
} from "./gateway-owner-lease.js";
import * as stateOwners from "./gateway-state-owner.js";
import { acquireGatewayStateOwner, tryAcquireGatewayStateOwner } from "./gateway-state-owner.js";
import { runSqliteImmediateTransactionSync } from "./sqlite-transaction.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeBranchStateDatabaseForTest();
  vi.restoreAllMocks();
});

function fixture() {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-gateway-owner-") };
  const databasePath = resolveBranchStateSqlitePath(env);
  const coordinator = acquireGatewayStateOwner({
    databasePath,
    payload: {
      pid: process.pid,
      createdAt: new Date().toISOString(),
      configPath: path.join(env.BRANCH_STATE_DIR, "branch.json"),
      role: "gateway",
    },
  });
  return { env, databasePath, coordinator };
}

function seedOwner(
  env: NodeJS.ProcessEnv,
  params: { pid?: number; host?: string; startedAt?: number | null; expiresAt?: number } = {},
) {
  withBranchStateStartupMigrationCheckpointDatabase(
    (db) => {
      db.prepare(
        `INSERT INTO state_leases
         (scope, lease_key, owner, expires_at, heartbeat_at, payload_json, created_at, updated_at)
         VALUES ('gateway-owner', 'global', 'previous-generation', ?, ?, ?, ?, ?)`,
      ).run(
        params.expiresAt ?? Date.now() + 300_000,
        Date.now(),
        JSON.stringify({
          owner: {
            pid: params.pid ?? process.pid,
            host: params.host ?? hostname(),
            startedAt:
              params.startedAt === undefined
                ? pidAlive.getFileLockProcessStartTime(process.pid)
                : params.startedAt,
          },
          port: 19483,
          mode: "foreground",
          supervisor: null,
        }),
        Date.now(),
        Date.now(),
      );
    },
    { env },
  );
}

describe("Gateway owner lease", () => {
  it.each([
    { label: "replacement generation", owner: "replacement", startedAt: null },
    { label: "already recorded identity", owner: "previous-generation", startedAt: 1 },
    { label: "expired generation", owner: "previous-generation", startedAt: null, expired: true },
  ])("does not repair the process identity of an $label", ({ owner, startedAt, expired }) => {
    const { env, coordinator } = fixture();
    try {
      seedOwner(env, { startedAt, ...(expired ? { expiresAt: Date.now() - 1 } : {}) });
      withBranchStateStartupMigrationCheckpointDatabase(
        (db) => {
          db.prepare("UPDATE state_leases SET owner = ? WHERE scope = 'gateway-owner'").run(owner);
          const before = readGatewayOwnerLease({ env });
          runSqliteImmediateTransactionSync(db, () =>
            renewBranchStateLeaseInTransaction(
              db,
              { scope: "gateway-owner", key: "global", owner: "previous-generation" },
              300_000,
              { pid: process.pid, host: hostname(), startedAt: 2 },
            ),
          );
          expect(readGatewayOwnerLease({ env })).toEqual(before);
        },
        { env },
      );
    } finally {
      coordinator.release();
    }
  });

  it("retries a transient own-process identity lookup before publishing", async () => {
    const { env, coordinator } = fixture();
    const readStartTime = pidAlive.getFileLockProcessStartTime;
    vi.spyOn(pidAlive, "getFileLockProcessStartTime")
      .mockReturnValueOnce(null)
      .mockImplementation(readStartTime);
    let lease: GatewayOwnerLease | undefined;
    try {
      lease = acquireGatewayOwnerLease({ env, port: 19483, mode: "foreground", supervisor: null });
      await lease.ready;
      expect(readGatewayOwnerLease({ env })?.state).toBe("live");
    } finally {
      await lease?.release();
      coordinator.release();
    }
  });

  it("repairs a missing publication identity on heartbeat and becomes live", async () => {
    const { env, coordinator } = fixture();
    const startHeartbeat = leaseHeartbeat.startBranchStateLeaseHeartbeat;
    vi.spyOn(leaseHeartbeat, "startBranchStateLeaseHeartbeat").mockImplementation((params) =>
      startHeartbeat({ ...params, heartbeatMs: 100 }),
    );
    const lookup = vi.spyOn(pidAlive, "getFileLockProcessStartTime").mockReturnValue(null);
    let lease: GatewayOwnerLease | undefined;
    try {
      lease = acquireGatewayOwnerLease({ env, port: 19483, mode: "foreground", supervisor: null });
      expect(readGatewayOwnerLease({ env })).toMatchObject({ startedAt: null, state: "unknown" });
      lookup.mockRestore();
      await lease.ready;
      await expect.poll(() => readGatewayOwnerLease({ env })?.state).toBe("live");
      expect(readGatewayOwnerLease({ env })).toMatchObject({
        owner: lease.owner,
        startedAt: pidAlive.getFileLockProcessStartTime(process.pid),
      });
    } finally {
      await lease?.release();
      coordinator.release();
    }
  });

  it("records the Gateway owner before listening and releases its identity with the lock", async () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("branch-gateway-owner-publication-") };
    const lock = await acquireGatewayLock({
      env,
      allowInTests: true,
      port: 18789,
      listenerMode: "foreground",
    });
    if (!lock) {
      throw new Error("Expected gateway lock");
    }
    try {
      expect(readGatewayOwnerLease({ env })).toMatchObject({
        pid: process.pid,
        port: 18789,
        mode: "foreground",
        supervisor: null,
        state: "live",
        expired: false,
      });
    } finally {
      await lock.release();
    }
    expect(readGatewayOwnerLease({ env })).toBeUndefined();
  });

  it("retains physical custody when heartbeat startup and cleanup both fail", async () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("branch-gateway-owner-startup-failure-") };
    const acquire = stateOwners.acquireGatewayStateOwner;
    let coordinator: ReturnType<typeof acquire> | undefined;
    vi.spyOn(stateOwners, "acquireGatewayStateOwner").mockImplementation((params) => {
      coordinator = acquire(params);
      return coordinator;
    });
    vi.spyOn(leaseHeartbeat, "startBranchStateLeaseHeartbeat").mockImplementation(() => ({
      ready: Promise.reject(new Error("heartbeat startup failed")),
      assertRunning() {
        throw new Error("heartbeat startup failed");
      },
      async verify() {
        throw new Error("heartbeat startup failed");
      },
      async renew() {
        throw new Error("heartbeat startup failed");
      },
      close: () => undefined,
      stop: async () => {
        throw new Error("heartbeat cleanup retained native custody");
      },
      assertResponsive: () => undefined,
    }));
    try {
      await expect(
        acquireGatewayLock({
          allowInTests: true,
          env,
          port: 19483,
          listenerMode: "foreground",
        }),
      ).rejects.toThrow("heartbeat cleanup retained native custody");
      if (!coordinator) {
        throw new Error("Gateway did not acquire its process owner");
      }
      const contender = tryAcquireGatewayStateOwner(resolveBranchStateSqlitePath(env));
      contender?.release();
      expect(contender).toBeNull();
    } finally {
      coordinator?.release();
    }
  });

  it("does not create shared state while looking for a previous Gateway", () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("branch-gateway-owner-missing-") };
    expect(readGatewayOwnerLease({ env })).toBeUndefined();
    expect(existsSync(resolveBranchStateSqlitePath(env))).toBe(false);
  });

  it("publishes a readable owner while holding the physical process owner and releases its publication", async () => {
    const { env, coordinator } = fixture();
    let lease: GatewayOwnerLease | undefined;
    try {
      lease = acquireGatewayOwnerLease({
        env,
        port: 19483,
        mode: "foreground",
        supervisor: null,
        owner: "gateway-generation",
      });
      await lease.ready;
      expect(tryAcquireGatewayStateOwner(resolveBranchStateSqlitePath(env))).toBeNull();
      expect(readGatewayOwnerLease({ env })).toEqual({
        owner: "gateway-generation",
        pid: process.pid,
        host: hostname(),
        startedAt: pidAlive.getFileLockProcessStartTime(process.pid),
        port: 19483,
        mode: "foreground",
        supervisor: null,
        state: "live",
        expired: false,
      });
      expect(readGatewayOwnerLease({ env, port: 19484 })).toBeUndefined();
      const heartbeat = withBranchStateStartupMigrationCheckpointDatabase(
        (db) =>
          db
            .prepare(
              "SELECT created_at, heartbeat_at FROM state_leases WHERE scope = 'gateway-owner'",
            )
            .get(),
        { env },
      );
      expect(Number(heartbeat?.heartbeat_at)).toBeGreaterThan(Number(heartbeat?.created_at));

      expect(repairBranchStateDatabaseSchema({ env }).warnings).toEqual([]);
      await closeBranchStateDatabaseAsync();
      expect(readGatewayOwnerLease({ env })?.owner).toBe("gateway-generation");

      await lease.release();
      expect(readGatewayOwnerLease({ env })).toBeUndefined();
      await closeBranchStateDatabaseAsync();
    } finally {
      await lease?.release();
      coordinator.release();
    }
  });

  it.each([
    { label: "dead", pid: 2_147_483_647, startedAt: 1 },
    { label: "recycled", pid: process.pid, startedAt: 1 },
  ])(
    "reclaims an unexpired $label owner without waiting for its lease deadline",
    async (previous) => {
      const { env, coordinator } = fixture();
      let lease: GatewayOwnerLease | undefined;
      try {
        seedOwner(env, previous);
        expect(readGatewayOwnerLease({ env })).toMatchObject({ state: "dead", expired: false });
        lease = acquireGatewayOwnerLease({
          env,
          port: 19483,
          mode: "supervised",
          supervisor: { kind: "schtasks", name: "Branch Agent Gateway" },
        });
        await lease.ready;
        expect(readGatewayOwnerLease({ env })).toMatchObject({
          owner: lease.owner,
          pid: process.pid,
          mode: "supervised",
          state: "live",
        });
      } finally {
        await lease?.release();
        coordinator.release();
      }
    },
  );

  it("preserves a slow live owner after the lease deadline instead of declaring it stale", () => {
    const { env, coordinator } = fixture();
    try {
      seedOwner(env, { expiresAt: Date.now() - 1 });
      expect(readGatewayOwnerLease({ env })).toMatchObject({
        owner: "previous-generation",
        state: "live",
        expired: true,
      });
      expect(readGatewayOwnerLease({ env })?.owner).toBe("previous-generation");
    } finally {
      coordinator.release();
    }
  });

  it.each([
    { label: "foreign host", host: "other-gateway-host" },
    { label: "missing start identity", startedAt: null },
  ])("preserves an unverifiable $label owner", (previous) => {
    const { env, coordinator } = fixture();
    try {
      seedOwner(env, previous);
      expect(readGatewayOwnerLease({ env })).toMatchObject({ state: "unknown", expired: false });
      expect(() =>
        acquireGatewayOwnerLease({ env, port: 19483, mode: "foreground", supervisor: null }),
      ).toThrow("Another Gateway owner lease is still active");
      expect(readGatewayOwnerLease({ env })?.owner).toBe("previous-generation");
    } finally {
      coordinator.release();
    }
  });

  it("keeps an unreadable process start identity unknown", () => {
    const { env, coordinator } = fixture();
    try {
      seedOwner(env);
      vi.spyOn(pidAlive, "getFileLockProcessStartTime").mockReturnValue(null);
      expect(readGatewayOwnerLease({ env })?.state).toBe("unknown");
    } finally {
      coordinator.release();
    }
  });

  it("does not delete a replacement generation during an older owner's release", async () => {
    const { env, coordinator } = fixture();
    let lease: GatewayOwnerLease | undefined;
    try {
      lease = acquireGatewayOwnerLease({ env, port: 19483, mode: "foreground", supervisor: null });
      await lease.ready;
      withBranchStateStartupMigrationCheckpointDatabase(
        (db) => {
          db.prepare(
            "UPDATE state_leases SET owner = 'replacement' WHERE scope = 'gateway-owner'",
          ).run();
        },
        { env },
      );
      await lease.release();
      expect(readGatewayOwnerLease({ env })?.owner).toBe("replacement");
    } finally {
      await lease?.release();
      coordinator.release();
    }
  });
});

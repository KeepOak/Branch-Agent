import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  prepareGatewayRunBootstrap,
  recheckGatewayRunBootstrap,
} from "../cli/gateway-cli/pre-bootstrap.js";
import * as healthState from "../config/io.health-state.js";
import { recordGatewayBootStart } from "../infra/gateway-boot-lifecycle.js";
import * as checkpoint from "../infra/startup-migration-checkpoint.js";
import { ExitError } from "../runtime.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { withEnvAsync } from "../test-utils/env.js";
import { runDoctorConfigPreflight } from "./doctor-config-preflight.js";
import { withDoctorConfigPreflightHome } from "./doctor-config-preflight.test-support.js";
import {
  runStartupConfigPreflight,
  type StartupConfigPreflightOptions,
} from "./startup-config-preflight.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  closeBranchStateDatabaseForTest();
});

it.each(["current", "backup", "webhook-repair"] as const)(
  "preserves authored config during startup from %s",
  async (source) => {
    await withDoctorConfigPreflightHome(async (home) => {
      const stateDir = path.join(home, ".branch");
      const configPath = path.join(stateDir, "branch.json");
      const original = JSON.stringify({
        gateway: { mode: "local" },
        ...(source === "webhook-repair"
          ? {
              channels: {
                "nextcloud-talk": {
                  enabled: true,
                  baseUrl: "https://cloud.example.com",
                  botSecret: "test-bot-secret",
                },
              },
            }
          : { plugins: { enabled: false } }),
      });
      await fs.mkdir(stateDir, { recursive: true });
      openBranchStateDatabase({ path: path.join(stateDir, "state", "branch.sqlite") });
      closeBranchStateDatabaseForTest();
      if (source === "webhook-repair") {
        recordGatewayBootStart(process.env, 1_800_000_000_000);
      }
      await fs.writeFile(configPath, original);
      if (source === "backup") {
        await fs.writeFile(`${configPath}.bak`, original);
        await fs.writeFile(configPath, '{"update":{"channel":"stable"}}');
      }
      const runtime = {
        log() {},
        error() {},
        exit(code: number): never {
          throw new ExitError(code);
        },
      };
      expect(await prepareGatewayRunBootstrap({ opts: {}, runtime })).toBe(true);
      const replacement = JSON.stringify({
        gateway: { mode: "local", port: 19002 },
        plugins: { enabled: false },
      });
      const options: StartupConfigPreflightOptions = {
        gateway: true,
        beforeStatePreparation: (snapshot) =>
          recheckGatewayRunBootstrap({ opts: {}, runtime, snapshot }),
      };
      if (source === "webhook-repair") {
        await expect(runStartupConfigPreflight(options)).rejects.toMatchObject({
          code: 78,
          message: expect.stringContaining("branch doctor --fix"),
        });
        expect(await fs.readFile(configPath, "utf8")).toBe(original);
        await expect(fs.stat(`${configPath}.bak`)).rejects.toMatchObject({ code: "ENOENT" });
      } else {
        const ready = await runStartupConfigPreflight(options);
        expect(ready.snapshot.valid).toBe(true);
        expect(await fs.readFile(configPath, "utf8")).toBe(original);
        if (source === "backup") {
          expect(await fs.readFile(`${configPath}.bak`, "utf8")).toBe(original);
        } else {
          await expect(fs.stat(`${configPath}.bak`)).rejects.toMatchObject({ code: "ENOENT" });
        }
        expect((await runStartupConfigPreflight(options)).snapshot.valid).toBe(true);
        expect(await fs.readFile(configPath, "utf8")).toBe(original);
        await fs.writeFile(configPath, replacement);
        await expect(runStartupConfigPreflight(options)).rejects.toMatchObject({ code: 1 });
        expect(await fs.readFile(configPath, "utf8")).toBe(replacement);
      }
      expect(checkpoint.hasActiveStartupMigrationLease()).toBe(false);
    });
  },
);

it.each([
  ["localhost", "loopback"],
  ["0.0.0.0", "lan"],
] as const)(
  "leaves legacy bind %s untouched until Doctor repairs it",
  async (legacy, canonical) => {
    await withDoctorConfigPreflightHome(async (home) => {
      const stateDir = path.join(home, ".branch");
      const configPath = path.join(stateDir, "branch.json");
      await fs.mkdir(stateDir, { recursive: true });
      const original = JSON.stringify({
        gateway: { mode: "local", bind: legacy },
        plugins: { enabled: false },
      });
      await fs.writeFile(configPath, original);

      const blocked = await runStartupConfigPreflight({ gateway: true, observe: false });

      expect(blocked.snapshot.valid).toBe(false);
      expect(blocked.snapshot.legacyIssues).toContainEqual(
        expect.objectContaining({ path: "gateway.bind" }),
      );
      expect(await fs.readFile(configPath, "utf8")).toBe(original);
      expect(
        (await fs.readdir(stateDir)).filter((name) => name.startsWith("branch.json.")),
      ).toEqual([]);

      await runDoctorConfigPreflight({
        observe: false,
        migrateState: false,
        migrateLegacyConfig: false,
        repairPrefixedConfig: true,
        invalidConfigNote: false,
      });
      const ready = await runStartupConfigPreflight({ gateway: true });

      expect(ready.snapshot.valid).toBe(true);
      expect(ready.snapshot.config.gateway?.bind).toBe(canonical);
      expect(JSON.parse(await fs.readFile(configPath, "utf8")).gateway.bind).toBe(canonical);
    });
  },
);

it("skips recovery health reads without a backup and admits a later backup", async () => {
  await withDoctorConfigPreflightHome(async (home) => {
    const stateDir = path.join(home, ".branch");
    const configPath = path.join(stateDir, "branch.json");
    const raw = JSON.stringify({
      gateway: { mode: "local" },
      plugins: { enabled: false },
      meta: { migrations: { webhookListeners: true } },
    });
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(configPath, raw);
    openBranchStateDatabase({ path: path.join(stateDir, "state", "branch.sqlite") });
    closeBranchStateDatabaseForTest();
    const healthRead = vi.fn();
    const capture = healthState.captureConfigHealthStateStore;
    vi.spyOn(healthState, "captureConfigHealthStateStore").mockImplementation((...args) => {
      const store = capture(...args);
      return {
        ...store,
        read() {
          healthRead();
          return store.read();
        },
      };
    });
    const readiness = await import("../state/branch-database-preflight.js");
    const assertReady = vi.spyOn(readiness, "assertBranchDatabasesReady");
    const options = {
      gateway: true,
      observe: false,
    };

    const first = await runStartupConfigPreflight(options);

    expect(first.snapshot.valid).toBe(true);
    expect(assertReady).toHaveBeenCalled();
    expect(healthRead).not.toHaveBeenCalled();
    expect(await fs.readFile(configPath, "utf8")).toBe(raw);
    await expect(fs.stat(`${configPath}.bak`)).rejects.toMatchObject({ code: "ENOENT" });

    await fs.writeFile(`${configPath}.bak`, raw);
    await fs.writeFile(configPath, '{"update":{"channel":"stable"}}');
    const recovered = await runStartupConfigPreflight(options);

    expect(healthRead).toHaveBeenCalled();
    expect(recovered.snapshot.valid).toBe(true);
    expect(await fs.readFile(configPath, "utf8")).toBe(raw);
    expect(checkpoint.hasActiveStartupMigrationLease()).toBe(false);
  });
});

it("restores the admitted backup after database readiness exceeds the lease TTL", async () => {
  await withDoctorConfigPreflightHome(async (home) => {
    const stateDir = path.join(home, ".branch");
    const configPath = path.join(stateDir, "branch.json");
    await fs.mkdir(stateDir, { recursive: true });
    const backup = {
      gateway: { mode: "local" },
      plugins: { enabled: false },
      meta: { migrations: { webhookListeners: true } },
    };
    await fs.writeFile(configPath, '{"update":{"channel":"stable"}}\n');
    await fs.writeFile(`${configPath}.bak`, JSON.stringify(backup));
    openBranchStateDatabase({ path: path.join(stateDir, "state", "branch.sqlite") });
    closeBranchStateDatabaseForTest();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    let acquired = false;
    let heartbeats = 0;
    const acquire = checkpoint.acquireStartupMigrationLeaseWithWait;
    vi.spyOn(checkpoint, "acquireStartupMigrationLeaseWithWait").mockImplementationOnce(
      async (params) => {
        const lease = await acquire(params);
        const heartbeat = lease.heartbeat;
        vi.spyOn(lease, "heartbeat").mockImplementation((heartbeatParams) => {
          heartbeats++;
          heartbeat(heartbeatParams);
        });
        acquired = true;
        return lease;
      },
    );
    const readiness = await import("../state/branch-database-preflight.js");
    const assertReady = readiness.assertBranchDatabasesReady;
    let delayed = false;
    vi.spyOn(readiness, "assertBranchDatabasesReady").mockImplementation(async (params) => {
      await assertReady(params);
      if (acquired && !delayed) {
        delayed = true;
        // Keep the real admission promise pending while interval renewals become due.
        await vi.advanceTimersByTimeAsync(checkpoint.STARTUP_MIGRATION_LEASE_TTL_MS + 60_000);
        expect(checkpoint.hasActiveStartupMigrationLease()).toBe(true);
        // Subsequent plugin lease acquisition uses a worker with the real wall clock.
        vi.setSystemTime(vi.getRealSystemTime());
      }
    });

    const result = await runStartupConfigPreflight({ gateway: true });

    expect(delayed).toBe(true);
    expect(result.snapshot.valid).toBe(true);
    expect(JSON.parse(await fs.readFile(configPath, "utf8"))).toEqual(backup);
    expect(checkpoint.hasActiveStartupMigrationLease()).toBe(false);
    const completedHeartbeats = heartbeats;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeats).toBe(completedHeartbeats);
  });
});

it.each(["backup", "active config"] as const)(
  "refuses changed %s under the lease before any repair",
  async (kind) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await withDoctorConfigPreflightHome(async (home) => {
      const stateDir = path.join(home, ".branch");
      const configPath = path.join(stateDir, "branch.json");
      await fs.mkdir(stateDir, { recursive: true });
      const backup = {
        gateway: { mode: "local" },
        plugins: { enabled: false },
        meta: { migrations: { webhookListeners: true } },
      };
      const original =
        kind === "backup" ? '{"update":{"channel":"stable"}}\n' : JSON.stringify(backup);
      const replacement = JSON.stringify(
        kind === "backup"
          ? {
              ...backup,
              meta: { lastTouchedVersion: "9999.1.1" },
              env: { vars: { BRANCH_SERVICE_MARKER: "branch" } },
            }
          : {
              ...backup,
              agents: { defaults: { workspace: path.join(home, "changed-workspace") } },
            },
      );
      openBranchStateDatabase({ path: path.join(stateDir, "state", "branch.sqlite") });
      closeBranchStateDatabaseForTest();
      await fs.writeFile(configPath, original);
      if (kind === "backup") {
        await fs.writeFile(`${configPath}.bak`, JSON.stringify(backup));
      }
      const runtime = {
        log() {},
        error() {},
        exit(code: number): never {
          throw new ExitError(code);
        },
      };
      await withEnvAsync(
        { BRANCH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS: undefined },
        async () => {
          expect(await prepareGatewayRunBootstrap({ opts: {}, runtime })).toBe(true);
          const acquire = checkpoint.acquireStartupMigrationLeaseWithWait;
          vi.spyOn(checkpoint, "acquireStartupMigrationLeaseWithWait").mockImplementationOnce(
            async (params) => {
              const lease = await acquire(params);
              await fs.writeFile(kind === "backup" ? `${configPath}.bak` : configPath, replacement);
              return lease;
            },
          );
          const refusal = await runStartupConfigPreflight({
            gateway: true,
            beforeStatePreparation: (snapshot) =>
              recheckGatewayRunBootstrap({ opts: {}, runtime, snapshot }),
          }).catch((error: unknown) => error);
          expect(vi.getTimerCount()).toBe(0);
          expect(checkpoint.hasActiveStartupMigrationLease()).toBe(false);
          expect(refusal).toMatchObject({ code: kind === "backup" ? 78 : 1 });
          expect(await fs.readFile(configPath, "utf8")).toBe(
            kind === "backup" ? original : replacement,
          );
          expect(
            (await fs.readdir(stateDir)).filter((name) => name.includes(".clobbered.")),
          ).toEqual([]);
        },
      );
    });
  },
);

it.each(["expired", "reassigned"] as const)(
  "does not restore a backup after the migration lease is %s during admission",
  async (loss) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await withDoctorConfigPreflightHome(async (home) => {
      const stateDir = path.join(home, ".branch");
      const configPath = path.join(stateDir, "branch.json");
      await fs.mkdir(stateDir, { recursive: true });
      const original = '{"update":{"channel":"stable"}}\n';
      await fs.writeFile(configPath, original);
      await fs.writeFile(
        `${configPath}.bak`,
        JSON.stringify({
          gateway: { mode: "local" },
          plugins: { enabled: false },
          meta: { migrations: { webhookListeners: true } },
        }),
      );
      openBranchStateDatabase({ path: path.join(stateDir, "state", "branch.sqlite") });
      closeBranchStateDatabaseForTest();
      let replacement: checkpoint.StartupMigrationLease | undefined;
      const acquire = checkpoint.acquireStartupMigrationLeaseWithWait;
      vi.spyOn(checkpoint, "acquireStartupMigrationLeaseWithWait").mockImplementationOnce(
        async (params) => {
          const stale = await acquire({
            ...params,
            now: () => Date.now() - checkpoint.STARTUP_MIGRATION_LEASE_TTL_MS - 1,
            timeoutMs: 0,
          });
          if (loss === "reassigned") {
            replacement = await acquire({ ...params, timeoutMs: 0 });
          }
          return stale;
        },
      );
      try {
        const refusal = await runStartupConfigPreflight({ gateway: true }).catch(
          (error: unknown) => error,
        );
        expect(await fs.readFile(configPath, "utf8")).toBe(original);
        expect((await fs.readdir(stateDir)).filter((name) => name.includes(".clobbered."))).toEqual(
          [],
        );
        expect(refusal).toBeInstanceOf(Error);
        expect(String(refusal)).toContain("startup migration lease was lost");
        expect(vi.getTimerCount()).toBe(0);
        replacement?.heartbeat();
      } finally {
        replacement?.release();
      }
    });
  },
);

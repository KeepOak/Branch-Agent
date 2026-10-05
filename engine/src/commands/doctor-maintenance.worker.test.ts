import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  writeNativeHookRelayBridgeRecord,
  type NativeHookRelayBridgeRecord,
} from "../agents/harness/native-hook-relay-store.js";
import * as gatewayLock from "../infra/gateway-lock.js";
import {
  autoMigrateLegacyStateDir,
  resetAutoMigrateLegacyStateDirForTest,
} from "../infra/state-migrations.state-dir.js";
import * as updateState from "../infra/update-candidate-state.js";
import { readUpdateDatabaseGenerations } from "../infra/update-database-generations.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db-cache.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "../state/branch-state-db-contract.js";
import { openBranchStateDatabase } from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { executeBranchStateWorker } from "../state/branch-state-worker-store.js";
import { withEnvAsync } from "../test-utils/env.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { beginDoctorMaintenance } from "./doctor-maintenance.js";

function relayRecord(revision: number): NativeHookRelayBridgeRecord {
  return {
    relayId: "doctor",
    pid: revision,
    hostname: "127.0.0.1",
    port: 18789,
    token: "synthetic-doctor-worker-token",
    expiresAtMs: 20000,
  };
}

function claimHistoricalProjection(stateDir: string) {
  const { stateLockPath } = gatewayLock.resolveGatewayLockPaths({
    ...process.env,
    BRANCH_STATE_DIR: stateDir,
  });
  // Shipped Gateways know this exclusive sidecar, not the newer root lock.
  const descriptor = fs.openSync(stateLockPath, "wx", 0o600);
  fs.closeSync(descriptor);
  fs.unlinkSync(stateLockPath);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await closeBranchStateDatabaseAsync();
  resetAutoMigrateLegacyStateDirForTest();
});

describe("Doctor maintenance with shared-state workers", () => {
  it("refuses a canonical root created after legacy maintenance admission", async () => {
    await withBranchTestState(
      { layout: "home", scenario: "external-service", label: "doctor-legacy-target-race" },
      async (state) => {
        const legacy = path.join(state.home, ".clawdbot");
        fs.renameSync(state.stateDir, legacy);
        const original = fs.statSync(legacy, { bigint: true });
        await withEnvAsync(
          {
            BRANCH_HOME: undefined,
            BRANCH_STATE_DIR: undefined,
            BRANCH_CONFIG_PATH: undefined,
          },
          async () => {
            await expect(
              beginDoctorMaintenance({
                options: { repair: true, nonInteractive: true },
                root: null,
                runtime: { log() {}, error() {}, exit() {} },
                beforeStateMutation: async () => {
                  fs.mkdirSync(state.stateDir);
                  fs.writeFileSync(path.join(state.stateDir, "independent-state"), "keep");
                },
              }),
            ).rejects.toThrow("State directory selection changed");
            expect(fs.statSync(legacy, { bigint: true }).ino).toBe(original.ino);
            expect(fs.readdirSync(state.stateDir)).toEqual(["independent-state"]);
            expect(fs.readFileSync(path.join(state.stateDir, "independent-state"), "utf8")).toBe(
              "keep",
            );
          },
        );
      },
    );
  });
  it("refuses a legacy symlink before creating the canonical state root", async () => {
    await withBranchTestState(
      { layout: "home", scenario: "external-service", label: "doctor-legacy-symlink" },
      async (state) => {
        const retained = path.join(state.home, "retained-state");
        const legacy = path.join(state.home, ".clawdbot");
        fs.renameSync(state.stateDir, retained);
        fs.symlinkSync(retained, legacy, process.platform === "win32" ? "junction" : "dir");
        await withEnvAsync(
          {
            BRANCH_HOME: undefined,
            BRANCH_STATE_DIR: undefined,
            BRANCH_CONFIG_PATH: undefined,
          },
          async () => {
            await expect(
              beginDoctorMaintenance({
                options: { repair: true, nonInteractive: true },
                root: null,
                runtime: { log() {}, error() {}, exit() {} },
              }),
            ).rejects.toThrow("Legacy state path is not a directory");
            expect(fs.existsSync(state.stateDir)).toBe(false);
            expect(fs.realpathSync(legacy)).toBe(fs.realpathSync(retained));
          },
        );
      },
    );
  });
  it.each([
    "schema-upgrade",
    "resident-worker",
    "historical-contender",
    "receipt-unchanged",
    "receipt-changed",
  ] as const)(
    "drains and reacquires maintenance around implicit legacy-root relocation: %s",
    async (scenario) => {
      await withBranchTestState(
        { layout: "home", scenario: "external-service", label: "doctor-legacy-root" },
        async (state) => {
          const { db } = openBranchStateDatabase();
          const version = BRANCH_STATE_SCHEMA_VERSION - (scenario === "resident-worker" ? 0 : 1);
          db.exec(`
          PRAGMA user_version = ${version};
          UPDATE schema_meta SET schema_version = ${version}
            WHERE meta_key = 'primary';
          DELETE FROM config_machine_state WHERE state_key = 'state.schema.contentVersion';
          INSERT INTO config_machine_state (state_key, value_json, updated_at_ms)
            VALUES ('doctor-relocation-sentinel', '{"keep":true}', 1);
        `);
          await closeBranchStateDatabaseAsync();
          const legacy = path.join(state.home, ".clawdbot");
          fs.renameSync(state.stateDir, legacy);
          if (scenario === "resident-worker") {
            await withEnvAsync(
              {
                BRANCH_STATE_DIR: legacy,
                BRANCH_CONFIG_PATH: path.join(legacy, "branch.json"),
              },
              async () => {
                await writeNativeHookRelayBridgeRecord({ record: relayRecord(1), updatedAtMs: 1 });
              },
            );
          }
          await withEnvAsync(
            {
              BRANCH_STATE_DIR: undefined,
              BRANCH_HOME: undefined,
              BRANCH_CONFIG_PATH: undefined,
              BRANCH_TEST_FAST: "0",
              BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
            },
            async () => {
              const databasePath = path.join(legacy, "state", "branch.sqlite");
              const databaseGenerations = scenario.startsWith("receipt-")
                ? readUpdateDatabaseGenerations([databasePath])
                : undefined;
              if (databaseGenerations) {
                vi.spyOn(updateState, "readUpdateDatabaseGenerationsIsolated").mockImplementation(
                  async (paths) => readUpdateDatabaseGenerations(paths),
                );
                if (scenario === "receipt-changed") {
                  const beforeAdmission = new DatabaseSync(databasePath);
                  beforeAdmission.exec(
                    "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES ('outside', '{}', 2)",
                  );
                  beforeAdmission.close();
                }
              }
              const admittedGenerations = databaseGenerations
                ? readUpdateDatabaseGenerations([databasePath])
                : undefined;
              const log = vi.fn();
              const maintenance = await beginDoctorMaintenance({
                options: { repair: true, nonInteractive: true },
                root: null,
                runtime: { log, error() {}, exit() {} },
                databaseGenerations,
              });
              try {
                await maintenance!.run(async () => {
                  await autoMigrateLegacyStateDir({ env: process.env });
                  const migrated = openBranchStateDatabase();
                  expect(migrated.db.prepare("PRAGMA user_version").get()).toEqual({
                    user_version: BRANCH_STATE_SCHEMA_VERSION,
                  });
                  expect(
                    migrated.db
                      .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
                      .get("doctor-relocation-sentinel"),
                  ).toEqual({ value_json: '{"keep":true}' });
                  expect(log).toHaveBeenCalledWith(`State dir: ${legacy} → ${state.stateDir}`);
                  expect(fs.existsSync(legacy)).toBe(false);
                  if (scenario === "resident-worker") {
                    expect(
                      await executeBranchStateWorker(captureBranchStateWorkerContext(), {
                        type: "nativeHookRelay.read",
                        input: { relayId: "doctor" },
                      }),
                    ).toEqual(relayRecord(1));
                  }
                  if (scenario === "historical-contender") {
                    expect(() => claimHistoricalProjection(state.stateDir)).toThrow(/EEXIST/);
                    await writeNativeHookRelayBridgeRecord({
                      record: relayRecord(2),
                      updatedAtMs: 2,
                    });
                    expect(
                      await executeBranchStateWorker(captureBranchStateWorkerContext(), {
                        type: "nativeHookRelay.read",
                        input: { relayId: "doctor" },
                      }),
                    ).toEqual(relayRecord(2));
                    expect(() => claimHistoricalProjection(state.stateDir)).toThrow(/EEXIST/);
                  }
                });
              } finally {
                await maintenance?.release();
              }
              if (scenario === "historical-contender") {
                expect(() => claimHistoricalProjection(state.stateDir)).not.toThrow();
                expect(
                  await executeBranchStateWorker(captureBranchStateWorkerContext(), {
                    type: "nativeHookRelay.read",
                    input: { relayId: "doctor" },
                  }),
                ).toEqual(relayRecord(2));
              }
              if (databaseGenerations) {
                // The published updater retains old path keys; relocation must not certify
                // their missing generations as eligible for automatic restoration.
                expect(maintenance!.databaseWrites).toEqual({
                  unchanged: false,
                  fromGenerations: admittedGenerations,
                  generations: readUpdateDatabaseGenerations([databasePath]),
                });
                expect(maintenance!.databaseWrites?.generations[databasePath]).not.toBe(
                  databaseGenerations[databasePath],
                );
              }
            },
          );
        },
      );
    },
  );
  it.each([
    { alreadyOpen: false, reload: false },
    { alreadyOpen: true, reload: false },
    { alreadyOpen: true, reload: true },
  ])(
    "completes writes and drainage with an already-open worker=$alreadyOpen after module reload=$reload",
    async ({ alreadyOpen, reload }) => {
      await withBranchTestState(
        { scenario: "external-service", label: "doctor-managed-worker" },
        async () => {
          openBranchStateDatabase();
          let execute = executeBranchStateWorker;
          let capture = captureBranchStateWorkerContext;
          let write = writeNativeHookRelayBridgeRecord;
          if (alreadyOpen) {
            await execute(capture(), {
              type: "nativeHookRelay.read",
              input: { relayId: "doctor" },
            });
          }
          let enterMaintenance = beginDoctorMaintenance;
          if (reload) {
            await closeBranchStateDatabaseAsync();
            vi.resetModules();
            const [doctor, worker, contexts, relay] = await Promise.all([
              import("./doctor-maintenance.js"),
              import("../state/branch-state-worker-store.js"),
              import("../state/branch-state-worker-context.js"),
              import("../agents/harness/native-hook-relay-store.js"),
            ]);
            enterMaintenance = doctor.beginDoctorMaintenance;
            execute = worker.executeBranchStateWorker;
            capture = contexts.captureBranchStateWorkerContext;
            write = relay.writeNativeHookRelayBridgeRecord;
          }
          const maintenance = await enterMaintenance({
            options: { repair: true, nonInteractive: true },
            root: null,
            runtime: { log() {}, error() {}, exit() {} },
          });
          const record = relayRecord(1);
          try {
            await maintenance!.run(async () => {
              await write({ record, updatedAtMs: 1 });
              expect(
                await execute(capture(), {
                  type: "nativeHookRelay.read",
                  input: { relayId: record.relayId },
                }),
              ).toEqual(record);
            });
          } finally {
            await maintenance?.release();
          }
          await closeBranchStateDatabaseAsync();
          expect(
            await execute(capture(), {
              type: "nativeHookRelay.read",
              input: { relayId: record.relayId },
            }),
          ).toEqual(record);
          const successor = relayRecord(2);
          await write({ record: successor, updatedAtMs: 2 });
          expect(
            await execute(capture(), {
              type: "nativeHookRelay.read",
              input: { relayId: record.relayId },
            }),
          ).toEqual(successor);
        },
      );
    },
  );
});

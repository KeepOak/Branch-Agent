import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { NativeHookRelayBridgeRecord } from "../agents/harness/native-hook-relay-bridge-record.js";
import { normalizeSubagentRunState } from "../agents/subagents/registry/subagent-delivery-state.js";
import { registerRequiredQueuedSubagent } from "../agents/subagents/registry/subagent-registry-queued-registration.js";
import { persistSubagentRunsToDiskAsyncOrThrow } from "../agents/subagents/registry/subagent-registry-state.js";
import { bindSubagentRunRecord } from "../agents/subagents/registry/subagent-registry.store.codec.js";
import {
  loadSubagentRegistryFromSqlite,
  saveSubagentRegistryToSqlite,
} from "../agents/subagents/registry/subagent-registry.store.sqlite.js";
import type { SubagentRunRecord } from "../agents/subagents/registry/subagent-registry.types.js";
import { writeConfigMachineState } from "../state/config-machine-state-write.js";
import { createBranchDatabaseMaintenanceScope } from "../state/branch-state-db-async-lifecycle.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db-cache.js";
import { openBranchStateDatabase } from "../state/branch-state-db.js";
import { claimBranchStateOwnership } from "../state/branch-state-ownership-operations.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import {
  executeBranchStateWorker,
  inspectBranchStateDatabase,
  runBranchStateWorkerOperation,
} from "../state/branch-state-worker-store.js";
import { withEnvAsync } from "../test-utils/env.js";
import { observeMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";
import { acquireGatewayStateOwner } from "./gateway-state-owner.js";
import * as nodeSqlite from "./node-sqlite.js";
import { runtimeProcessEntrypoints } from "./runtime-process-entrypoints.js";
import { resolveRuntimeWorkerUrl } from "./runtime-worker-url.js";
import { BranchStateOwnershipError } from "./sqlite-lifecycle-errors.js";
import { SqliteSchemaVersionError } from "./sqlite-user-version.js";
import { SQLITE_WORKER_MAX_MESSAGE_BYTES } from "./sqlite-worker-contract.js";
import { registerSharedStateWorkerAdmissionTests } from "./sqlite-worker-shared-state-admission.test-support.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeBranchStateDatabaseAsync();
    cleanup();
  }),
);

function context() {
  return captureBranchStateWorkerContext({
    env: { BRANCH_STATE_DIR: dirs.make("branch-worker-cold-") },
  });
}

describe("canonical shared-state worker admission", () => {
  it.each(["key", "value", "agent-path"])(
    "bounds captured initialization %s bytes before opening",
    async (part) => {
      const padding = "x".repeat(SQLITE_WORKER_MAX_MESSAGE_BYTES);
      const env = {
        BRANCH_STATE_DIR: dirs.make("worker-environment-budget-"),
        [part === "key" ? padding : "PADDING"]: part === "value" ? padding : "x",
      };
      const captured = captureBranchStateWorkerContext({
        env,
        ...(part === "agent-path" ? { initializationAgentPaths: [padding] } : {}),
      });
      await expect(
        executeBranchStateWorker(captured, {
          type: "plugins.conversationBindingApprovals.read",
          input: undefined,
        }),
      ).rejects.toMatchObject({ code: "overloaded" });
      expect(existsSync(captured.admission.databasePath)).toBe(false);
    },
  );

  it.each(
    [false, true].flatMap((retained) =>
      (["config", "paths"] as const).map((source) => ({ retained, source })),
    ),
  )(
    "retains selected storage facts before worker initialization (retained: $retained, source: $source)",
    async ({ retained, source }) => {
      const root = dirs.make("worker-selected-storage-");
      const env = {
        HOME: path.join(root, "home"),
        BRANCH_STATE_DIR: path.join(root, "state"),
        BRANCH_CONFIG_PATH: path.join(root, "selected.json"),
        STORE_ROOT: path.join(root, "retained"),
      };
      mkdirSync(env.HOME);
      mkdirSync(env.STORE_ROOT);
      const agentPath = path.join(env.STORE_ROOT, "branch-agent.sqlite");
      if (retained) {
        const database = nodeSqlite.openNodeSqliteDatabase(agentPath);
        database.exec(
          "CREATE TABLE retained_history (value TEXT); INSERT INTO retained_history VALUES ('kept')",
        );
        database.close();
      }
      const bytes = retained ? readFileSync(agentPath) : undefined;
      writeFileSync(
        env.BRANCH_CONFIG_PATH,
        source === "config"
          ? JSON.stringify({ agents: { entries: { main: { agentDir: "${STORE_ROOT}" } } } })
          : "{}",
      );
      const knownPaths = [agentPath];
      const captured = captureBranchStateWorkerContext({
        env,
        ...(source === "paths" ? { initializationAgentPaths: knownPaths } : {}),
      });
      env.BRANCH_CONFIG_PATH = path.join(root, "later.json");
      env.STORE_ROOT = path.join(root, "later");
      knownPaths[0] = path.join(root, "later", "branch-agent.sqlite");

      await executeBranchStateWorker(captured, {
        type: "plugins.conversationBindingApprovals.read",
        input: undefined,
      });
      expect(existsSync(captured.admission.databasePath)).toBe(true);
      const database = openBranchStateDatabase({
        path: captured.admission.databasePath,
        env: captured.environment,
      });
      const journal = database.db
        .prepare("SELECT name FROM sqlite_schema WHERE name = 'agent_deletion_journal'")
        .get();
      if (retained) {
        expect(journal).toBeUndefined();
        expect(readFileSync(agentPath)).toEqual(bytes);
      } else {
        expect(journal).toEqual({ name: "agent_deletion_journal" });
      }
    },
  );

  it.each(["open", "execute"] as const)(
    "keeps typed %s errors for a reloaded caller of the existing shared worker",
    async (phase) => {
      const captured = context();
      await executeBranchStateWorker(captured, {
        type: "plugins.conversationBindingApprovals.read",
        input: undefined,
      });
      const database = openBranchStateDatabase({
        path: captured.admission.databasePath,
        env: captured.environment,
      });
      database.db.exec("PRAGMA user_version = 999999");
      if (phase === "open") {
        await closeBranchStateDatabaseAsync();
      }
      vi.resetModules();
      const [worker, contexts, errors] = await Promise.all([
        import("../state/branch-state-worker-store.js"),
        import("../state/branch-state-worker-context.js"),
        import("./sqlite-user-version.js"),
      ]);
      const current = contexts.captureBranchStateWorkerContext({
        path: captured.admission.databasePath,
        env: captured.environment,
      });
      const record: NativeHookRelayBridgeRecord = {
        relayId: "caller-errors",
        pid: 100,
        hostname: "127.0.0.1",
        port: 18789,
        token: "synthetic-caller-token",
        expiresAtMs: 20000,
      };
      let incoming: unknown;
      let failure: unknown;
      try {
        await worker.runBranchStateWorkerOperation(current, async (scope) => {
          try {
            return await scope.execute({
              type: "nativeHookRelay.write",
              input: { record, updatedAtMs: 1 },
            });
          } catch (error) {
            incoming = error;
            throw error;
          }
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(errors.SqliteSchemaVersionError);
      if (phase === "execute") {
        expect(incoming).toBe(failure);
      }
    },
  );

  it("hydrates concurrent lower-level open refusals in each caller's module graph", async () => {
    const captured = context();
    const database = openBranchStateDatabase({
      path: captured.admission.databasePath,
      env: captured.environment,
    });
    database.db.exec("PRAGMA user_version = 999999");
    await closeBranchStateDatabaseAsync();
    const first = await Promise.all([
      import("./sqlite-worker-store.js"),
      import("./sqlite-user-version.js"),
    ]);
    vi.resetModules();
    const second = await Promise.all([
      import("./sqlite-worker-store.js"),
      import("./sqlite-user-version.js"),
    ]);
    const options = {
      moduleUrl: resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.sharedStateStore),
      databasePath: captured.admission.databasePath,
    };
    const outcomes = await Promise.allSettled([
      first[0].openSharedStateSqliteWorkerStore(options, captured),
      second[0].openSharedStateSqliteWorkerStore(options, captured),
    ]);
    for (const result of outcomes) {
      if (result.status === "fulfilled") {
        await result.value?.close();
      }
    }
    const [left, right] = outcomes;
    if (left.status !== "rejected" || right.status !== "rejected") {
      throw new Error("Expected both callers to observe the schema refusal");
    }
    expect(left.reason).toBeInstanceOf(first[1].SqliteSchemaVersionError);
    expect(right.reason).toBeInstanceOf(second[1].SqliteSchemaVersionError);
    expect(left.reason).not.toBe(right.reason);
  });

  it.each(["create", "repair"] as const)(
    "performs cold %s under its Gateway owner without main-thread SQL",
    async (operation) => {
      const captured = context();
      const databasePath = captured.admission.databasePath;
      if (operation === "repair") {
        const database = openBranchStateDatabase({
          path: databasePath,
          env: captured.environment,
        });
        database.db.exec("DROP INDEX idx_subagent_runs_child_session_key");
        await closeBranchStateDatabaseAsync();
      }
      const admission = captureBranchStateWorkerContext({
        path: databasePath,
        env: captured.environment,
      });
      const gateway = acquireGatewayStateOwner({
        databasePath,
        payload: {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          role: "gateway",
          stateDir: captured.environment.BRANCH_STATE_DIR,
          configPath: path.join(captured.environment.BRANCH_STATE_DIR, "branch.json"),
        },
      });
      const mainSql = observeMainThreadSql();
      try {
        expect(
          await executeBranchStateWorker(admission, {
            type: "plugins.conversationBindingApprovals.read",
            input: undefined,
          }),
        ).toEqual([]);
        mainSql.expectIdle();
        expect(admission.admission.identity.key).toMatch(/^file:/);
      } finally {
        mainSql.restore();
        await closeBranchStateDatabaseAsync();
        gateway.release();
      }
      const reopened = openBranchStateDatabase({ path: databasePath, env: captured.environment });
      expect(
        reopened.db
          .prepare("SELECT name FROM sqlite_schema WHERE name = ?")
          .get("idx_subagent_runs_child_session_key"),
      ).toEqual({ name: "idx_subagent_runs_child_session_key" });
    },
  );

  it.each(["Web Push", "GitHub publication"] as const)(
    "keeps metadata inspection and the first %s operation in the same actor",
    async (operation) => {
      const captured = context();
      const value = { generation: "prepared-metadata", plugins: [] };
      writeConfigMachineState("plugins.installedIndex", value, {
        path: captured.admission.databasePath,
        env: captured.environment,
      });
      await closeBranchStateDatabaseAsync();
      const reopened = captureBranchStateWorkerContext({
        path: captured.admission.databasePath,
        env: captured.environment,
      });
      const messages = vi.spyOn(Worker.prototype, "postMessage");
      await runBranchStateWorkerOperation(
        reopened,
        async (scope) => {
          expect(
            await scope.execute({
              type: "plugins.metadata.read",
              input: { selector: "installed-index", artifactPreservingReadOnly: true },
            }),
          ).toEqual({ value_json: JSON.stringify(value) });
          const metadataWorker = messages.mock.contexts[0];
          expect(metadataWorker).toBeInstanceOf(Worker);
          messages.mockClear();
          if (operation === "Web Push") {
            expect(
              await scope.execute({
                type: "webPush.listTerminalWebPushApprovalDeliveryIds",
                input: {},
              }),
            ).toEqual({ approvalIds: [], nextAfterApprovalId: null, throughApprovalId: null });
          } else {
            expect(
              await scope.execute({
                type: "githubRepository.personalPending",
                input: {
                  ownerProfileId: "profile-first-use",
                  sessionKey: "agent:main:github-first-use",
                  agentId: "main",
                },
              }),
            ).toBeUndefined();
          }
          expect(messages.mock.contexts.length).toBeGreaterThan(0);
          expect(messages.mock.contexts.every((worker) => worker === metadataWorker)).toBe(true);
          expect(
            await scope.execute({
              type: "plugins.metadata.read",
              input: { selector: "installed-index", artifactPreservingReadOnly: true },
            }),
          ).toEqual({ value_json: JSON.stringify(value) });
        },
        { existingOnly: true },
      );
      await closeBranchStateDatabaseAsync();
      messages.mockRestore();
    },
  );

  it("leaves a missing database absent for existing-only inspection", async () => {
    const captured = context();
    const inspect = vi.fn(async () => "inspected");
    expect(
      await runBranchStateWorkerOperation(captured, inspect, { existingOnly: true }),
    ).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
    expect(
      await inspectBranchStateDatabase(captured, {
        type: "database.generationMatches",
        input: {
          generation: {
            database: {
              birthtimeNs: 0n,
              ctimeNs: 0n,
              dev: 0n,
              ino: 0n,
              mtimeNs: 0n,
              size: 0n,
              sha256: "0".repeat(64),
            },
          },
        },
      }),
    ).toBeUndefined();
    expect(existsSync(captured.admission.databasePath)).toBe(false);
  });

  it.runIf(process.platform === "darwin" && existsSync("/usr/bin/SetFile"))(
    "permits a lazy write after same-inode birthtime metadata changes",
    async () => {
      const seeded = context();
      const databasePath = seeded.admission.databasePath;
      writeConfigMachineState(
        "plugins.installedIndex",
        { plugins: [] },
        {
          path: databasePath,
          env: seeded.environment,
        },
      );
      await closeBranchStateDatabaseAsync();
      const captured = captureBranchStateWorkerContext({
        path: databasePath,
        env: seeded.environment,
      });
      await runBranchStateWorkerOperation(
        captured,
        (scope) =>
          scope.execute({
            type: "plugins.metadata.read",
            input: { selector: "installed-index", artifactPreservingReadOnly: true },
          }),
        { existingOnly: true },
      );
      const before = statSync(databasePath, { bigint: true });
      // macOS can change birth time without reallocating the inode.
      execFileSync("/usr/bin/SetFile", ["-d", "01/02/2000 03:04:05", databasePath]);
      const after = statSync(databasePath, { bigint: true });
      expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
      expect(after.birthtimeNs).not.toBe(before.birthtimeNs);
      const input = {
        configPath: "/synthetic/changed-birthtime.json",
        patch: { last_observed_suspicious_signature: "metadata-change" },
        expected: null,
        updatedAtMs: 100,
      };
      await expect(
        executeBranchStateWorker(captured, { type: "config.health.patch", input }),
      ).resolves.toBe(true);
      await closeBranchStateDatabaseAsync();
      const database = openBranchStateDatabase({ path: databasePath, env: seeded.environment });
      const row = database.db
        .prepare(
          "SELECT last_observed_suspicious_signature FROM config_health_entries WHERE config_path = ?",
        )
        .get(input.configPath);
      expect(row).toEqual({ last_observed_suspicious_signature: "metadata-change" });
    },
  );

  it.each(["config health", "device identity", "audit"] as const)(
    "does not recreate a lazy actor's removed opening path through a warm hardlink (%s)",
    async (operation) => {
      const original = context();
      const originalPath = original.admission.databasePath;
      writeConfigMachineState(
        "plugins.installedIndex",
        { plugins: [] },
        {
          path: originalPath,
          env: original.environment,
        },
      );
      await closeBranchStateDatabaseAsync();
      const aliasPath = path.join(dirs.make("branch-worker-warm-alias-"), "state.sqlite");
      linkSync(originalPath, aliasPath);
      const opening = captureBranchStateWorkerContext({
        path: originalPath,
        env: original.environment,
      });
      const alias = captureBranchStateWorkerContext({
        path: aliasPath,
        env: original.environment,
      });
      const inspect = (captured: typeof opening) =>
        runBranchStateWorkerOperation(
          captured,
          (scope) =>
            scope.execute({
              type: "plugins.metadata.read",
              input: { selector: "installed-index", artifactPreservingReadOnly: true },
            }),
          { existingOnly: true },
        );
      await inspect(opening);
      await inspect(alias);
      renameSync(
        path.dirname(originalPath),
        path.join(dirs.make("branch-worker-moved-"), "state"),
      );
      const input = {
        configPath: "/synthetic/warm-alias.json",
        patch: { last_observed_suspicious_signature: "warm-alias" },
        expected: null,
        updatedAtMs: 100,
      };
      if (operation === "audit") {
        expect(
          await executeBranchStateWorker(alias, {
            type: "audit.writer.prune",
            input: "events",
          }),
        ).toMatchObject({ status: "settled", error: expect.any(String) });
      } else {
        await expect(
          executeBranchStateWorker(
            alias,
            operation === "config health"
              ? {
                  type: "config.health.patch",
                  input,
                }
              : {
                  type: "deviceIdentity.load",
                  input: { identityKey: "warm-alias-device" },
                },
          ),
        ).rejects.toThrow();
      }
      expect(existsSync(originalPath)).toBe(false);
      await closeBranchStateDatabaseAsync();
      const database = openBranchStateDatabase({ path: aliasPath, env: original.environment });
      expect(
        database.db
          .prepare("SELECT count(*) AS count FROM config_health_entries WHERE config_path = ?")
          .get(input.configPath),
      ).toEqual({
        count: 0,
      });
    },
  );

  it.each([
    "same scope",
    "different scope",
    "active callback",
    "surviving alias",
    "retired opening scope",
    "active retained alias",
    "active opening alias",
    "active secondary alias",
  ] as const)(
    "writes to the relocated database without recreating a retired inspection path (%s)",
    async (ownership) => {
      const seeded = context();
      const originalPath = seeded.admission.databasePath;
      const value = { generation: "retained-before-relocation", plugins: [] };
      writeConfigMachineState("plugins.installedIndex", value, {
        path: originalPath,
        env: seeded.environment,
      });
      await closeBranchStateDatabaseAsync();
      const healthyActor =
        ownership === "active opening alias" || ownership === "active secondary alias";
      const originalMaintenance = createBranchDatabaseMaintenanceScope();
      const relocatedMaintenance =
        ownership === "same scope" || ownership === "active secondary alias"
          ? originalMaintenance
          : createBranchDatabaseMaintenanceScope();
      const aliasMaintenance = healthyActor
        ? createBranchDatabaseMaintenanceScope()
        : relocatedMaintenance;
      try {
        const original = originalMaintenance.run(() =>
          captureBranchStateWorkerContext({
            path: originalPath,
            env: seeded.environment,
          }),
        );
        let survivingAlias: ReturnType<typeof captureBranchStateWorkerContext> | undefined;
        if (
          ownership === "surviving alias" ||
          ownership === "retired opening scope" ||
          ownership === "active retained alias" ||
          healthyActor
        ) {
          const aliasPath = path.join(dirs.make("branch-worker-live-alias-"), "state.sqlite");
          linkSync(originalPath, aliasPath);
          survivingAlias = aliasMaintenance.run(() =>
            captureBranchStateWorkerContext({ path: aliasPath, env: seeded.environment }),
          );
          if (healthyActor) {
            // C opens the actor before A receives its secondary client.
            expect(
              await runBranchStateWorkerOperation(
                survivingAlias,
                (scope) =>
                  scope.execute({
                    type: "plugins.metadata.read",
                    input: { selector: "installed-index", artifactPreservingReadOnly: true },
                  }),
                { existingOnly: true },
              ),
            ).toEqual({ value_json: JSON.stringify(value) });
          }
        }
        const relocate = () => {
          const relocatedRoot = dirs.make("branch-worker-relocated-");
          // Relocation keeps the real inode while ending the old path's admission.
          renameSync(path.dirname(originalPath), path.join(relocatedRoot, "state"));
          const relocated = relocatedMaintenance.run(() =>
            captureBranchStateWorkerContext({
              env: { BRANCH_STATE_DIR: relocatedRoot },
            }),
          );
          expect(relocated.admission.identity.key).toBe(original.admission.identity.key);
          expect(existsSync(originalPath)).toBe(false);
          return relocated;
        };
        const input = {
          configPath: "/synthetic/relocated-state.json",
          patch: { last_observed_suspicious_signature: "current-database" },
          expected: null,
          updatedAtMs: 100,
        };
        const write = async (relocated: ReturnType<typeof captureBranchStateWorkerContext>) => {
          expect(
            await executeBranchStateWorker(relocated, {
              type: "config.health.patch",
              input,
            }),
          ).toBe(true);
        };
        const relocatedDuringCallback = await runBranchStateWorkerOperation(
          original,
          async (scope) => {
            expect(
              await scope.execute({
                type: "plugins.metadata.read",
                input: { selector: "installed-index", artifactPreservingReadOnly: true },
              }),
            ).toEqual({ value_json: JSON.stringify(value) });
            if (ownership === "active callback") {
              const relocated = relocate();
              // The old callback cannot await its own retirement through a new caller.
              await expect(write(relocated)).rejects.toMatchObject({
                code: "STATE_DATABASE_READ_ADMISSION_INVALIDATED",
              });
              expect(existsSync(originalPath)).toBe(false);
              return relocated;
            }
            if (ownership === "active secondary alias") {
              const relocated = relocate();
              // B shares A's scope but must not wait for this callback to close its stale client.
              await write(relocated);
              return relocated;
            }
            return undefined;
          },
          { existingOnly: true },
        );
        let relocatedDuringAliasCallback:
          | ReturnType<typeof captureBranchStateWorkerContext>
          | undefined;
        if (
          (ownership === "retired opening scope" || ownership === "active retained alias") &&
          survivingAlias
        ) {
          await runBranchStateWorkerOperation(
            survivingAlias,
            (scope) =>
              scope.execute({
                type: "plugins.metadata.read",
                input: { selector: "installed-index", artifactPreservingReadOnly: true },
              }),
            { existingOnly: true },
          );
          await originalMaintenance.close();
          if (ownership === "active retained alias") {
            relocatedDuringAliasCallback = await runBranchStateWorkerOperation(
              survivingAlias,
              async (scope) => {
                const relocated = relocate();
                await expect(
                  scope.execute({ type: "config.health.patch", input }),
                ).rejects.toMatchObject({ code: "STATE_DATABASE_READ_ADMISSION_INVALIDATED" });
                expect(existsSync(originalPath)).toBe(false);
                return relocated;
              },
              { existingOnly: true },
            );
          }
        }
        if (ownership === "active opening alias" && survivingAlias) {
          relocatedDuringAliasCallback = await runBranchStateWorkerOperation(
            survivingAlias,
            async () => {
              const relocated = relocate();
              await write(relocated);
              return relocated;
            },
            { existingOnly: true },
          );
        }
        const relocated = relocatedDuringCallback ?? relocatedDuringAliasCallback ?? relocate();
        if (!healthyActor) {
          await write(relocated);
        }

        expect(existsSync(originalPath)).toBe(false);
        if (survivingAlias) {
          survivingAlias.admission.assertCurrent();
          expect(original.admission.assertCurrent).toThrow(/read admission changed/);
        }
        // Checkpoint the actor's opening path before inspecting its hardlink through B.
        await closeBranchStateDatabaseAsync();
        const database = openBranchStateDatabase({
          path: relocated.admission.databasePath,
          env: relocated.environment,
        });
        expect(
          database.db
            .prepare(
              "SELECT last_observed_suspicious_signature, updated_at_ms FROM config_health_entries WHERE config_path = ?",
            )
            .get(input.configPath),
        ).toEqual({ last_observed_suspicious_signature: "current-database", updated_at_ms: 100 });
        expect(
          database.db
            .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
            .get("plugins.installedIndex"),
        ).toEqual({ value_json: JSON.stringify(value) });
      } finally {
        await originalMaintenance.close();
        if (relocatedMaintenance !== originalMaintenance) {
          await relocatedMaintenance.close();
        }
        if (aliasMaintenance !== relocatedMaintenance) {
          await aliasMaintenance.close();
        }
      }
    },
  );

  it("preserves future-schema rejection through a cold worker open", async () => {
    const captured = context();
    const database = openBranchStateDatabase({
      path: captured.admission.databasePath,
      env: captured.environment,
    });
    database.db.exec("PRAGMA user_version = 999999;");
    await closeBranchStateDatabaseAsync();
    const reopened = captureBranchStateWorkerContext({
      path: captured.admission.databasePath,
      env: captured.environment,
    });
    await expect(
      executeBranchStateWorker(reopened, {
        type: "plugins.conversationBindingApprovals.read",
        input: undefined,
      }),
    ).rejects.toBeInstanceOf(SqliteSchemaVersionError);
  });

  it.each(["open", "execute"] as const)(
    "preserves external ownership rejection from worker %s",
    async (phase) => {
      const captured = context();
      if (phase === "execute") {
        await executeBranchStateWorker(captured, {
          type: "plugins.conversationBindingApprovals.read",
          input: undefined,
        });
      }
      claimBranchStateOwnership("synthetic-manager", {
        path: captured.admission.databasePath,
        env: { ...captured.environment, BRANCH_SUPERVISOR_MODE: "external" },
      });
      if (phase === "open") {
        await closeBranchStateDatabaseAsync();
      }
      const reopened = captureBranchStateWorkerContext({
        path: captured.admission.databasePath,
        env: captured.environment,
      });
      await expect(
        executeBranchStateWorker(reopened, {
          type: "plugins.conversationBindingApprovals.read",
          input: undefined,
        }),
      ).rejects.toBeInstanceOf(BranchStateOwnershipError);
    },
  );

  it("opens a fresh actor for the first new call after the previous worker exits", async () => {
    const captured = context();
    const messages = vi.spyOn(Worker.prototype, "postMessage");
    await executeBranchStateWorker(captured, {
      type: "plugins.conversationBindingApprovals.read",
      input: undefined,
    });
    const worker = messages.mock.contexts[0];
    messages.mockRestore();
    if (!(worker instanceof Worker)) {
      throw new Error("Expected the shared-state worker to receive its open request");
    }
    await worker.terminate();
    await expect(
      executeBranchStateWorker(captured, {
        type: "plugins.conversationBindingApprovals.read",
        input: undefined,
      }),
    ).resolves.toEqual([]);
    expect(
      await executeBranchStateWorker(captured, {
        type: "plugins.conversationBindingApprovals.read",
        input: undefined,
      }),
    ).toEqual([]);
  });

  it("reads persisted records after closing and reopening the worker", async () => {
    const captured = context();
    const value = { generation: "persisted-metadata", plugins: [] };
    writeConfigMachineState("plugins.installedIndex", value, {
      path: captured.admission.databasePath,
      env: captured.environment,
    });
    await closeBranchStateDatabaseAsync();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reopened = captureBranchStateWorkerContext({
        path: captured.admission.databasePath,
        env: captured.environment,
      });
      expect(
        await executeBranchStateWorker(reopened, {
          type: "plugins.metadata.read",
          input: { selector: "installed-index", artifactPreservingReadOnly: true },
        }),
      ).toEqual({ value_json: JSON.stringify(value) });
      await closeBranchStateDatabaseAsync();
    }
  });
});

registerSharedStateWorkerAdmissionTests(context);

function createRun(runId: string): SubagentRunRecord {
  return {
    runId,
    childSessionKey: `agent:main:subagent:${runId}`,
    requesterSessionKey: "agent:main:main",
    requesterDisplayKey: "main",
    task: "captured task",
    cleanup: "keep",
    createdAt: 100,
    execution: { status: "queued" },
    completion: { required: false },
    delivery: { status: "not_required" },
  };
}

it("commits captured registry rows without host SQL", async () => {
  await withEnvAsync({ BRANCH_STATE_DIR: dirs.make("branch-registry-worker-") }, async () => {
    const retained = createRun("retained");
    const removed = createRun("removed");
    saveSubagentRegistryToSqlite(
      new Map([
        [retained.runId, retained],
        [removed.runId, removed],
      ]),
    );
    const queued = createRun("queued");
    const capturedTask = 'captured task with "quotes", \\slashes, and 🌿\n'.repeat(256);
    queued.task = capturedTask;
    queued.queuedLaunch = {
      request: { sessionKey: queued.childSessionKey, task: queued.task },
      timeoutMs: 100,
      schedulerGroupKey: "synthetic-group",
      maxConcurrent: 1,
    };
    const terminal = createRun("private-terminal");
    terminal.completionTarget = "parent";
    terminal.execution = { status: "terminal", endedAt: 200 };
    const terminalReply = {
      disposition: "visible" as const,
      text: "[Mon 2026-09-21 12:00 UTC] [Mon 2026-09-21 12:00 UTC] captured reply",
    };
    terminal.completion = {
      required: false,
      resultText: "captured result 🌿\n".repeat(256),
      terminalReply,
    };
    const expected = [queued, terminal].map((entry) =>
      bindSubagentRunRecord(normalizeSubagentRunState(structuredClone(entry))),
    );
    const capturedContext = captureBranchStateWorkerContext();
    const sql = observeMainThreadSql();
    try {
      const write = persistSubagentRunsToDiskAsyncOrThrow(
        new Map([queued, terminal].map((entry) => [entry.runId, entry])),
        [queued.runId, terminal.runId, removed.runId],
        { context: capturedContext },
      );
      queued.task = "mutated after capture";
      queued.queuedLaunch.request.task = "mutated descriptor";
      terminal.completion.resultText = "mutated result";
      terminalReply.text = "mutated reply";
      await write;
      sql.expectIdle();
    } finally {
      sql.restore();
      await closeBranchStateDatabaseAsync();
    }
    const stored = loadSubagentRegistryFromSqlite();
    expect([...stored.keys()].toSorted()).toEqual(["private-terminal", "queued", "retained"]);
    expect(stored.get("queued")).toMatchObject({
      task: capturedTask,
      execution: { status: "queued" },
      completion: queued.completion,
      delivery: queued.delivery,
    });
    const database = openBranchStateDatabase({
      path: capturedContext.admission.databasePath,
      env: capturedContext.environment,
    });
    for (const row of expected) {
      expect(
        database.db.prepare("SELECT * FROM subagent_runs WHERE run_id = ?").get(row.run_id),
      ).toMatchObject(row);
    }
    expect(expected[1]?.payload_json).toContain('"parentCompletion":');
    const calibration = observeMainThreadSql();
    try {
      database.db.exec("BEGIN EXCLUSIVE;");
      database.db.exec("ROLLBACK");
      expect(() => calibration.expectIdle()).toThrow();
    } finally {
      calibration.restore();
      await closeBranchStateDatabaseAsync();
    }
  });
});

it("awaits the queued registration caller's two writes without host SQL", async () => {
  await withEnvAsync({ BRANCH_STATE_DIR: dirs.make("branch-queued-caller-") }, async () => {
    const entry = createRun("queued-caller");
    entry.requesterStorePath = "synthetic-requester-store";
    entry.controllerStorePath = "synthetic-controller-store";
    entry.queuedLaunch = {
      request: { sessionKey: entry.childSessionKey },
      timeoutMs: 100,
      schedulerGroupKey: "synthetic-group",
      maxConcurrent: 1,
    };
    const descriptor = structuredClone(entry.queuedLaunch);
    const capturedContext = captureBranchStateWorkerContext();
    const runs = new Map([[entry.runId, entry]]);
    saveSubagentRegistryToSqlite(new Map());
    const activate = vi.fn();
    const sql = observeMainThreadSql();
    try {
      const registration = registerRequiredQueuedSubagent({
        context: capturedContext,
        entry,
        manager: {
          runs,
          getRunsForChildSession: () => runs.values(),
          getRuntimeConfig: () => ({}),
          persistAsyncOrThrow: (writeContext, publication, ...runIds) =>
            persistSubagentRunsToDiskAsyncOrThrow(runs, runIds, {
              context: writeContext,
              ...publication,
            }),
        },
        originals: new Map(),
        bindReservation: () => {},
        activate,
      });
      expect(entry.queuedLaunch).toBeUndefined();
      expect(activate).not.toHaveBeenCalled();
      await registration;
      sql.expectIdle();
      expect(activate).toHaveBeenCalledOnce();
      expect(entry.queuedLaunch).toEqual(descriptor);
    } finally {
      sql.restore();
      await closeBranchStateDatabaseAsync();
    }
    expect(loadSubagentRegistryFromSqlite().get(entry.runId)).toMatchObject({
      queuedLaunch: descriptor,
      requesterStorePath: entry.requesterStorePath,
      controllerStorePath: entry.controllerStorePath,
    });
    await closeBranchStateDatabaseAsync();
  });
});

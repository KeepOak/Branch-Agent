import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { afterEach, expect, it, vi } from "vitest";
import * as backoff from "../infra/backoff.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import { runtimeProcessEntrypoints } from "../infra/runtime-process-entrypoints.js";
import { withRuntimeWorkerGeneration } from "../infra/runtime-worker-generation.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { readSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { getTrackedWorkerCpuSources } from "../infra/worker-cpu.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { withAgentDatabaseMaintenanceLease } from "./branch-agent-db-maintenance-lease.js";
import {
  createBranchDatabaseMaintenanceScope,
  StateDatabaseReadAdmissionInvalidatedError,
} from "./branch-state-db-async-lifecycle.js";
import {
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  BRANCH_STATE_SCHEMA_VERSION,
} from "./branch-state-db-contract.js";
import * as stateDatabaseOpen from "./branch-state-db-open.js";
import { CONTENT_VERSION_KEY } from "./branch-state-db-schema-version.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
  registerBranchStateDatabaseLifecycleListener,
  runBranchStateWriteTransaction,
} from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";
import { BranchStateLeaseAcquisitionError } from "./branch-state-lease-error.js";
import * as leaseStore from "./branch-state-lease-store.js";
import * as leaseStorage from "./branch-state-lease-worker-storage.js";
import { withBranchStateLease, type BranchStateLeaseContext } from "./branch-state-lease.js";
import * as workerContext from "./branch-state-worker-context.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  closeBranchStateDatabaseForTest();
});

function controlElapsedTime() {
  const now = performance.now.bind(performance);
  let elapsedMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now() + elapsedMs);
  return (milliseconds: number) => {
    elapsedMs += milliseconds;
  };
}

it.each([false, true])(
  "records an uncoded native open failure during acquisition (prepare: %s)",
  async (prepareDatabase) => {
    await withBranchTestState({ label: "lease-native-open-failure" }, async (state) => {
      const failure = new Error("native SQLite open unavailable");
      const open = nodeSqlite.openNodeSqliteDatabase;
      const pathname = resolveBranchStateSqlitePath(state.env);
      vi.spyOn(nodeSqlite, "openNodeSqliteDatabase").mockImplementation((location, options) => {
        if (location === pathname) {
          throw failure;
        }
        return open(location, options);
      });
      const run = vi.fn(async () => undefined);
      await expect(
        withBranchStateLease(
          {
            scope: "core:test",
            key: "native-open-failure",
            database: { scope: "shared", options: { env: state.env } },
            leaseMs: 60_000,
            waitMs: 5_000,
            prepareDatabase,
          },
          run,
        ),
      ).rejects.toMatchObject({
        outcome: { kind: "store-unavailable", reason: "storage-error" },
        cause: failure,
      });
      expect(run).not.toHaveBeenCalled();
    });
  },
);

it("rebinds the real shared-state lease worker and joins its retained generation", async () => {
  await withBranchTestState({ label: "lease-retained-worker-generation" }, async (state) => {
    const options = {
      scope: "core:test",
      key: "retained-generation",
      database: { scope: "shared" as const, options: { env: state.env } },
      leaseMs: 60_000,
      waitMs: 0,
    };
    const initialWorkers = getTrackedWorkerCpuSources().workers.length;
    await withBranchStateLease(options, async (lease) => lease.assertOwned());
    const source = resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.sharedStateStore);
    const retainedPath = path.join(
      path.dirname(resolveBranchStateSqlitePath(state.env)),
      "retained-state-worker.mts",
    );
    await fs.promises.writeFile(retainedPath, `export * from ${JSON.stringify(source.href)};\n`);
    const retained = pathToFileURL(await fs.promises.realpath(retainedPath));
    const dispatch = vi.spyOn(Worker.prototype, "postMessage");
    await withRuntimeWorkerGeneration(
      async (bind) => {
        bind((url) => (url.href === source.href ? retained : url));
        await withBranchStateLease(options, async (lease) => lease.assertOwned());
        expect(
          dispatch.mock.calls.some(
            ([request]) =>
              isRecord(request) && request.type === "open" && request.moduleUrl === retained.href,
          ),
        ).toBe(true);
      },
      async () => {},
    );
    expect(getTrackedWorkerCpuSources().workers).toHaveLength(initialWorkers);
    await withBranchStateLease(options, async (lease) => lease.assertOwned());
  });
});

it.each([false, true])(
  "preserves authority refusal before native open (prepare: %s)",
  async (prepareDatabase) => {
    await withBranchTestState({ label: "lease-preparation-refusal" }, async (state) => {
      const refusal = Object.assign(new Error("caller authority refused"), {
        code: "SQLITE_IOERR",
      });
      const scope = createBranchDatabaseMaintenanceScope();
      const nativeOpen = vi.spyOn(nodeSqlite, "openNodeSqliteDatabase");
      const run = vi.fn(async () => undefined);
      try {
        await expect(
          scope.run(() => {
            vi.spyOn(scope, "assertAdmission").mockImplementation(() => {
              throw refusal;
            });
            return withBranchStateLease(
              {
                scope: "core:test",
                key: "preparation-refusal",
                database: { scope: "shared", options: { env: state.env } },
                leaseMs: 60_000,
                waitMs: 5_000,
                prepareDatabase,
              },
              run,
            );
          }),
        ).rejects.toBe(refusal);
        expect(nativeOpen).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
      } finally {
        await scope.close();
      }
    });
  },
);

it("preserves the caller's typed admission refusal through lease acquisition", async () => {
  await withBranchTestState({ label: "lease-authority-refusal" }, async (state) => {
    const database = openBranchStateDatabase({ env: state.env });
    const refusal = new StateDatabaseReadAdmissionInvalidatedError("original authority refusal");
    const capture = workerContext.captureBranchStateWorkerContext;
    vi.spyOn(workerContext, "captureBranchStateWorkerContext").mockImplementation((options) => {
      const context = capture(options);
      context.admission = {
        ...context.admission,
        assertCurrent() {
          throw refusal;
        },
      };
      return context;
    });
    const run = vi.fn(async () => undefined);
    await expect(
      withBranchStateLease(
        {
          scope: "core:test",
          key: "authority-refusal",
          database: { scope: "shared", options: { env: state.env } },
          leaseMs: 60_000,
          waitMs: 0,
        },
        run,
      ),
    ).rejects.toBe(refusal);
    expect(run).not.toHaveBeenCalled();
    expect(database.db.prepare("SELECT * FROM state_leases").all()).toEqual([]);
  });
});

it.each(["maintenance", "generic"] as const)(
  "admits %s work after slow database preparation",
  async (caller) => {
    await withBranchTestState({ label: "lease-cold-admission" }, async (state) => {
      const advance = controlElapsedTime();
      const open = stateDatabaseOpen.openUnpublishedStateDatabase;
      const physicalOpen = vi
        .spyOn(stateDatabaseOpen, "openUnpublishedStateDatabase")
        .mockImplementation((options) => {
          const database = open(options);
          // Keep initialization and ownership real; only its elapsed cost is simulated.
          advance(6_000);
          return database;
        });
      const run = vi.fn(async (lease: BranchStateLeaseContext) => lease.assertOwned());
      const operation =
        caller === "maintenance"
          ? withAgentDatabaseMaintenanceLease({ env: state.env }, run)
          : withBranchStateLease(
              {
                scope: "core:test",
                key: "cold-admission",
                database: { scope: "shared", options: { env: state.env } },
                leaseMs: 60_000,
                waitMs: 5_000,
              },
              run,
            );
      await operation;
      expect(run).toHaveBeenCalledOnce();
      expect(physicalOpen).toHaveBeenCalled();
      expect(
        openBranchStateDatabase({ env: state.env })
          .db.prepare("SELECT * FROM state_leases")
          .all(),
      ).toEqual([]);
    });
  },
);

it("records unavailable storage when a native SQLite writer prevents observing a held lease", async () => {
  await withBranchTestState({ label: "lease-preparation-contention" }, async (state) => {
    const database = openBranchStateDatabase({ env: state.env });
    const identity = { scope: "core:test", key: "preparation-contention", owner: "other-process" };
    runBranchStateWriteTransaction(
      ({ db }) => leaseStore.acquireBranchStateLeaseInTransaction(db, identity, 60_000),
      { env: state.env },
    );
    closeBranchStateDatabaseForTest();
    const writer = new DatabaseSync(database.path);
    writer.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
    const run = vi.fn(async () => undefined);
    try {
      await expect(
        withBranchStateLease(
          {
            scope: identity.scope,
            key: identity.key,
            database: { scope: "shared", options: { env: state.env } },
            leaseMs: 60_000,
            waitMs: 5_000,
            prepareDatabase: true,
          },
          run,
        ),
      ).rejects.toMatchObject({
        code: "BRANCH_STATE_LEASE_STORAGE_FAILED",
        outcome: { kind: "store-unavailable", reason: "sqlite-busy" },
      });
      expect(run).not.toHaveBeenCalled();
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
    expect(
      openBranchStateDatabase({ env: state.env })
        .db.prepare("SELECT owner FROM state_leases WHERE scope = ? AND lease_key = ?")
        .get(identity.scope, identity.key),
    ).toMatchObject({ owner: identity.owner });
  });
});

it("does not enter maintenance after cancellation during storage preparation", async () => {
  await withBranchTestState({ label: "lease-aborted-preparation" }, async (state) => {
    const controller = new AbortController();
    const clock = vi.spyOn(performance, "now").mockReturnValue(1_000);
    const open = stateDatabaseOpen.openUnpublishedStateDatabase;
    vi.spyOn(stateDatabaseOpen, "openUnpublishedStateDatabase").mockImplementation((options) => {
      const database = open(options);
      clock.mockReturnValue(2_500);
      controller.abort(new Error("cancel preparation"));
      clock.mockReturnValue(9_000);
      return database;
    });
    const run = vi.fn(async () => undefined);
    await expect(
      withBranchStateLease(
        {
          scope: "core:test",
          key: "aborted-preparation",
          database: { scope: "shared", options: { env: state.env } },
          leaseMs: 60_000,
          waitMs: 5_000,
          prepareDatabase: true,
          signal: controller.signal,
        },
        run,
      ),
    ).rejects.toMatchObject({
      code: "BRANCH_STATE_LEASE_ABORTED",
      outcome: { kind: "aborted", reason: "caller-signal", elapsedMs: 1_500 },
      cause: controller.signal.reason,
    });
    expect(run).not.toHaveBeenCalled();
    expect(
      openBranchStateDatabase({ env: state.env }).db.prepare("SELECT * FROM state_leases").all(),
    ).toEqual([]);
  });
});

it.each(["acquired", "held", "store-unavailable"] as const)(
  "records cancellation while awaiting an acquisition that settles as %s",
  async (outcome) => {
    await withBranchTestState({ label: "lease-aborted-after-grant" }, async (state) => {
      const database = openBranchStateDatabase({ env: state.env });
      const identity = { scope: "core:test", key: "aborted-after-grant", owner: "other-owner" };
      if (outcome === "held") {
        runBranchStateWriteTransaction(
          ({ db }) => leaseStore.acquireBranchStateLeaseInTransaction(db, identity, 60_000),
          { env: state.env },
        );
      }
      const writer = outcome === "store-unavailable" ? new DatabaseSync(database.path) : undefined;
      writer?.exec("BEGIN IMMEDIATE");
      const controller = new AbortController();
      const acquire = leaseStorage.acquireLease;
      vi.spyOn(leaseStorage, "acquireLease").mockImplementation(async (...args) => {
        try {
          const result = await acquire(...args);
          expect(result.kind).toBe(outcome);
          return result;
        } catch (error) {
          expect(outcome).toBe("store-unavailable");
          expect(error).toMatchObject({ cause: { errcode: 5 } });
          throw error;
        } finally {
          // The caller ends before the awaiting lease owner consumes the worker's result.
          controller.abort(new Error("cancel pending acquisition"));
        }
      });
      const run = vi.fn(async () => undefined);
      try {
        const failure = await withBranchStateLease(
          {
            scope: identity.scope,
            key: identity.key,
            database: { scope: "shared", options: { env: state.env } },
            leaseMs: 60_000,
            waitMs: 0,
            signal: controller.signal,
          },
          run,
        ).catch((error: unknown) => error);
        expect(failure).toMatchObject({
          code: "BRANCH_STATE_LEASE_ABORTED",
          cause: controller.signal.reason,
        });
        if (outcome === "acquired") {
          expect(failure).not.toBeInstanceOf(BranchStateLeaseAcquisitionError);
        } else {
          expect(failure).toMatchObject({
            outcome: { kind: "aborted", reason: "caller-signal", elapsedMs: expect.any(Number) },
          });
        }
        expect(run).not.toHaveBeenCalled();
        expect(database.db.prepare("SELECT owner FROM state_leases").all()).toEqual(
          outcome === "held" ? [{ owner: identity.owner }] : [],
        );
      } finally {
        writer?.exec("ROLLBACK");
        writer?.close();
      }
    });
  },
);

it("restores the cached connection timeout after preparation fails during schema publication", async () => {
  await withBranchTestState({ label: "lease-preparation-restoration" }, async (state) => {
    const database = openBranchStateDatabase({ env: state.env });
    database.db
      .prepare(
        "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
      )
      .run(CONTENT_VERSION_KEY, String(BRANCH_STATE_SCHEMA_VERSION), Date.now());
    database.db.exec(`
      PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION - 1};
      UPDATE schema_meta SET schema_version = ${BRANCH_STATE_SCHEMA_VERSION - 1}
      WHERE meta_key = 'primary';
    `);
    closeBranchStateDatabaseForTest();
    let writer: DatabaseSync | undefined;
    let preparedBusyTimeoutMs: number | undefined;
    const unregister = registerBranchStateDatabaseLifecycleListener((event) => {
      if (event.kind === "opened" && event.database.path === database.path) {
        preparedBusyTimeoutMs = readSqliteBusyTimeout(event.database.db);
        writer = new DatabaseSync(database.path);
        writer.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
      }
    });
    const sleep = vi.spyOn(backoff, "sleepWithAbort");
    try {
      await expect(
        withAgentDatabaseMaintenanceLease({ env: state.env }, async (lease) => {
          lease.assertOwned();
        }),
      ).rejects.toMatchObject({
        code: "BRANCH_STATE_LEASE_STORAGE_FAILED",
        outcome: { kind: "store-unavailable", reason: "sqlite-busy" },
      });
      expect(preparedBusyTimeoutMs).toBe(0);
      expect(sleep).not.toHaveBeenCalled();
      if (writer?.isOpen) {
        writer.exec("ROLLBACK");
        writer.close();
      }
      expect(readSqliteBusyTimeout(openBranchStateDatabase({ env: state.env }).db)).toBe(
        BRANCH_SQLITE_BUSY_TIMEOUT_MS,
      );
    } finally {
      unregister();
      if (writer?.isOpen) {
        writer.exec("ROLLBACK");
        writer.close();
      }
    }
  });
});

it.each(["invalid", "aborted"] as const)(
  "rejects %s admission before preparing storage",
  async (reason) => {
    await withBranchTestState({ label: "lease-refused-preparation" }, async (state) => {
      const controller = new AbortController();
      if (reason === "aborted") {
        controller.abort();
      }
      await expect(
        withBranchStateLease(
          {
            scope: "core:test",
            key: "refused-preparation",
            database: { scope: "shared", options: { env: state.env } },
            leaseMs: reason === "invalid" ? 0 : 60_000,
            waitMs: 5_000,
            prepareDatabase: true,
            signal: controller.signal,
          },
          async () => undefined,
        ),
      ).rejects.toMatchObject({
        code:
          reason === "invalid"
            ? "BRANCH_STATE_LEASE_INVALID_INPUT"
            : "BRANCH_STATE_LEASE_ABORTED",
        ...(reason === "aborted"
          ? { outcome: { kind: "aborted", reason: "caller-signal", elapsedMs: expect.any(Number) } }
          : {}),
      });
      expect(fs.existsSync(resolveBranchStateSqlitePath(state.env))).toBe(false);
    });
  },
);

it.each([false, true])(
  "rejects an active database transaction before acquisition (supplied handle: %s)",
  async (supplied) => {
    await withBranchTestState({ label: "lease-active-transaction" }, async (state) => {
      const database = openBranchStateDatabase({ env: state.env });
      const options = {
        scope: "core:test",
        key: "active-transaction",
        database: {
          scope: "shared" as const,
          options: { env: state.env, ...(supplied ? { database } : {}) },
        },
        leaseMs: 60_000,
        waitMs: 0,
      };
      const run = vi.fn(async (lease: BranchStateLeaseContext) => lease.assertOwned());
      database.db.exec("BEGIN");
      database.db.prepare("SELECT owner FROM state_leases").all();
      let failure: unknown;
      try {
        failure = await withBranchStateLease(options, run).catch((error: unknown) => error);
      } finally {
        database.db.exec("ROLLBACK");
      }
      expect({
        failure,
        entered: run.mock.calls.length,
        leases: database.db.prepare("SELECT owner FROM state_leases").all(),
      }).toMatchObject({
        failure: { code: "BRANCH_STATE_LEASE_INVALID_INPUT" },
        entered: 0,
        leases: [],
      });
      await withBranchStateLease(options, run);
      expect(run).toHaveBeenCalledOnce();
      expect(database.db.prepare("SELECT owner FROM state_leases").all()).toEqual([]);
    });
  },
);

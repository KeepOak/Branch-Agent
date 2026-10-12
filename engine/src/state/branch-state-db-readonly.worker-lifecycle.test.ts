import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { AsyncPreparedSqliteReadOnlyLocation } from "../infra/sqlite-readonly-location.types.js";
import { createDeferredCore } from "../shared/deferred.js";
import {
  createReadWorkerFixture,
  observeAsyncFixture,
  retainFixturePreparation,
} from "./branch-state-db-readonly.test-support.js";
import type {
  BranchStateReadAuthority,
  BranchStateReadLocation,
  BranchStateReadOutcome,
} from "./branch-state-read.types.js";

vi.hoisted(() => {
  // Shared setup can preload the real reader; bind this fixture to its transport mocks.
  vi.resetModules();
});

const mock = vi.hoisted(() => ({
  close: vi.fn<() => Promise<void>>(),
  read: vi.fn<
    (
      source: BranchStateReadLocation,
      authority: BranchStateReadAuthority,
    ) => Promise<BranchStateReadOutcome>
  >(),
  cleanup: vi.fn<() => Promise<boolean>>(),
  borrow: vi.fn(),
  independent: vi.fn(),
  prepareNative: vi.fn(),
  prepareSource: vi.fn(),
  prepareSourceAsync: vi.fn(),
}));

vi.mock("./branch-state-db-cache.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./branch-state-db-cache.js")>()),
  borrowBranchStateDatabaseForAsyncRead: mock.borrow,
  retainBranchStateDatabaseForIndependentRead: mock.independent,
}));
vi.mock("../infra/sqlite-readonly-location.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/sqlite-readonly-location.js")>()),
  prepareSqliteReadOnlyLocationFromOwnedDatabase: mock.prepareNative,
}));
let finishProducer: (() => void) | undefined;
vi.mock("./branch-state-read-worker.js", () => createReadWorkerFixture(mock.read, mock.close));
vi.mock("../infra/sqlite-snapshot-source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/sqlite-snapshot-source.js")>()),
  prepareSqliteReadOnlyLocation: mock.prepareSource,
  startSqliteReadOnlyLocationAsync: (
    ...args: Parameters<
      typeof import("../infra/sqlite-snapshot-source.js").startSqliteReadOnlyLocationAsync
    >
  ) =>
    retainFixturePreparation(
      observeAsyncFixture(async () => {
        const prepared: AsyncPreparedSqliteReadOnlyLocation = await mock.prepareSourceAsync(
          ...args,
        );
        return {
          ...prepared,
          startCleanup: () => observeAsyncFixture(() => prepared.cleanupAsync()),
        };
      }),
    ),
}));
vi.mock("../infra/sqlite-readonly-location-cleanup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/sqlite-readonly-location-cleanup.js")>()),
  // Preparation is mocked; this fixture has no private directory to retain.
  retainSnapshotTempDirectory: () => () => {},
}));

import { createBranchDatabaseMaintenanceScope } from "./branch-state-db-async-lifecycle.js";
import {
  captureBranchStateDatabaseReadAdmission,
  closeBranchStateDatabaseByPathAsync,
} from "./branch-state-db-cache.js";
import {
  executeExistingBranchStateRead,
  withArtifactPreservingStateReads,
  withBranchStateDatabaseReadSnapshot,
} from "./branch-state-db-readonly.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    finishProducer?.();
    finishProducer = undefined;
    mock.close.mockReset().mockResolvedValue();
    mock.cleanup.mockReset().mockResolvedValue(true);
    await closeBranchStateDatabaseAsync();
    closeBranchStateDatabaseForTest();
    cleanup();
  }),
);
beforeEach(() => {
  mock.borrow.mockReset();
  mock.independent.mockReset();
  mock.prepareNative.mockReset().mockImplementation(async () => ({
    location: "/fixture/prepared.sqlite",
    cleanupAsync: mock.cleanup,
  }));
  mock.prepareSource.mockReset().mockImplementation(async () => ({
    location: "/fixture/prepared.sqlite",
    cleanupRoot: "/fixture/prepared",
    cleanup: () => true,
    cleanupAsync: mock.cleanup,
  }));
  mock.prepareSourceAsync.mockReset().mockImplementation(async () => ({
    location: "/fixture/prepared.sqlite",
    cleanupRoot: "/fixture/prepared",
    cleanupAsync: mock.cleanup,
  }));
  mock.close.mockReset().mockResolvedValue();
  mock.cleanup.mockReset().mockResolvedValue(true);
  mock.read.mockReset().mockResolvedValue({
    value: { ok: true, type: "fleet.list", sourceAdmitted: true, cells: [] },
  });
});

function source() {
  const root = tempDirs.make("branch-read-cleanup-owner-");
  const pathname = path.join(root, "source.sqlite");
  // Only filesystem identity is used; the mocked transport never opens SQLite.
  fs.writeFileSync(pathname, "mock read transport source");
  return { path: pathname, env: { BRANCH_STATE_DIR: root } };
}

it("retains the borrowed source through pending preparation and failed published cleanup", async () => {
  const options = source();
  const started = createDeferredCore();
  const prepared = createDeferredCore<{
    location: string;
    cleanupAsync: () => Promise<boolean>;
  }>();
  const release = vi.fn();
  mock.borrow.mockReturnValue({ database: { db: {} }, assertCurrent() {}, observe() {}, release });
  mock.prepareNative.mockImplementation(async () => {
    started.resolve();
    return prepared.promise;
  });
  mock.cleanup.mockResolvedValueOnce(false).mockResolvedValue(true);
  finishProducer = () =>
    prepared.resolve({ location: "/fixture/prepared.sqlite", cleanupAsync: mock.cleanup });
  const result = withArtifactPreservingStateReads(() =>
    executeExistingBranchStateRead(options, { type: "fleet.list" }),
  ).catch((error: unknown) => error);
  await started.promise;
  const closing = closeBranchStateDatabaseByPathAsync(options.path).catch(
    (error: unknown) => error,
  );
  expect(release).not.toHaveBeenCalled();
  expect(mock.read).not.toHaveBeenCalled();
  finishProducer();
  expect(await closing).toMatchObject({
    message: expect.stringMatching(/snapshot cleanup failed/),
  });
  expect(await result).toBeInstanceOf(Error);
  expect(mock.read).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  await closeBranchStateDatabaseByPathAsync(options.path);
  expect(mock.cleanup).toHaveBeenCalledTimes(2);
  expect(release).toHaveBeenCalledOnce();
});

it("retains ordered cleanup for canonical retry after a read failure", async () => {
  const options = source();
  const readFailure = new Error("read failed");
  const stopFailure = new Error("transport stop not acknowledged");
  mock.read.mockRejectedValue(readFailure);
  mock.close.mockRejectedValueOnce(stopFailure);
  mock.cleanup.mockResolvedValueOnce(false).mockResolvedValue(true);

  await expect(
    withArtifactPreservingStateReads(() =>
      executeExistingBranchStateRead(options, { type: "fleet.list" }),
    ),
  ).rejects.toMatchObject({ cause: readFailure, errors: [readFailure, stopFailure] });
  expect(mock.cleanup).not.toHaveBeenCalled();
  await expect(closeBranchStateDatabaseByPathAsync(options.path)).rejects.toThrow(
    "snapshot cleanup failed",
  );
  expect(mock.close).toHaveBeenCalledTimes(2);
  expect(() => captureBranchStateDatabaseReadAdmission(options.path)).toThrow(/closed/);
  await expect(closeBranchStateDatabaseByPathAsync(options.path)).resolves.toBe(false);
  expect(mock.close).toHaveBeenCalledTimes(2);
  expect(mock.cleanup).toHaveBeenCalledTimes(2);
  expect(() =>
    captureBranchStateDatabaseReadAdmission(options.path).assertCurrent(),
  ).not.toThrow();
});

it("retains an outer snapshot until its child transport acknowledges cleanup", async () => {
  const options = source();
  const failure = new Error("child stop not acknowledged");
  mock.close.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure).mockResolvedValue();
  await expect(
    withBranchStateDatabaseReadSnapshot(
      () => executeExistingBranchStateRead(options, { type: "fleet.list" }),
      options,
    ),
  ).rejects.toMatchObject({ cause: failure });
  expect(mock.cleanup).not.toHaveBeenCalled();
  await expect(closeBranchStateDatabaseByPathAsync(options.path)).resolves.toBe(false);
  expect(mock.close).toHaveBeenCalledTimes(3);
  expect(mock.cleanup).toHaveBeenCalledTimes(1);
});

it("keeps a composite snapshot alive when its callback closes the live writer", async () => {
  const options = source();
  await withBranchStateDatabaseReadSnapshot(async () => {
    await closeBranchStateDatabaseByPathAsync(options.path);
    expect(mock.cleanup).not.toHaveBeenCalled();
    expect(await executeExistingBranchStateRead(options, { type: "fleet.list" })).toEqual({
      ok: true,
      type: "fleet.list",
      sourceAdmitted: true,
      cells: [],
    });
  }, options);
  expect(mock.cleanup).toHaveBeenCalledTimes(1);
});

it("retries transport stop before waiting for a still-pending producer", async () => {
  const options = source();
  const started = createDeferredCore();
  const reply = createDeferredCore<BranchStateReadOutcome>();
  finishProducer = () =>
    reply.resolve({ value: { ok: true, type: "fleet.list", sourceAdmitted: true, cells: [] } });
  mock.read.mockImplementation(() => {
    started.resolve();
    return reply.promise;
  });
  const failure = new Error("first stop not acknowledged");
  mock.close.mockRejectedValueOnce(failure).mockImplementation(async () => {
    reply.resolve({ value: { ok: true, type: "fleet.list", sourceAdmitted: true, cells: [] } });
  });
  const observed = withArtifactPreservingStateReads(() =>
    executeExistingBranchStateRead(options, { type: "fleet.list" }),
  ).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await started.promise;
  await expect(closeBranchStateDatabaseByPathAsync(options.path)).rejects.toBe(failure);
  expect(mock.cleanup).not.toHaveBeenCalled();
  await expect(closeBranchStateDatabaseByPathAsync(options.path)).resolves.toBe(false);
  expect(mock.close).toHaveBeenCalledTimes(2);
  expect(mock.cleanup).toHaveBeenCalledTimes(1);
  expect(await observed).toMatchObject({
    error: expect.objectContaining({ message: expect.stringMatching(/closed/) }),
  });
});

it.each(["success", "unadmitted failure", "admitted failure", "retired failure"] as const)(
  "observes only admitted, current independent sources: %s",
  async (outcome) => {
    const options = source();
    const failure = new Error("query failed");
    const retired = new Error("original source retired");
    const assertCurrent = vi.fn();
    const observe = vi.fn();
    const release = vi.fn();
    mock.borrow.mockImplementation(() => {
      throw new Error("Asynchronous shared-state reads cannot run inside a native transaction");
    });
    mock.independent.mockReturnValue({ assertCurrent, observe, release });
    if (outcome !== "success") {
      mock.read.mockImplementation(async () => {
        if (outcome === "retired failure") {
          assertCurrent.mockImplementation(() => {
            throw retired;
          });
        }
        return {
          error: failure,
          ...(outcome !== "unadmitted failure" ? { sourceAdmitted: true } : {}),
        };
      });
    }
    const read = executeExistingBranchStateRead(options, { type: "fleet.list" });
    if (outcome === "success") {
      await expect(read).resolves.toEqual({
        ok: true,
        type: "fleet.list",
        sourceAdmitted: true,
        cells: [],
      });
    } else if (outcome === "retired failure") {
      await expect(read).rejects.toMatchObject({ cause: failure, errors: [failure, retired] });
    } else {
      await expect(read).rejects.toBe(failure);
    }
    expect(observe).toHaveBeenCalledTimes(
      outcome === "success" || outcome === "admitted failure" ? 1 : 0,
    );
    expect(release).toHaveBeenCalledOnce();
    expect(mock.borrow).not.toHaveBeenCalled();
    expect(mock.prepareNative).not.toHaveBeenCalled();
    expect(mock.prepareSource).not.toHaveBeenCalled();
    expect(mock.prepareSourceAsync).not.toHaveBeenCalled();
  },
);

it("joins maintenance reads and retries their transport before closing scoped handles", async () => {
  const options = source();
  const scope = createBranchDatabaseMaintenanceScope();
  const started = createDeferredCore();
  const reply = createDeferredCore<BranchStateReadOutcome>();
  const events: string[] = [];
  const failure = new Error("transport stop not acknowledged");
  finishProducer = () =>
    reply.resolve({ value: { ok: true, type: "fleet.list", sourceAdmitted: true, cells: [] } });
  mock.read.mockImplementation(() => {
    started.resolve();
    return reply.promise;
  });
  mock.close
    .mockRejectedValueOnce(failure)
    .mockRejectedValueOnce(failure)
    .mockImplementation(async () => {
      events.push("transport stopped");
    });
  scope.own({}, "shared-handles", () => {
    events.push("handle closed");
  });
  const operation = scope.run(() =>
    executeExistingBranchStateRead(options, { type: "fleet.list" }),
  );
  const assertion = expect(operation).rejects.toBe(failure);
  await started.promise;
  const closing = scope.close();
  const closeAssertion = expect(closing).rejects.toBe(failure);
  expect(events).toEqual([]);
  finishProducer();
  await assertion;
  await closeAssertion;
  expect(events).toEqual([]);
  await scope.close();
  expect(events).toEqual(["transport stopped", "handle closed"]);
});

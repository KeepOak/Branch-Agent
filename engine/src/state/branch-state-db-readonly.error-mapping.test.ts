import fs from "node:fs";
import path from "node:path";
import type { OwnedWorkerTask } from "@branch/worker-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as sqliteRuntime from "../infra/bun-sqlite-library.js";
import { createOwnedWorkerTaskPoolMock } from "../infra/worker-task-pool.mock.test-support.js";
import type { RetainedWorkerTask } from "../infra/worker-task-pool.types.js";
import { PluginBlobStoreError } from "../plugin-state/plugin-blob-store.types.js";
import { createDeferredCore } from "../shared/deferred.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseByPathAsync,
} from "./branch-state-db-cache.js";
import { executeExistingBranchStateRead } from "./branch-state-db-readonly.js";
import { observeAsyncFixture } from "./branch-state-db-readonly.test-support.js";
import { withExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import type {
  BranchStateReadReceipt,
  BranchStateReadReply,
  BranchStateReadRequest,
} from "./branch-state-read.types.js";
import { captureBranchStateReadWorkerContext } from "./branch-state-worker-context.js";
import { encodeBranchStateWorkerError } from "./branch-state-worker-error.js";

const mock = vi.hoisted(() => ({
  run: vi.fn<() => Promise<BranchStateReadReply>>(),
  close: vi.fn<OwnedWorkerTask<BranchStateReadReply>["close"]>(),
  closePool: vi.fn<() => Promise<void>>(),
  closeResources: vi.fn<(key?: string) => Promise<void>>(),
  rotate: vi.fn<() => Promise<void>>(),
}));
vi.mock("./branch-state-worker-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./branch-state-worker-context.js")>();
  return {
    ...actual,
    captureBranchStateReadWorkerContext: vi.fn(actual.captureBranchStateReadWorkerContext),
  };
});
vi.mock("../infra/worker-task-pool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/worker-task-pool.js")>()),
  createOwnedWorkerTaskPool: () =>
    createOwnedWorkerTaskPoolMock<BranchStateReadRequest, BranchStateReadReply>({
      startTask: (): RetainedWorkerTask<BranchStateReadReply> => ({
        ...observeAsyncFixture(mock.run),
        release: (options) => observeAsyncFixture(() => mock.close(options)),
      }),
      close: mock.closePool,
      closeResources: mock.closeResources,
      rotate: mock.rotate,
    }),
}));

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    mock.close.mockResolvedValue();
    mock.closePool.mockResolvedValue();
    mock.closeResources.mockResolvedValue();
    mock.rotate.mockResolvedValue();
    await closeBranchStateDatabaseAsync();
    cleanup();
  }),
);
const reply: BranchStateReadReply = {
  ok: true,
  type: "fleet.list",
  sourceAdmitted: true,
  cells: [],
};
beforeEach(() => {
  mock.run.mockReset().mockResolvedValue(reply);
  mock.close.mockReset().mockResolvedValue();
  mock.closePool.mockReset().mockResolvedValue();
  mock.closeResources.mockReset().mockResolvedValue();
  mock.rotate.mockReset().mockResolvedValue();
});
function source() {
  const root = tempDirs.make("state-read-error-phase-");
  const pathname = path.join(root, "source.sqlite");
  // The mocked worker uses only this filesystem identity; no SQLite connection opens.
  fs.writeFileSync(pathname, "mock transport source");
  return { path: pathname, env: { BRANCH_STATE_DIR: root } };
}
function mapper() {
  const mapped = new Error("mapped read failure");
  return {
    mapped,
    mapError: vi.fn((_error: unknown, _phase: BranchStateReadReceipt["phase"]) => mapped),
  };
}

it.each([false, true])(
  "closes a mapped reader with explicit SQLite close capability %s",
  async (explicitClose) => {
    const capabilities = vi.spyOn(sqliteRuntime, "getSqliteRuntimeCapabilities").mockReturnValue({
      explicitSqliteCloseReleasesNativeResources: explicitClose,
      decided: true,
      reason: "test policy",
    });
    try {
      const options = source();
      await executeExistingBranchStateRead(options, { type: "fleet.list" });
      await closeBranchStateDatabaseByPathAsync(options.path);
      expect(explicitClose ? mock.closeResources : mock.rotate).toHaveBeenCalledOnce();
      expect(explicitClose ? mock.rotate : mock.closeResources).not.toHaveBeenCalled();
      expect(mock.closePool).not.toHaveBeenCalled();
      await closeBranchStateDatabaseAsync();
      expect(mock.closePool).toHaveBeenCalledOnce();
    } finally {
      capabilities.mockRestore();
    }
  },
);

it.each(["retired", "different-source", "capture", "schema"] as const)(
  "maps %s authority failure once before dispatching a read",
  async (kind) => {
    const options = source();
    const original = new Error("original read admission refusal");
    const context =
      kind === "schema"
        ? withExistingBranchStateSchema({ path: options.path }, () =>
            captureBranchStateReadWorkerContext(options),
          )
        : kind === "capture"
          ? undefined
          : captureBranchStateReadWorkerContext(options);
    if (kind === "retired") {
      await closeBranchStateDatabaseByPathAsync(options.path);
    }
    if (kind === "capture") {
      vi.mocked(captureBranchStateReadWorkerContext).mockImplementationOnce(() => {
        throw original;
      });
    }
    const { mapped, mapError } = mapper();
    const read = () =>
      executeExistingBranchStateRead(
        kind === "different-source" ? source() : options,
        { type: "fleet.list" },
        { context, mapError },
      );
    if (kind === "capture" || kind === "schema") {
      expect(read).toThrow(mapped);
    } else {
      await expect(Promise.resolve().then(read)).rejects.toBe(mapped);
    }
    expect(mapError).toHaveBeenCalledOnce();
    expect(mapError.mock.calls[0]?.[1]).toBe("before-read");
    if (kind !== "schema") {
      expect(mapError).toHaveBeenCalledExactlyOnceWith(
        kind === "capture"
          ? original
          : expect.objectContaining(
              kind === "retired"
                ? { code: "STATE_DATABASE_READ_ADMISSION_INVALIDATED" }
                : { message: "Shared-state read context does not match its selected source" },
            ),
        "before-read",
      );
    }
    expect(mock.run).not.toHaveBeenCalled();
    expect(mock.close).not.toHaveBeenCalled();
  },
);

it.each(["before-read", "read", "unobserved"] as const)(
  "maps the complete %s failure after transport cleanup",
  async (phase) => {
    const original =
      phase === "read"
        ? new PluginBlobStoreError("query failed", {
            code: "PLUGIN_BLOB_CORRUPT",
            operation: "lookup",
            path: "/fixture/blob.sqlite",
          })
        : new Error("source admission or transport failed");
    const cleanup = new Error("cleanup failed");
    if (phase === "unobserved") {
      mock.run.mockRejectedValue(original);
    } else {
      mock.run.mockResolvedValue({
        ok: false,
        ...(phase === "read" ? { sourceAdmitted: true } : {}),
        message: original.message,
        error: encodeBranchStateWorkerError(original, { includeOrdinary: true }),
      });
      if (phase === "read") {
        mock.close.mockRejectedValueOnce(cleanup);
      }
    }
    const { mapped, mapError } = mapper();
    await expect(
      executeExistingBranchStateRead(source(), { type: "fleet.list" }, { mapError }),
    ).rejects.toBe(mapped);
    expect(mapError).toHaveBeenCalledOnce();
    expect(mock.close).toHaveBeenCalledOnce();
    expect(mock.close.mock.invocationCallOrder[0]).toBeLessThan(
      mapError.mock.invocationCallOrder[0]!,
    );
    const [error, observedPhase] = mapError.mock.calls[0]!;
    expect(observedPhase).toBe(phase);
    if (phase === "read") {
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) {
        throw new Error("Expected aggregate");
      }
      expect(error.errors[0]).toBeInstanceOf(PluginBlobStoreError);
      expect(error.errors[0]).toMatchObject({
        code: "PLUGIN_BLOB_CORRUPT",
        operation: "lookup",
        path: "/fixture/blob.sqlite",
      });
      expect(error.errors[1]).toBe(cleanup);
      expect(error.cause).toBe(error.errors[0]);
    } else {
      expect(mapError).toHaveBeenCalledExactlyOnceWith(
        phase === "unobserved" ? original : expect.objectContaining({ message: original.message }),
        phase,
      );
    }
  },
);

it("retains a successful receipt through failed task cleanup and canonical retry", async () => {
  const options = source();
  const closing = createDeferredCore();
  const stopped = createDeferredCore();
  mock.close.mockImplementationOnce(() => {
    closing.resolve();
    return stopped.promise;
  });
  const { mapped, mapError } = mapper();
  const publish = vi.fn();
  const pending = executeExistingBranchStateRead(options, { type: "fleet.list" }, { mapError });
  const assertion = expect(pending.then(publish)).rejects.toBe(mapped);
  const cleanup = new Error("successful read cleanup failed");
  try {
    await closing.promise;
    expect(publish).not.toHaveBeenCalled();
    expect(mapError).not.toHaveBeenCalled();
    expect(mock.closePool).not.toHaveBeenCalled();
  } finally {
    stopped.reject(cleanup);
  }
  await assertion;
  expect(mapError).toHaveBeenCalledExactlyOnceWith(cleanup, "read");
  expect(mock.close).toHaveBeenCalledOnce();
  await closeBranchStateDatabaseByPathAsync(options.path);
  expect(mock.close).toHaveBeenCalledTimes(2);
  expect(mock.closePool).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
  await expect(pending).rejects.toBe(mapped);
  expect(mapError).toHaveBeenCalledOnce();
});

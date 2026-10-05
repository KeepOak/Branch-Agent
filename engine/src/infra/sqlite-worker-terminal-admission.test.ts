import { existsSync, mkdirSync, rmdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  clearBranchStateDatabaseOpenFailure,
  closeBranchStateDatabaseAsync,
  isBranchStateDatabaseOpen,
  recordBranchStateDatabaseOpenFailure,
} from "../state/branch-state-db-cache.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import {
  executeBranchStateWorker,
  runBranchStateWorkerOperation,
} from "../state/branch-state-worker-store.js";
import { observeMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";
import * as fileDescriptor from "./file-descriptor.js";
import { readStableSqliteFileGeneration } from "./sqlite-file-generation.js";
import type { SqliteWorkerReply } from "./sqlite-worker-contract.js";

const paths = new Set<string>();
const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeBranchStateDatabaseAsync();
    for (const pathname of paths) {
      clearBranchStateDatabaseOpenFailure(pathname);
    }
    paths.clear();
    cleanup();
  }),
);

function fixture() {
  const env = { BRANCH_STATE_DIR: dirs.make("branch-worker-terminal-admission-") };
  const capture = () => captureBranchStateWorkerContext({ env });
  const pathname = capture().admission.databasePath;
  paths.add(pathname);
  return {
    capture,
    pathname,
    read: () =>
      executeBranchStateWorker(capture(), {
        type: "plugins.conversationBindingApprovals.read",
        input: undefined,
      }),
  };
}

function observeMainDatabaseWork() {
  const sql = observeMainThreadSql();
  const hash = vi.spyOn(fileDescriptor, "hashFileDescriptorSync");
  return {
    expectIdle: () => {
      sql.expectIdle();
      expect(hash).not.toHaveBeenCalled();
    },
    restore: () => {
      sql.restore();
      hash.mockRestore();
    },
  };
}

describe("shared-state worker terminal admission", () => {
  it("rejects fresh domain reads after a parent failure with only a worker open, then recovers on clear", async () => {
    const state = fixture();
    const main = observeMainDatabaseWork();
    try {
      expect(await state.read()).toEqual([]);
      expect(isBranchStateDatabaseOpen(state.pathname)).toBe(false);
      const failure = new Error("verified shared-state failure");
      expect(recordBranchStateDatabaseOpenFailure(state.pathname, failure)).toBe(true);
      await expect(state.read()).rejects.toBe(failure);
      clearBranchStateDatabaseOpenFailure(state.pathname);
      expect(await state.read()).toEqual([]);
      expect(isBranchStateDatabaseOpen(state.pathname)).toBe(false);
      main.expectIdle();
    } finally {
      main.restore();
    }
  });

  it("retains a terminal fact when worker inspection fails, then recovers after a stable mismatch", async () => {
    const state = fixture();
    expect(await state.read()).toEqual([]);
    await closeBranchStateDatabaseAsync();
    const failure = new Error("generation awaiting successful inspection");
    expect(
      recordBranchStateDatabaseOpenFailure(
        state.pathname,
        failure,
        readStableSqliteFileGeneration(state.pathname),
      ),
    ).toBe(true);
    const { getBranchStateDatabaseTerminalFailureAsync } =
      await import("../state/branch-state-db-cache.js");
    const wal = `${state.pathname}-wal`;
    mkdirSync(wal);
    let main = observeMainDatabaseWork();
    try {
      await expect(
        getBranchStateDatabaseTerminalFailureAsync(state.capture()),
      ).rejects.toBeInstanceOf(Error);
      main.expectIdle();
    } finally {
      main.restore();
      rmdirSync(wal);
    }
    // Removing the unreadable sidecar leaves the original recorded generation intact.
    main = observeMainDatabaseWork();
    try {
      await expect(state.read()).rejects.toBe(failure);
      main.expectIdle();
    } finally {
      main.restore();
    }
    const database = new DatabaseSync(state.pathname);
    try {
      database.exec("PRAGMA application_id = 321");
    } finally {
      database.close();
    }
    main = observeMainDatabaseWork();
    try {
      expect(await state.read()).toEqual([]);
      expect(isBranchStateDatabaseOpen(state.pathname)).toBe(false);
      main.expectIdle();
    } finally {
      main.restore();
    }
  });

  it("does not create absent state while checking a recorded failure or an existing-only read", async () => {
    const state = fixture();
    const failure = new Error("recorded failure before first open");
    recordBranchStateDatabaseOpenFailure(state.pathname, failure);
    const inspect = vi.fn(async () => "unexpected domain call");
    const main = observeMainDatabaseWork();
    try {
      await expect(
        runBranchStateWorkerOperation(state.capture(), inspect, { existingOnly: true }),
      ).rejects.toBe(failure);
      expect(existsSync(state.pathname)).toBe(false);
      clearBranchStateDatabaseOpenFailure(state.pathname);
      expect(
        await runBranchStateWorkerOperation(state.capture(), inspect, { existingOnly: true }),
      ).toBeUndefined();
      expect(inspect).not.toHaveBeenCalled();
      expect(existsSync(state.pathname)).toBe(false);
      main.expectIdle();
    } finally {
      main.restore();
    }
  });

  it("rejects a queued domain job before dispatch after record and clear while completing the dispatched read", async () => {
    const state = fixture();
    expect(await state.read()).toEqual([]);
    const replyReady = createDeferred();
    const queuedReady = createDeferred();
    let publish: (() => void) | undefined;
    const replies = vi.spyOn(Worker.prototype, "emit").mockImplementationOnce(function (
      this: Worker,
      event: string | symbol,
      reply: SqliteWorkerReply,
    ) {
      replies.mockRestore();
      publish = () => this.emit(event, reply);
      replyReady.resolve();
      return true;
    });
    const requests = vi.spyOn(Worker.prototype, "postMessage");
    const active = runBranchStateWorkerOperation(state.capture(), (scope) =>
      scope.execute({ type: "plugins.conversationBindingApprovals.read", input: undefined }),
    );
    let queued: Promise<unknown> | undefined;
    let draining: Promise<void> | undefined;
    try {
      await replyReady.promise;
      queued = runBranchStateWorkerOperation(state.capture(), (scope) => {
        const reading = scope.execute({
          type: "plugins.conversationBindingApprovals.read",
          input: undefined,
        });
        queuedReady.resolve();
        return reading;
      });
      const outcomes = Promise.allSettled([active, queued]);
      await queuedReady.promise;
      recordBranchStateDatabaseOpenFailure(state.pathname, new Error("parent terminal record"));
      clearBranchStateDatabaseOpenFailure(state.pathname);
      publish?.();
      publish = undefined;
      expect(await outcomes).toEqual([
        { status: "fulfilled", value: [] },
        {
          status: "rejected",
          reason: expect.objectContaining({ message: expect.stringContaining("read admission") }),
        },
      ]);
      draining = closeBranchStateDatabaseAsync();
      await draining;
      expect(requests.mock.calls.filter(([request]) => request.type === "execute")).toHaveLength(1);
      requests.mockRestore();
      expect(await state.read()).toEqual([]);
    } finally {
      replies.mockRestore();
      publish?.();
      requests.mockRestore();
      await Promise.allSettled([active, queued, draining]);
    }
  });
});

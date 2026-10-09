import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireNodeSqlite } from "./node-sqlite.js";
import { runSqliteDeferredTransactionSync } from "./sqlite-transaction.js";

const HOLD_MS = 300;
const roots: string[] = [];

// A rollback-journal writer holding EXCLUSIVE blocks readers, so a deferred read must wait for it.
// The holder signals once it holds the lock, then keeps it for HOLD_MS before committing.
const HOLDER_SOURCE = `
const { workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(workerData.file);
db.exec("BEGIN EXCLUSIVE");
Atomics.store(workerData.locked, 0, 1);
Atomics.notify(workerData.locked, 0);
Atomics.wait(workerData.gate, 0, 0, workerData.holdMs);
db.exec("COMMIT");
db.close();
`;

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("deferred transaction lock wait", () => {
  it("reports the wait a deferred read spends behind another writer as lockWaitMs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "deferred-lock-wait-"));
    roots.push(root);
    const file = path.join(root, "state.sqlite");
    const { DatabaseSync } = requireNodeSqlite();
    const setup = new DatabaseSync(file);
    setup.exec("CREATE TABLE entries (id TEXT NOT NULL); INSERT INTO entries VALUES ('a');");
    setup.close();

    const locked = new Int32Array(new SharedArrayBuffer(4));
    const gate = new Int32Array(new SharedArrayBuffer(4));
    const holder = new Worker(HOLDER_SOURCE, {
      eval: true,
      workerData: { file, locked, gate, holdMs: HOLD_MS },
    });
    const exited = once(holder, "exit");
    // Block until the holder owns the lock, so the read below must wait for it.
    Atomics.wait(locked, 0, 0, 5_000);

    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      const logger = { warn: vi.fn() };
      const rows = runSqliteDeferredTransactionSync(
        db,
        () => db.prepare("SELECT id FROM entries").all(),
        { logger, operationLabel: "test.deferred-read", slowTransactionHoldMs: 0 },
      );
      expect(rows).toEqual([{ id: "a" }]);

      const hold = logger.warn.mock.calls.find(
        ([message]) => message === "slow SQLite transaction hold",
      );
      expect(hold).toBeDefined();
      const fields = hold?.[1] as {
        elapsedMs: number;
        heldMs: number;
        lockWaitMs: number;
        mode: string;
        operation: string;
      };
      expect(fields).toMatchObject({ mode: "deferred", operation: "test.deferred-read" });
      // The read waited for the holder's remaining hold time; the wait sits inside elapsedMs.
      expect(fields.lockWaitMs).toBeGreaterThanOrEqual(HOLD_MS / 2);
      expect(fields.heldMs).toBeGreaterThanOrEqual(0);
      // elapsedMs (Date clock, whole ms) covers the wait plus the held time.
      expect(Math.abs(fields.elapsedMs - (fields.lockWaitMs + fields.heldMs))).toBeLessThanOrEqual(
        2,
      );
    } finally {
      db.close();
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      await exited;
    }
  });
});

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

// Production state databases run in WAL. A second connection holding BEGIN IMMEDIATE owns the write
// lock; a deferred transaction whose first statement is a write must wait for it in its busy handler.
// The holder signals once it owns the lock, keeps it for HOLD_MS, then commits.
const HOLDER_SOURCE = `
const { workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(workerData.file);
db.exec("BEGIN IMMEDIATE");
Atomics.store(workerData.locked, 0, 1);
Atomics.notify(workerData.locked, 0);
Atomics.wait(workerData.gate, 0, 0, workerData.holdMs);
db.exec("COMMIT");
db.close();
`;

function createWalDatabase(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deferred-lock-wait-"));
  roots.push(root);
  const file = path.join(root, "state.sqlite");
  const { DatabaseSync } = requireNodeSqlite();
  const setup = new DatabaseSync(file);
  setup.exec("PRAGMA journal_mode = WAL");
  setup.exec("CREATE TABLE entries (id TEXT NOT NULL); INSERT INTO entries VALUES ('a');");
  setup.close();
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("deferred transaction lock wait", () => {
  it("keeps the write-first deferred semantics: the write lands after another connection commits", () => {
    const file = createWalDatabase();
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(file);
    const other = new DatabaseSync(file);
    try {
      runSqliteDeferredTransactionSync(db, () => {
        // BEGIN DEFERRED has run, but no statement has read or written yet, so this commit is
        // outside the transaction's snapshot and does not conflict with its first write.
        other.exec("INSERT INTO entries VALUES ('other')");
        db.prepare("INSERT INTO entries VALUES ('deferred')").run();
      });
    } finally {
      other.close();
      db.close();
    }
    const reader = new DatabaseSync(file);
    try {
      expect(reader.prepare("SELECT id FROM entries ORDER BY id").all()).toEqual([
        { id: "a" },
        { id: "deferred" },
        { id: "other" },
      ]);
    } finally {
      reader.close();
    }
  });

  it("reports that a deferred transaction's elapsed time includes the wait for another writer", async () => {
    const file = createWalDatabase();
    const locked = new Int32Array(new SharedArrayBuffer(4));
    const gate = new Int32Array(new SharedArrayBuffer(4));
    const holder = new Worker(HOLDER_SOURCE, {
      eval: true,
      workerData: { file, locked, gate, holdMs: HOLD_MS },
    });
    const exited = once(holder, "exit");
    // Block until the holder owns the write lock, so the deferred write below must wait for it.
    Atomics.wait(locked, 0, 0, 5_000);

    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      const logger = { warn: vi.fn() };
      runSqliteDeferredTransactionSync(
        db,
        () => {
          db.prepare("INSERT INTO entries VALUES ('waited')").run();
        },
        { logger, operationLabel: "test.deferred-write", slowTransactionHoldMs: 0 },
      );

      const hold = logger.warn.mock.calls.find(
        ([message]) => message === "slow SQLite transaction hold",
      );
      expect(hold).toBeDefined();
      const fields = hold?.[1] as Record<string, unknown>;
      expect(fields).toMatchObject({
        elapsedIncludesLockWait: true,
        mode: "deferred",
        operation: "test.deferred-write",
      });
      // The write waited for the holder's remaining hold time, and that wait is inside elapsedMs.
      expect(fields.elapsedMs).toBeGreaterThanOrEqual(HOLD_MS / 2);
      // Deferred transactions do not report a separate lock wait or held time.
      expect(fields).not.toHaveProperty("lockWaitMs");
      expect(fields).not.toHaveProperty("heldMs");
    } finally {
      db.close();
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      await exited;
    }
    const reader = new DatabaseSync(file);
    try {
      expect(reader.prepare("SELECT id FROM entries ORDER BY id").all()).toEqual([
        { id: "a" },
        { id: "waited" },
      ]);
    } finally {
      reader.close();
    }
  });
});

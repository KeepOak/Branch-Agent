import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureSqliteReadOnlyWorkerScope } from "./sqlite-readonly-worker-context.js";
import { createSqliteReadOnlyWorkerSession } from "./sqlite-readonly-worker-session.js";
import {
  SQLITE_READONLY_HARD_MAX_SESSIONS,
  SQLITE_READONLY_MAX_LIVE_SESSIONS,
  SQLITE_READONLY_SLOT_WAIT_MS,
  SqliteReadOnlyWorkerBusyError,
  countLiveSqliteReadOnlyWorkerSessions,
  waitForSqliteReadOnlyWorkerSlot,
  createSqliteReadOnlyWorkerScope,
  runSqliteReadOnlyWorker,
} from "./sqlite-readonly-worker.js";

type Send = (message: unknown, callback: (error: Error | null) => void) => boolean;
class MockChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  send = vi.fn<Send>((_message, callback) => {
    callback(null);
    return true;
  });
  kill = vi.fn<(_signal?: NodeJS.Signals) => boolean>(() => true);
}
const mock = vi.hoisted(() => ({ spawn: vi.fn<(executable: string) => MockChild>() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mock.spawn,
}));

const sessions: Array<{ session: ReturnType<typeof createSqliteReadOnlyWorkerSession>; child: MockChild }> =
  [];

function createSession() {
  const child = new MockChild();
  mock.spawn.mockImplementationOnce(() => child);
  const session = createSqliteReadOnlyWorkerSession({
    env: {},
    cwd: "/fixture",
    transport: { kind: "native" },
    argv: ["--fixture-readonly-session"],
    retainLifetime: false,
    retainOnOperationError: true,
    requestArgs: (pathname, options) => [options.mode, pathname],
    readBudget: () => ({ timeoutMs: 60_000, size: "fixture" }),
    deadlineOwnedByCaller: () => true,
    timeoutError: () => new Error("fixture budget expired"),
    closeTimeoutMs: 60_000,
  });
  sessions.push({ session, child });
  return { session, child };
}

function busySession() {
  const entry = createSession();
  const read = entry.session.run("/fixture/busy.sqlite", { mode: "sync" });
  read.catch(() => undefined);
  return { ...entry, read };
}

function finish(child: MockChild) {
  child.emit("message", { id: requestId(child), result: { ok: true, location: "/x" } });
}

function requestId(child: MockChild): number {
  const request: unknown = child.send.mock.calls.at(-1)?.[0];
  if (!isRecord(request) || typeof request.id !== "number") {
    throw new Error("Expected a posted session request");
  }
  return request.id;
}

afterEach(async () => {
  for (const { session, child } of sessions.splice(0)) {
    const closing = session.close();
    child.emit("close", 0, null);
    await closing;
  }
  mock.spawn.mockReset();
});

describe("SQLite read-only worker baseline", () => {
  it("closes a scoped worker after the idle timeout", async () => {
    const child = new MockChild();
    mock.spawn.mockReturnValue(child);
    const scope = createSqliteReadOnlyWorkerScope({ idleTimeoutMs: 20 });
    try {
      const result = scope.run(() =>
        runSqliteReadOnlyWorker("/fixture/source.sqlite", { mode: "sync" }),
      );
      await vi.waitFor(() => {
        expect(child.send.mock.calls.length).toBeGreaterThan(0);
      });
      child.emit("message", {
        id: requestId(child),
        result: { ok: true, location: "/fixture/staged" },
      });
      await expect(result).resolves.toBe("/fixture/staged");
      expect(mock.spawn).toHaveBeenCalledOnce();
      await delay(40);
      expect(child.send).toHaveBeenCalledWith("close", expect.any(Function));
      child.emit("close", 0, null);
      await delay(0);
    } finally {
      await scope.close();
    }
  });

  it("evicts the least-recently-used idle session instead of throwing on the ninth", async () => {
    const created = [];
    for (let index = 0; index < SQLITE_READONLY_MAX_LIVE_SESSIONS; index += 1) {
      created.push(createSession());
    }
    // Touch the first session so the second becomes least recently used.
    const first = created[0];
    const read = first.session.run("/fixture/a.sqlite", { mode: "sync" });
    first.child.emit("message", {
      id: requestId(first.child),
      result: { ok: true, location: "/fixture/staged" },
    });
    await expect(read).resolves.toBe("/fixture/staged");
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(SQLITE_READONLY_MAX_LIVE_SESSIONS);

    expect(() => createSession()).not.toThrow();
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(SQLITE_READONLY_MAX_LIVE_SESSIONS);
    expect(created[1].child.send).toHaveBeenCalledWith("close", expect.any(Function));
    expect(created[1].session.isRetired()).toBe(true);
    expect(first.child.send).not.toHaveBeenCalledWith("close", expect.any(Function));
    expect(first.session.isRetired()).toBe(false);
  });

  it("admits an overflow session when all eight are busy and closes it right after use", async () => {
    for (let index = 0; index < SQLITE_READONLY_MAX_LIVE_SESSIONS; index += 1) {
      busySession();
    }
    const overflow = createSession();
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(SQLITE_READONLY_MAX_LIVE_SESSIONS + 1);
    const read = overflow.session.run("/fixture/overflow.sqlite", { mode: "sync" });
    finish(overflow.child);
    await expect(read).resolves.toBe("/x");
    await delay(0);
    // Never kept idle: close is requested as soon as the work finishes.
    expect(overflow.child.send).toHaveBeenCalledWith("close", expect.any(Function));
    expect(overflow.session.isRetired()).toBe(true);
    overflow.child.emit("close", 0, null);
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(SQLITE_READONLY_MAX_LIVE_SESSIONS);
  });

  it("never grows past the hard ceiling of sixteen sessions", () => {
    for (let index = 0; index < SQLITE_READONLY_HARD_MAX_SESSIONS; index += 1) {
      busySession();
    }
    expect(SQLITE_READONLY_HARD_MAX_SESSIONS).toBe(16);
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(16);
    expect(() => createSession()).toThrow(SqliteReadOnlyWorkerBusyError);
    expect(() => createSession()).toThrow(
      "Branch is busy finishing other work. Try again in a moment.",
    );
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(16);
  });

  it("waits for a slot at the ceiling and proceeds when one frees", async () => {
    const busy = [];
    for (let index = 0; index < SQLITE_READONLY_HARD_MAX_SESSIONS; index += 1) {
      busy.push(busySession());
    }
    let admitted = false;
    const waiting = waitForSqliteReadOnlyWorkerSlot().then(() => {
      admitted = true;
    });
    await delay(10);
    expect(admitted).toBe(false);
    // A pooled session finishing its read becomes idle and therefore evictable.
    finish(busy[0].child);
    await busy[0].read;
    await waiting;
    expect(admitted).toBe(true);
    expect(() => createSession()).not.toThrow();
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBeLessThanOrEqual(16);
  });

  it("fails the bounded wait with the plain busy error when no slot frees", async () => {
    for (let index = 0; index < SQLITE_READONLY_HARD_MAX_SESSIONS; index += 1) {
      busySession();
    }
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const waiting = waitForSqliteReadOnlyWorkerSlot();
      const outcome = expect(waiting).rejects.toThrow(
        "Branch is busy finishing other work. Try again in a moment.",
      );
      vi.advanceTimersByTime(SQLITE_READONLY_SLOT_WAIT_MS - 1);
      await Promise.resolve();
      vi.advanceTimersByTime(1);
      await outcome;
      await expect(waiting).rejects.toBeInstanceOf(SqliteReadOnlyWorkerBusyError);
    } finally {
      vi.useRealTimers();
    }
    expect(SQLITE_READONLY_SLOT_WAIT_MS).toBe(2_000);
    expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(16);
  });

  it("does not inherit an idle timer across captured scopes after owner retirement", async () => {
    const owner = createSqliteReadOnlyWorkerScope({ idleTimeoutMs: 20 });
    const run = owner.run(() => captureSqliteReadOnlyWorkerScope());
    await owner.close();
    expect(() => run(() => undefined)).toThrow("scope closed");
  });
});

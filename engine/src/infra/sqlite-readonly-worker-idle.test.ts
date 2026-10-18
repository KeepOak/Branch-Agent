import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureSqliteReadOnlyWorkerScope } from "./sqlite-readonly-worker-context.js";
import { createSqliteReadOnlyWorkerSession } from "./sqlite-readonly-worker-session.js";
import {
  SQLITE_READONLY_MAX_LIVE_SESSIONS,
  countLiveSqliteReadOnlyWorkerSessions,
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
    mock.spawn.mockReturnValueOnce(child);
    const scope = createSqliteReadOnlyWorkerScope({ idleTimeoutMs: 20 });
    try {
      const result = scope.run(() =>
        runSqliteReadOnlyWorker("/fixture/source.sqlite", { mode: "sync" }),
      );
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

  it("refuses a ninth live session so load cannot keep one worker per session", () => {
    const created = [];
    try {
      for (let index = 0; index < SQLITE_READONLY_MAX_LIVE_SESSIONS; index += 1) {
        created.push(createSession());
      }
      expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(SQLITE_READONLY_MAX_LIVE_SESSIONS);
      expect(() => createSession()).toThrow("SQLite read-only worker concurrency limit reached");
      expect(countLiveSqliteReadOnlyWorkerSessions()).toBe(SQLITE_READONLY_MAX_LIVE_SESSIONS);
    } finally {
      for (const { child } of created) {
        child.emit("close", 0, null);
      }
    }
  });

  it("does not inherit an idle timer across captured scopes after owner retirement", async () => {
    const owner = createSqliteReadOnlyWorkerScope({ idleTimeoutMs: 20 });
    const run = owner.run(() => captureSqliteReadOnlyWorkerScope());
    await owner.close();
    expect(() => run(() => undefined)).toThrow("scope closed");
  });
});

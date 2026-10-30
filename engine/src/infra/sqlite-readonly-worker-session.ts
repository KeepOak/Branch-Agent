import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { serialize } from "node:v8";
import { sliceUtf16Safe } from "@branch/normalization-core/utf16-slice";
import { BrokerChild } from "../process/spawn-broker/child.js";
import type { SpawnBrokerHost } from "../process/spawn-broker/host.js";
import { recordChildProcessSpawn } from "../process/spawn-diagnostics.js";
import { hiddenWindowsOptions } from "../process/windows-hidden-options.js";
import { createDeferredCore } from "../shared/deferred.js";
import { runInDetachedAsyncContext } from "../shared/detached-async-context.js";
import type { RuntimeWorkerGeneration } from "./runtime-worker-generation.js";
import { tryProcessCwd } from "./safe-cwd.js";
import {
  createSqliteAuthTransferReceiver,
  createSqliteOperationTransferReceiver,
} from "./sqlite-readonly-auth-transfer.js";
import { retainSnapshotWork } from "./sqlite-readonly-location-cleanup.js";
import {
  createSqliteReadOnlyWorkerError,
  isSqliteReadOnlyWorkerResult,
  isSqliteSnapshotStagingMode,
  readSqliteReadOnlyWorkerValue,
  SQLITE_READONLY_STDERR_TAIL_CHARS,
  SQLITE_READONLY_WORKER_MAX_BUFFER,
  type SqliteReadOnlyWorkerMode,
  type SqliteReadOnlyWorkerOptions,
  type SqliteReadOnlyWorkerValue,
} from "./sqlite-readonly-worker-protocol.js";

export type SqliteReadOnlyWorkerLaunch = {
  runtimeGeneration?: RuntimeWorkerGeneration;
  env: NodeJS.ProcessEnv;
  cwd: string;
  transport: { kind: "native" } | { kind: "broker"; owner: SpawnBrokerHost };
};

/**
 * Session pool policy:
 * - up to SQLITE_READONLY_MAX_LIVE_SESSIONS (8) sessions stay alive for reuse;
 * - past 8, the least-recently-used idle session is evicted first;
 * - when all are busy, overflow sessions are admitted up to
 *   SQLITE_READONLY_HARD_MAX_SESSIONS (16) total and close as soon as their work ends;
 * - a closing (evicted, overflow or failed) session keeps its slot until its child closes
 *   and any broker-owned native cleanup settles, so the 16 ceiling bounds real processes,
 *   not just pooled bookkeeping;
 * - at 16, async callers wait up to SQLITE_READONLY_SLOT_WAIT_MS for a slot
 *   (waitForSqliteReadOnlyWorkerSlot), then fail with SqliteReadOnlyWorkerBusyError.
 *   Each freed slot is reserved for exactly one waiter, first come first served.
 * Session construction itself stays synchronous: it admits or throws, never waits.
 */
export const SQLITE_READONLY_MAX_LIVE_SESSIONS = 8;
export const SQLITE_READONLY_HARD_MAX_SESSIONS = 16;
export const SQLITE_READONLY_SLOT_WAIT_MS = 2_000;
export const SQLITE_READONLY_WORKER_BUSY_MESSAGE =
  "Branch is busy finishing other work. Try again in a moment.";

/** Plain, user-safe error when the session pool stays full past the bounded wait. */
export class SqliteReadOnlyWorkerBusyError extends Error {
  readonly code = "SQLITE_READONLY_WORKER_BUSY";
  constructor() {
    super(SQLITE_READONLY_WORKER_BUSY_MESSAGE);
    this.name = "SqliteReadOnlyWorkerBusyError";
  }
}

/** One pool slot held for a single waiter until it creates its session. */
export type SqliteReadOnlyWorkerSlot = { readonly kind: "sqlite-readonly-worker-slot" };

type LiveSessionEntry = {
  lastUsed: number;
  idle: () => boolean;
  retiring: () => boolean;
  evict: () => void;
};
const liveSessions = new Map<object, LiveSessionEntry>();
let liveSessionClock = 0;
const reservedSlots = new Set<SqliteReadOnlyWorkerSlot>();
const slotWaiters: Array<(slot: SqliteReadOnlyWorkerSlot) => void> = [];

function occupiedSlots(): number {
  return liveSessions.size + reservedSlots.size;
}

function countActiveSessions(): number {
  let active = 0;
  for (const entry of liveSessions.values()) {
    if (!entry.retiring()) {
      active += 1;
    }
  }
  return active;
}

function countRetiringSessions(): number {
  return liveSessions.size - countActiveSessions();
}

function reserveSlot(): SqliteReadOnlyWorkerSlot {
  const slot: SqliteReadOnlyWorkerSlot = { kind: "sqlite-readonly-worker-slot" };
  reservedSlots.add(slot);
  // The holder creates its session in the same turn; an unused hold lapses after it.
  // The timer runs context-free so it never retains the reserving caller's async state.
  runInDetachedAsyncContext(() =>
    setTimeout(() => {
      if (reservedSlots.delete(slot)) {
        notifySlotWaiters();
      }
    }, 0),
  ).unref();
  return slot;
}

function notifySlotWaiters(): void {
  while (slotWaiters.length > 0 && occupiedSlots() < SQLITE_READONLY_HARD_MAX_SESSIONS) {
    slotWaiters.shift()?.(reserveSlot());
  }
  // Start closing idle sessions for waiters that no in-flight close will serve.
  let uncovered = slotWaiters.length - countRetiringSessions();
  while (uncovered > 0 && evictLeastRecentlyUsedIdleSession()) {
    uncovered -= 1;
  }
}

/** True when a new session could be admitted right now without exceeding the ceiling. */
export function hasSqliteReadOnlyWorkerSlot(): boolean {
  return occupiedSlots() < SQLITE_READONLY_HARD_MAX_SESSIONS;
}

/**
 * Resolve with a reserved slot once a session can be admitted, waiting at most waitMs.
 * Callers must pass the slot to the session they create synchronously right after this
 * resolves (no await in between); an unused slot is released after that turn.
 */
export function waitForSqliteReadOnlyWorkerSlot(
  signal?: AbortSignal,
  waitMs: number = SQLITE_READONLY_SLOT_WAIT_MS,
): Promise<SqliteReadOnlyWorkerSlot> {
  if (slotWaiters.length === 0 && hasSqliteReadOnlyWorkerSlot()) {
    return Promise.resolve(reserveSlot());
  }
  return new Promise<SqliteReadOnlyWorkerSlot>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const grant = (slot: SqliteReadOnlyWorkerSlot) => {
      cleanup();
      resolve(slot);
    };
    const fail = (error: unknown) => {
      const index = slotWaiters.indexOf(grant);
      if (index < 0) {
        return;
      }
      slotWaiters.splice(index, 1);
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(signal?.reason);
    const timer = setTimeout(() => fail(new SqliteReadOnlyWorkerBusyError()), waitMs);
    slotWaiters.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    notifySlotWaiters();
  });
}

function admitSqliteReadOnlyWorkerSession(slot?: SqliteReadOnlyWorkerSlot): "pooled" | "overflow" {
  const reserved = slot !== undefined && reservedSlots.delete(slot);
  if (!reserved && occupiedSlots() >= SQLITE_READONLY_HARD_MAX_SESSIONS) {
    // Start closing an idle session so a bounded waiter can take its slot soon.
    evictLeastRecentlyUsedIdleSession();
    throw new SqliteReadOnlyWorkerBusyError();
  }
  while (
    countActiveSessions() >= SQLITE_READONLY_MAX_LIVE_SESSIONS &&
    evictLeastRecentlyUsedIdleSession()
  ) {
    // Evict idle sessions until a pooled slot frees or only busy sessions remain.
  }
  return countActiveSessions() < SQLITE_READONLY_MAX_LIVE_SESSIONS ? "pooled" : "overflow";
}

function evictLeastRecentlyUsedIdleSession(): boolean {
  let victim: LiveSessionEntry | undefined;
  for (const entry of liveSessions.values()) {
    if (entry.idle() && (!victim || entry.lastUsed < victim.lastUsed)) {
      victim = entry;
    }
  }
  if (!victim) {
    return false;
  }
  // The evicted session keeps its slot until its child closes; close() retires it now.
  victim.evict();
  return true;
}

/** Sessions holding a slot, including ones still closing. */
export function countLiveSqliteReadOnlyWorkerSessions(): number {
  return liveSessions.size;
}

export function isSameSqliteReadOnlyWorkerLaunch(
  captured: SqliteReadOnlyWorkerLaunch,
  requested: SqliteReadOnlyWorkerLaunch,
): boolean {
  const keys = Object.keys(requested.env);
  return (
    captured.runtimeGeneration === requested.runtimeGeneration &&
    captured.transport.kind === requested.transport.kind &&
    (captured.transport.kind === "native" ||
      (requested.transport.kind === "broker" &&
        captured.transport.owner === requested.transport.owner)) &&
    requested.cwd === captured.cwd &&
    keys.length === Object.keys(captured.env).length &&
    keys.every((key) => requested.env[key] === captured.env[key])
  );
}

type SqliteReadOnlyWorkerSession = {
  readonly closed: Promise<void>;
  readonly notStarted: boolean;
  /** Pass a slot from waitForSqliteReadOnlyWorkerSlot; the refused session already freed its own. */
  createNativeReplacement: (slot: SqliteReadOnlyWorkerSlot) => SqliteReadOnlyWorkerSession;
  isRetired: () => boolean;
  compatible: (launch: SqliteReadOnlyWorkerLaunch) => boolean;
  run: (
    pathname: string,
    options: SqliteReadOnlyWorkerOptions,
  ) => Promise<SqliteReadOnlyWorkerValue>;
  close: () => Promise<void>;
};

export function createSqliteReadOnlyWorkerSession(
  host: SqliteReadOnlyWorkerLaunch & {
    retainLifetime?: boolean;
    retainOnOperationError?: boolean;
    argv: string[];
    requestArgs: (pathname: string, options: SqliteReadOnlyWorkerOptions) => string[];
    readBudget: (pathname: string) => { timeoutMs: number; size: string };
    deadlineOwnedByCaller: () => boolean;
    timeoutError: (pathname: string, timeoutMs: number, size: string) => Error;
    closeTimeoutMs: number;
    /** Slot reserved by waitForSqliteReadOnlyWorkerSlot for this session. */
    slot?: SqliteReadOnlyWorkerSlot;
  },
): SqliteReadOnlyWorkerSession {
  const env = { ...host.env };
  const cwd = host.cwd;
  const executable = process.execPath;
  const transport: SqliteReadOnlyWorkerLaunch["transport"] =
    host.transport.kind === "broker"
      ? { kind: "broker", owner: host.transport.owner }
      : { kind: "native" };
  const capturedLaunch = { env, cwd, transport, runtimeGeneration: host.runtimeGeneration };
  // Synchronous admission: evict, overflow, or throw the plain busy error at the ceiling.
  const overflow = admitSqliteReadOnlyWorkerSession(host.slot) === "overflow";
  const argv = [...host.argv];
  const spawnOptions: SpawnOptions = hiddenWindowsOptions({
    env,
    // Inheriting the current directory avoids a redundant chdir that can fail under sudo -u.
    ...(transport.kind === "native" && cwd === tryProcessCwd() ? {} : { cwd }),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const child: ChildProcess =
    transport.kind === "broker"
      ? transport.owner.spawn(executable, argv, spawnOptions)
      : spawn(executable, argv, spawnOptions);
  recordChildProcessSpawn(executable, child);
  const liveEntry: LiveSessionEntry = {
    lastUsed: ++liveSessionClock,
    idle: () => !retired && pending === undefined,
    retiring: () => retired,
    evict: () => {
      void session.close().catch(() => undefined);
    },
  };
  liveSessions.set(child, liveEntry);
  let retired = false;
  let sequence = 0;
  let pendingOperation: Promise<SqliteReadOnlyWorkerValue> | undefined;
  let stderr = "";
  let outputBytes = 0;
  let pending:
    | {
        id: number;
        mode: SqliteReadOnlyWorkerMode;
        resolve: (value: SqliteReadOnlyWorkerValue) => void;
        reject: (error: unknown) => void;
        cleanup: () => void;
        failure?: unknown;
        transfer?:
          | ReturnType<typeof createSqliteAuthTransferReceiver>
          | ReturnType<typeof createSqliteOperationTransferReceiver>;
      }
    | undefined;
  const { promise: closeSignal, resolve: resolveClosed } = createDeferredCore();
  // A brokered proxy that closes without an observed exit (broker loss) leaves the native
  // child to broker-owned cleanup, retained later in the same turn as proxy close.
  const awaitsBrokerCleanup = () =>
    transport.kind === "broker" &&
    child instanceof BrokerChild &&
    !child.notStarted &&
    child.exitCode === null &&
    child.signalCode === null;
  const closed = closeSignal.then(() =>
    transport.kind === "broker" && awaitsBrokerCleanup()
      ? transport.owner.waitForCleanup()
      : undefined,
  );
  // The slot follows the full close, cleanup included, so the ceiling bounds real
  // processes. A child that exited (every native child) frees it on its close event.
  const releaseSlot = () => {
    if (liveSessions.delete(child)) {
      notifySlotWaiters();
    }
  };
  child.once("close", () => {
    if (!awaitsBrokerCleanup()) {
      releaseSlot();
    }
  });
  void closed.then(releaseSlot, releaseSlot);
  const retire = (error?: unknown) => {
    retired = true;
    if (pending && error !== undefined) {
      pending.failure ??= error;
    }
    child.kill("SIGKILL");
  };
  if (host.retainLifetime !== false) {
    void retainSnapshotWork(closed, () => retire(new Error("SQLite snapshot owner stopped")));
  }
  let spawned = false;
  let nativeClosed = false;
  child.once("spawn", () => {
    spawned = true;
  });
  child.on("error", (error: NodeJS.ErrnoException) =>
    retire(
      spawned
        ? error
        : Object.assign(
            new Error(
              [
                ["EACCES", "ENOENT", "EPERM"].includes(error.code ?? "")
                  ? `SQLite read-only worker runtime binary not executable: ${executable} (${error.code}, cwd ${cwd}). Check runtime execute permissions and access to the working directory`
                  : `SQLite read-only worker failed to start (executable ${executable}, cwd ${cwd})`,
                error.message,
              ].join(": "),
              { cause: error },
            ),
            { code: error.code },
          ),
    ),
  );
  child.once("close", (code, signal) => {
    nativeClosed = true;
    retired = true;
    if (pending) {
      const request = pending;
      pending = undefined;
      pendingOperation = undefined;
      request.cleanup();
      request.reject(
        request.failure ??
          createSqliteReadOnlyWorkerError(
            `exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
            stderr,
          ),
      );
    }
    resolveClosed();
  });
  const captureOutput = (data: Buffer, isStderr: boolean) => {
    outputBytes += data.length;
    if (isStderr) {
      stderr = sliceUtf16Safe(stderr + data.toString("utf8"), -SQLITE_READONLY_STDERR_TAIL_CHARS);
    }
    if (outputBytes > SQLITE_READONLY_WORKER_MAX_BUFFER) {
      retire(createSqliteReadOnlyWorkerError("exceeded its output buffer", stderr));
    }
  };
  const attachOutput = () => {
    child.stdout?.on("data", (data: Buffer) => captureOutput(data, false));
    child.stderr?.on("data", (data: Buffer) => captureOutput(data, true));
  };
  // The broker publishes IPC connectivity and transferred pipes asynchronously.
  const ready =
    child instanceof BrokerChild ? child.ready().then(attachOutput).catch(retire) : undefined;
  if (!ready) {
    attachOutput();
  }
  child.on("message", (message: unknown) => {
    if (retired) {
      return;
    }
    if (
      !pending ||
      !message ||
      typeof message !== "object" ||
      Object.keys(message).length !== 2 ||
      !("id" in message) ||
      message.id !== pending.id ||
      !("result" in message)
    ) {
      retire(createSqliteReadOnlyWorkerError("returned an unexpected response", stderr));
      return;
    }
    try {
      let value: SqliteReadOnlyWorkerValue;
      if (
        pending.transfer &&
        !(
          typeof message.result === "object" &&
          message.result !== null &&
          "ok" in message.result &&
          message.result.ok === false
        )
      ) {
        const reply = pending.transfer.accept(message.result);
        if ("request" in reply) {
          child.send({ id: pending.id, transfer: reply.request }, (error) => {
            if (error) {
              retire(error);
            }
          });
          return;
        }
        value = reply.value;
      } else {
        value = readSqliteReadOnlyWorkerValue(
          { stdout: JSON.stringify(message.result), stderr },
          pending.mode,
        );
      }
      const request = pending;
      pending = undefined;
      pendingOperation = undefined;
      request.cleanup();
      request.resolve(value);
    } catch (error) {
      if (
        pending &&
        host.retainOnOperationError &&
        isSqliteSnapshotStagingMode(pending.mode) &&
        isSqliteReadOnlyWorkerResult(message.result) &&
        !message.result.ok
      ) {
        const request = pending;
        pending = undefined;
        pendingOperation = undefined;
        request.cleanup();
        request.reject(error);
        return;
      }
      // A failed native close can retain a source lease. Do not reject the
      // request (and let its staging directory disappear) until process close.
      retire(error);
    }
  });
  const session: SqliteReadOnlyWorkerSession = {
    closed,
    isRetired() {
      return retired;
    },
    get notStarted() {
      return child instanceof BrokerChild ? child.notStarted : nativeClosed && !spawned;
    },
    createNativeReplacement(slot: SqliteReadOnlyWorkerSlot) {
      return runInDetachedAsyncContext(() =>
        createSqliteReadOnlyWorkerSession({
          ...host,
          slot,
          env,
          cwd,
          argv,
          transport: { kind: "native" },
        }),
      );
    },
    compatible(launch: SqliteReadOnlyWorkerLaunch) {
      return !retired && isSameSqliteReadOnlyWorkerLaunch(capturedLaunch, launch);
    },
    run(pathname: string, options: SqliteReadOnlyWorkerOptions) {
      if (retired) {
        return Promise.reject(new Error("SQLite read-only worker is closed"));
      }
      liveEntry.lastUsed = ++liveSessionClock;
      const operation = new Promise<SqliteReadOnlyWorkerValue>((resolve, reject) => {
        const { timeoutMs, size } = host.readBudget(pathname);
        stderr = "";
        outputBytes = 0;
        const abort = () => retire(options.signal?.reason);
        const timer = host.deadlineOwnedByCaller()
          ? undefined
          : setTimeout(() => retire(host.timeoutError(pathname, timeoutMs, size)), timeoutMs);
        const id = ++sequence;
        pending = {
          id,
          mode: options.mode,
          ...(options.mode === "auth-profile-rows"
            ? { transfer: createSqliteAuthTransferReceiver() }
            : options.mode === "operation"
              ? { transfer: createSqliteOperationTransferReceiver(options.command.type) }
              : {}),
          resolve,
          reject,
          cleanup: () => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
          },
        };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) {
          abort();
          return;
        }
        const send = () => {
          if (retired) {
            return;
          }
          try {
            const request = {
              id,
              args: host.requestArgs(pathname, options),
              ...(options.mode === "auth-profile-rows"
                ? {
                    auth: {
                      expectedIdentity: options.expectedIdentity,
                    },
                  }
                : options.mode === "operation"
                  ? {
                      operation: {
                        expectedIdentity: options.expectedIdentity,
                        command: serialize(options.command).toString("base64"),
                      },
                    }
                  : {}),
            };
            if (
              options.mode === "operation" &&
              Buffer.byteLength(JSON.stringify(request)) > SQLITE_READONLY_WORKER_MAX_BUFFER
            ) {
              throw new Error("SQLite read-only operation exceeded its request buffer");
            }
            child.send(request, (error) => {
              if (error) {
                retire(error);
              }
            });
          } catch (error) {
            retire(error);
          }
        };
        if (ready) {
          void ready.then(send);
        } else {
          send();
        }
      });
      pendingOperation = operation;
      const afterRun = () => {
        // Overflow sessions are never kept idle; pooled ones become evictable.
        if (overflow && !retired) {
          void session.close().catch(() => undefined);
        }
        notifySlotWaiters();
      };
      void operation.then(afterRun, afterRun);
      return operation;
    },
    async close() {
      if (retired) {
        await closed;
        return;
      }
      retired = true;
      // An idle child may flush Node's compile cache before exiting. Retain the
      // inspection budget as a ceiling if shutdown does not finish normally.
      const timer = setTimeout(() => retire(), host.closeTimeoutMs);
      try {
        // Child-owned disconnect preserves Node's process-and-pipes close event.
        child.send("close", (error) => {
          if (error) {
            retire(error);
          }
        });
      } catch (error) {
        retire(error);
      }
      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
  host.runtimeGeneration?.retain(session, async () => {
    await pendingOperation?.catch(() => undefined);
    return () => session.close();
  });
  return session;
}

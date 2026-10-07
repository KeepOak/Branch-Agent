import fs from "node:fs";
import {
  MessageChannel,
  type MessagePort,
  receiveMessageOnPort,
  type Worker,
} from "node:worker_threads";
import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { runInDetachedAsyncContext } from "../shared/detached-async-context.js";
import { GATEWAY_OWNER_HEARTBEAT_MS } from "./gateway-lock-payload.js";
import type { GatewayStateOwnerHeartbeatData } from "./gateway-state-owner-heartbeat.runtime.js";
import { runtimeProcessEntrypoints } from "./runtime-process-entrypoints.js";
import {
  resolveRuntimeWorkerThreadExecArgv,
  resolveRuntimeWorkerUrl,
} from "./runtime-worker-url.js";
import { createCpuTrackedWorker } from "./worker-cpu.js";

const monotonic = process.hrtime.bigint.bind(process.hrtime);
const DEFAULT_FAILURE_MS = 60_000;
const log = createSubsystemLogger("gateway/state");

type LockIdentity = { raw: string; dev: bigint; ino: bigint };

function readLockIdentity(lockPath: string, raw: string): LockIdentity {
  const stat = fs.statSync(lockPath, { bigint: true });
  return { raw, dev: stat.dev, ino: stat.ino };
}

/** The lock file is still the one this process wrote: same file (not removed and recreated) and same bytes. */
function renewIfStillOurs(lockPath: string, identity: LockIdentity): boolean {
  let fd: number;
  try {
    fd = fs.openSync(lockPath, "r+");
  } catch {
    return false;
  }
  try {
    const held = fs.fstatSync(fd, { bigint: true });
    const stat = fs.statSync(lockPath, { bigint: true });
    if (
      held.nlink === 0n ||
      held.dev !== stat.dev ||
      held.ino !== stat.ino ||
      held.dev !== identity.dev ||
      held.ino !== identity.ino
    )
      return false;
    const bytes = Buffer.alloc(Buffer.byteLength(identity.raw) + 1);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (bytes.subarray(0, length).toString("utf8") !== identity.raw) return false;
    const stamp = new Date();
    fs.futimesSync(fd, stamp, stamp);
    return true;
  } catch {
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

/** Process and schema owners share one renewal worker and one failure deadline. */
export function startGatewayStateOwnerHeartbeat(
  heldLocks: Iterable<{ lockPath: string; verifyStillHeld(): boolean }>,
  onLost: (error: Error) => void,
  options: { failureMs?: number } = {},
) {
  const failureMs = options.failureMs ?? DEFAULT_FAILURE_MS;
  // Every lock this heartbeat renews, as this process wrote it. The worker keeps its own copy.
  const identities = new Map<string, LockIdentity>();
  for (const lock of heldLocks) {
    identities.set(
      lock.lockPath,
      readLockIdentity(lock.lockPath, fs.readFileSync(lock.lockPath, "utf8")),
    );
    if (!lock.verifyStillHeld()) {
      throw new Error("Branch Agent state ownership is no longer current");
    }
  }
  const rootPath = identities.keys().next().value;
  return runInDetachedAsyncContext(() => {
    const lastBeat = new BigInt64Array(new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT));
    Atomics.store(lastBeat, 0, monotonic() / 1_000_000n);
    const url = resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.gatewayStateOwnerHeartbeat);
    let failure: string | null = null;
    let replaced = false;
    let lost = false;
    let worker!: Worker;
    let events!: MessagePort;
    const startWorker = () => {
      const { port1, port2 } = new MessageChannel();
      const locks = Object.fromEntries(
        [...identities].map(([lockPath, { raw }]) => [lockPath, raw]),
      );
      const started = createCpuTrackedWorker(url, {
        workerData: {
          locks,
          intervalMs: GATEWAY_OWNER_HEARTBEAT_MS,
          failureMs,
          lastBeat: lastBeat.buffer,
          events: port2,
        } satisfies GatewayStateOwnerHeartbeatData,
        transferList: [port2],
        execArgv: resolveRuntimeWorkerThreadExecArgv(url),
      });
      started.unref();
      port1.unref();
      started.on("error", (error) => {
        if (started === worker) failure = coerceErrorMessage(error);
      });
      worker = started;
      events = port1;
      port1.on("message", (message) => {
        if (events !== port1) return;
        recordEvent(message);
        if (replaced) inspect();
      });
    };
    startWorker();
    /**
     * The renewal deadline passed without a renewal error: the whole process stalled (a frozen VM, a suspended
     * process, a blocked disk), or the worker died. That alone is no loss. On one host a live owner's lock is
     * never taken over, and any rival would have replaced the file: when every lock still is the exact file
     * this process wrote, renew its verified open handle and keep going on a fresh worker. That handle cannot
     * touch a successor if the path is replaced during renewal. Admission's verifyStillHeld check detects any
     * replacement after this re-assertion, before more state work runs.
     */
    const reassert = (overdueMs: number): boolean => {
      for (const [lockPath, identity] of identities) {
        if (renewIfStillOurs(lockPath, identity)) continue;
        if (lockPath === rootPath) return false;
        // A projection that was released or replaced is not ours to renew, as the worker treats it.
        identities.delete(lockPath);
      }
      Atomics.store(lastBeat, 0, monotonic() / 1_000_000n);
      const stalled = worker;
      events.close();
      stalled.postMessage("stop", []);
      void stalled.terminate();
      startWorker();
      log.warn(
        `state ownership heartbeat was ${Math.round(overdueMs / 1000)}s late (the process stalled); ` +
          `the lock at ${rootPath} still names this process, so ownership continues`,
      );
      return true;
    };
    const recordEvent = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "lost" in message &&
        typeof message.lost === "string"
      ) {
        failure = message.lost;
        replaced = true;
      } else {
        failure = typeof message === "string" ? message : null;
      }
    };
    const inspect = () => {
      if (lost) return 0;
      // Drain diagnostics synchronously when native work resumes before port callbacks.
      let message;
      while ((message = receiveMessageOnPort(events))) {
        recordEvent(message.message);
      }
      const overdueMs = Number(monotonic() / 1_000_000n - Atomics.load(lastBeat, 0));
      let remaining = failureMs - overdueMs;
      if (replaced || remaining <= 0) {
        let kept = false;
        // A renewal that failed with an error (EIO, EACCES) is a real loss; only a late one is re-asserted.
        if (!failure && !replaced) {
          try {
            kept = reassert(overdueMs);
          } catch (error) {
            failure = `re-asserting the late heartbeat failed: ${coerceErrorMessage(error)}`;
          }
        }
        if (kept) {
          remaining = failureMs;
        } else {
          lost = true;
          onLost(
            new Error(
              `Gateway state ownership is no longer current at ${rootPath}: ${failure ?? "the lock was replaced while the heartbeat was late"}; restart the Gateway.`,
            ),
          );
          remaining = 0;
        }
      }
      return remaining;
    };
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const watch = () => {
      const remaining = inspect();
      if (remaining > 0 && !stopped) {
        timer = setTimeout(watch, remaining);
        timer.unref();
      }
    };
    watch();
    const paths = new Set(identities.keys());
    return {
      get worker() {
        return worker;
      },
      paths,
      inspect,
      /** Renews one more lock (a projection) from now on, through this and any later worker. */
      add(lockPath: string, raw: string) {
        identities.set(lockPath, readLockIdentity(lockPath, raw));
        paths.add(lockPath);
        worker.postMessage([lockPath, raw], []);
      },
      stop() {
        stopped = true;
        clearTimeout(timer);
        events.close();
        worker.postMessage("stop", []);
        void worker.terminate();
      },
    };
  });
}

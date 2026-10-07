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
function isStillOurs(lockPath: string, identity: LockIdentity): boolean {
  try {
    const stat = fs.statSync(lockPath, { bigint: true });
    return (
      stat.nlink > 0n &&
      stat.dev === identity.dev &&
      stat.ino === identity.ino &&
      // The raw bytes carry the pid, ownerId and the acquisition token: a rival's lock never matches.
      fs.readFileSync(lockPath, "utf8") === identity.raw
    );
  } catch {
    return false;
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
    };
    startWorker();
    /**
     * The renewal deadline passed without a renewal error: the whole process stalled (a frozen VM, a suspended
     * process, a blocked disk), or the worker died. That alone is no loss. On one host a live owner's lock is
     * never taken over, and any rival would have replaced the file: when every lock still is the exact file
     * this process wrote, renew it now and keep going on a fresh worker (the old one never renews again once
     * its deadline passed). The window after this check is the same one renewal always has, and the new
     * worker's first file check closes it.
     */
    const reassert = (overdueMs: number): boolean => {
      for (const [lockPath, identity] of identities) {
        if (isStillOurs(lockPath, identity)) continue;
        if (lockPath === rootPath) return false;
        // A projection that was released or replaced is not ours to renew, as the worker treats it.
        identities.delete(lockPath);
      }
      const stamp = new Date();
      for (const lockPath of identities.keys()) {
        fs.utimesSync(lockPath, stamp, stamp);
      }
      Atomics.store(lastBeat, 0, monotonic() / 1_000_000n);
      const stalled = worker;
      events.close();
      void stalled.terminate();
      startWorker();
      log.warn(
        `state ownership heartbeat was ${Math.round(overdueMs / 1000)}s late (the process stalled); ` +
          `the lock at ${rootPath} still names this process, so ownership continues`,
      );
      return true;
    };
    const inspect = () => {
      // Drain diagnostics synchronously when native work resumes before port callbacks.
      let message;
      while ((message = receiveMessageOnPort(events))) {
        failure = message.message;
      }
      const overdueMs = Number(monotonic() / 1_000_000n - Atomics.load(lastBeat, 0));
      let remaining = failureMs - overdueMs;
      if (remaining <= 0) {
        let kept = false;
        // A renewal that failed with an error (EIO, EACCES) is a real loss; only a late one is re-asserted.
        if (!failure) {
          try {
            kept = reassert(overdueMs);
          } catch (error) {
            failure = `re-asserting the late heartbeat failed: ${coerceErrorMessage(error)}`;
          }
        }
        if (kept) {
          remaining = failureMs;
        } else {
          onLost(
            new Error(
              `Gateway state ownership is no longer current at ${rootPath}: ${failure ?? "the lock was replaced while the heartbeat was late"}; restart the Gateway.`,
            ),
          );
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

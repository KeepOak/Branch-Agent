// Branch's child already has a readyz signal and its own process-tree stop; this
// supervisor owns only unexpected post-ready exits and their bounded restarts.
import type { ChildProcess } from "node:child_process";

export type GatewayRestartPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  stableAfterMs: number;
};

const DEFAULT_POLICY: GatewayRestartPolicy = {
  maxAttempts: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  stableAfterMs: 60_000,
};

type GatewayChild = Pick<ChildProcess, "pid" | "exitCode" | "signalCode" | "once">;

export function createGatewayCrashSupervisor(options: {
  current: () => GatewayChild | undefined;
  restart: () => Promise<void>;
  log: (message: string) => void;
  onExhausted?: (error: Error) => void;
  policy?: Partial<GatewayRestartPolicy>;
}) {
  const policy = { ...DEFAULT_POLICY, ...options.policy };
  const watched = new Map<GatewayChild, { ready: boolean; ended: boolean; expected: boolean }>();
  let attempts = 0;
  let closed = false;
  let recovering = false;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;

  const clearStableTimer = () => {
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = undefined;
  };

  const schedule = (error: Error) => {
    if (closed || restartTimer || recovering) return;
    if (attempts >= policy.maxAttempts) {
      const exhausted = new Error(`${error.message}; restart attempts exhausted (${policy.maxAttempts})`);
      options.log(exhausted.message);
      options.onExhausted?.(exhausted);
      return;
    }
    attempts += 1;
    const delayMs = Math.min(policy.initialDelayMs * 2 ** (attempts - 1), policy.maxDelayMs);
    options.log(`gateway restart attempt ${attempts}/${policy.maxAttempts} in ${delayMs}ms: ${error.message}`);
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (closed) return;
      recovering = true;
      void options.restart().then(
        () => { recovering = false; },
        (failure: unknown) => {
          recovering = false;
          schedule(failure instanceof Error ? failure : new Error(String(failure)));
        },
      );
    }, delayMs);
    restartTimer.unref?.();
  };

  const observe = (child: GatewayChild) => {
    const state = { ready: false, ended: false, expected: false };
    watched.set(child, state);
    const ended = (error: Error) => {
      if (state.ended) return;
      state.ended = true;
      watched.delete(child);
      if (options.current() === child) clearStableTimer();
      if (closed || state.expected || !state.ready || options.current() !== child) return;
      schedule(error);
    };
    child.once("exit", (code, signal) => ended(new Error(`gateway exited unexpectedly (${signal ?? code ?? "unknown"})`)));
    child.once("error", (error) => {
      // A failed initial spawn belongs to the caller's readiness/rollback path.
      // Post-ready process errors are followed by exit; do not start a second owner.
      if (!state.ready) ended(error);
    });
    return {
      ready: () => {
        state.ready = true;
        if (state.ended) {
          if (!state.expected && !closed && options.current() === child) schedule(new Error("gateway exited after readiness"));
          return;
        }
        if (attempts > 0) {
          clearStableTimer();
          stableTimer = setTimeout(() => {
            stableTimer = undefined;
            if (!closed && !state.ended && options.current() === child) {
              attempts = 0;
              options.log(`gateway restart budget reset after ${policy.stableAfterMs}ms stable`);
            }
          }, policy.stableAfterMs);
          stableTimer.unref?.();
        }
      },
    };
  };

  return {
    observe,
    /**
     * An engine that is not this app's child (the engine service) stopped answering: restart it through `restart`
     * with the same backoff and budget as a crashed child. A restart already pending or running absorbs it.
     */
    down: (error: Error) => {
      if (closed) return;
      clearStableTimer();
      schedule(error);
    },
    /** That engine answers again: like a ready child, the budget resets once it has stayed up for stableAfterMs. */
    up: () => {
      if (closed || attempts === 0 || stableTimer || restartTimer || recovering) return;
      stableTimer = setTimeout(() => {
        stableTimer = undefined;
        if (!closed && !restartTimer && !recovering) {
          attempts = 0;
          options.log(`gateway restart budget reset after ${policy.stableAfterMs}ms stable`);
        }
      }, policy.stableAfterMs);
      stableTimer.unref?.();
    },
    /** Nothing serves after a failed update: restart the last good build with a fresh bounded budget. */
    recover: (error: Error) => {
      if (closed) return;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = undefined;
      attempts = 0;
      schedule(error);
    },
    cancelPending: () => {
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = undefined;
    },
    expectExit: (child: GatewayChild) => {
      const state = watched.get(child);
      if (state) state.expected = true;
      return () => {
        if (!state) return;
        state.expected = false;
        if (state.ended && state.ready && !closed && options.current() === child) {
          schedule(new Error("gateway exited during an unsuccessful stop"));
        }
      };
    },
    close: () => {
      closed = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = undefined;
      clearStableTimer();
    },
    /** True once quit closed the supervisor: no restart is scheduled or started after that. */
    get closed() { return closed; },
  };
}

/**
 * The engine service is not this app's child, so its exit never reaches `observe`. This watch asks it on /readyz
 * every `intervalMs`; after `misses` checks in a row without an answer it reports the engine down, once, until it
 * answers again. While `paused` (an update restarting the service on purpose, or quit) nothing counts.
 */
export function createServiceEngineWatch(options: {
  probe: () => Promise<boolean>;
  paused: () => boolean;
  down: (error: Error) => void;
  up?: () => void;
  log: (message: string) => void;
  misses?: number;
  intervalMs?: number;
}) {
  const limit = options.misses ?? 3;
  let missed = 0;
  let checking = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = async (): Promise<void> => {
    if (stopped || checking) return;
    checking = true;
    try {
      if (options.paused()) { missed = 0; return; }
      const answered = await options.probe().catch(() => false);
      if (stopped || options.paused()) { missed = 0; return; }
      if (answered) {
        if (missed >= limit) options.log("engine service answers /readyz again");
        missed = 0;
        options.up?.();
        return;
      }
      missed += 1;
      if (missed === limit) {
        const error = new Error(`the engine service stopped answering /readyz (${limit} checks in a row)`);
        options.log(error.message);
        options.down(error);
      }
    } finally { checking = false; }
  };
  return {
    tick,
    start: () => {
      if (stopped || timer) return;
      timer = setInterval(() => { void tick(); }, options.intervalMs ?? 10_000);
      timer.unref?.();
    },
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

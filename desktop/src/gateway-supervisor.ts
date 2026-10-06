// Adapted from letta-ai/letta-code@3687ea51f6d1 src/channels/gateway-supervisor.ts.
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
  };
}

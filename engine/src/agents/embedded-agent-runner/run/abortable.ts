import {
  asPositiveFiniteNumber,
  clampTimerTimeoutMs,
} from "@branch/normalization-core/number-coercion";
import { toErrorObject } from "../../../infra/errors.js";

/** Marks AbortErrors produced by abortable() so provider aborts stay retryable. */
const BRANCH_ABORTABLE_WRAPPER = Symbol.for("branch.abortable.wrapper");

export function isBranchAbortableWrapper(err: unknown): boolean {
  return err !== null && typeof err === "object" && BRANCH_ABORTABLE_WRAPPER in err;
}

export function createAbortableError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  const err = new Error(
    reason instanceof Error ? reason.message : "aborted",
    reason ? { cause: reason } : undefined,
  );
  return Object.assign(err, { name: "AbortError", [BRANCH_ABORTABLE_WRAPPER]: true });
}

// Post-turn joins (pending subscription handlers, block-reply flush) ride
// delivery chains that can wedge; the default run budget is 48h, so an
// unbounded await there dead-ends the turn with no visible outcome. 120s
// matches the cloud llm-idle class: anything quiet longer is a stuck lane,
// not legitimate delivery work.
export const RUN_LIVENESS_JOIN_TIMEOUT_MS = 120_000;
/** Env override for the post-turn join deadline, in milliseconds (strict positive integer). */
export const RUN_LIVENESS_JOIN_TIMEOUT_ENV = "BRANCH_RUN_LIVENESS_JOIN_TIMEOUT_MS";

/**
 * Resolves the post-turn join deadline. An explicit per-call value wins, then the env
 * override, then the 120s default. Non-finite, zero or negative values fall back to the
 * next source, so NaN cannot fire the timer at once and Infinity cannot disable the bound.
 */
export function resolveRunLivenessJoinTimeoutMs(
  explicitMs?: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const explicit = asPositiveFiniteNumber(explicitMs);
  if (explicit !== undefined) {
    return clampTimerTimeoutMs(explicit) ?? RUN_LIVENESS_JOIN_TIMEOUT_MS;
  }
  const fromEnv = asPositiveFiniteNumber(Number(env[RUN_LIVENESS_JOIN_TIMEOUT_ENV]));
  if (fromEnv !== undefined) {
    return clampTimerTimeoutMs(fromEnv) ?? RUN_LIVENESS_JOIN_TIMEOUT_MS;
  }
  return RUN_LIVENESS_JOIN_TIMEOUT_MS;
}

type RunLivenessJoinCompletion = { finish: (() => void) | undefined };

// Keep pending promise reactions outside the caller's closure scope so clearing
// this completion releases the attempt even when delivery never settles.
function finishRunLivenessJoin(completion: RunLivenessJoinCompletion): void {
  completion.finish?.();
}

/**
 * Awaits post-turn work that must never dead-end the run: races the joined
 * promise against the run-abort signal and a liveness deadline. Timeout and
 * abort RESOLVE (timeout after `onTimeout`) instead of rejecting so settlement
 * still produces a visible terminal outcome; rejections also resolve because
 * the joined chains own their error logging.
 */
export function joinWithRunLivenessDeadline(input: {
  joinWork: () => Promise<void> | void;
  runAbortSignal?: AbortSignal;
  timeoutMs?: number;
  onTimeout: () => void;
}): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = (reason: "settled" | "timeout" | "abort") => {
      if (!completion.finish) {
        return;
      }
      completion.finish = undefined;
      clearTimeout(timer);
      input.runAbortSignal?.removeEventListener("abort", onAbort);
      if (reason === "timeout") {
        input.onTimeout();
      }
      resolve();
    };
    const completion: RunLivenessJoinCompletion = { finish: () => finish("settled") };
    const onSettled = finishRunLivenessJoin.bind(undefined, completion);
    const onAbort = () => finish("abort");
    const timer = setTimeout(
      () => finish("timeout"),
      resolveRunLivenessJoinTimeoutMs(input.timeoutMs),
    );
    timer.unref?.();
    if (input.runAbortSignal?.aborted) {
      finish("abort");
      return;
    }
    input.runAbortSignal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => input.joinWork())
      .then(onSettled, onSettled);
  });
}

/**
 * Races a promise against an AbortSignal while preserving normal promise
 * settlement. Abort wins immediately and rejected non-Error payloads are
 * normalized so callers can safely log/inspect them as Error objects.
 */
export function abortable<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  if (signal.aborted) {
    // The provider may already be running; cancellation still owns the result.
    void promise.catch(() => {});
    return Promise.reject(createAbortableError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(createAbortableError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(toErrorObject(err, "Non-Error rejection"));
      },
    );
  });
}

import { PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS } from "../../prepared-model-runtime-lease.js";
import { isPreparedModelRuntimePluginLifecycleFailure } from "../../prepared-model-runtime.errors.js";
import { log } from "../logger.js";

/**
 * Another Trunk's preparation can supersede this run's runtime while it is still being set up.
 * Until the first attempt starts no model request, tool, or transcript write has happened, so the
 * run may reacquire: the lease waits for the newer publication and the run continues on it.
 * The wait shares the lease's existing supersession budget.
 */
export function createSupersededSetupRetry(
  current: () => { runId: string; abortSignal?: AbortSignal },
) {
  let attemptStarted = false;
  let supersededSince: number | undefined;
  const markAttemptStarted = () => {
    attemptStarted = true;
  };
  const shouldRetry = (error: unknown): boolean => {
    supersededSince ??= Date.now();
    return (
      !attemptStarted &&
      !current().abortSignal?.aborted &&
      isPreparedModelRuntimePluginLifecycleFailure(error) &&
      Date.now() - supersededSince < PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS
    );
  };
  return {
    markAttemptStarted,
    /** A CLI backend owns its own attempt; never replay one that may have started. */
    failAttempt: (error: unknown): never => {
      markAttemptStarted();
      throw error;
    },
    /** Wraps the caller's attempt-start hook so a started attempt is never replayed. */
    observeAttemptStart: (onAttemptStart: (() => void) | undefined) => () => {
      markAttemptStarted();
      onAttemptStart?.();
    },
    run: async <T>(
      refresh: { run: (generation: () => Promise<T>) => Promise<T> },
      generation: () => Promise<T>,
      settled: () => Promise<void>,
    ): Promise<T> => {
      for (;;) {
        try {
          return await refresh.run(generation);
        } catch (error) {
          if (!shouldRetry(error)) {
            throw error;
          }
          log.info(
            `[prepared-runtime] run=${current().runId} runtime was replaced during setup; rejoining the current publication`,
          );
          // The superseded generation releases its lease before the next one is acquired.
          await settled();
        }
      }
    },
  };
}

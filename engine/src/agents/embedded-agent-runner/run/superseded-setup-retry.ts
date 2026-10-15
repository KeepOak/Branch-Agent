import { PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS } from "../../prepared-model-runtime-lease.js";
import { isPreparedModelRuntimePluginLifecycleFailure } from "../../prepared-model-runtime.errors.js";
import { registerPreparedModelRuntimePublicationListener } from "../../prepared-model-runtime.publication-events.js";
import { log } from "../logger.js";

/** First wait when no newer publication appeared; matches the lease's successor poll. */
export const SUPERSEDED_SETUP_RETRY_INITIAL_DELAY_MS = 250;
export const SUPERSEDED_SETUP_RETRY_MAX_DELAY_MS = 5_000;

type PublicationWatch = { wake?: () => void };

/**
 * Resolves on the next runtime publication, after `delayMs`, or on abort, whichever comes first.
 * Only a publication made while waiting counts: one made by the failed attempt itself does not.
 */
function waitForPublicationOrDelay(
  publications: PublicationWatch,
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      publications.wake = undefined;
      resolve();
    };
    const timer = setTimeout(done, delayMs);
    signal?.addEventListener("abort", done, { once: true });
    publications.wake = done;
  });
}

const retryCount = (retries: number) => `${retries} ${retries === 1 ? "retry" : "retries"}`;

/**
 * Another Trunk's preparation can supersede this run's runtime while it is still being set up.
 * Until the first attempt starts no model request, tool, or transcript write has happened, so the
 * run may reacquire: the lease waits for the newer publication and the run continues on it.
 * The wait shares the lease's existing supersession budget.
 *
 * The superseded generation can settle before any newer publication exists; retrying then fails
 * the same way at once. Each retry therefore waits for a newer publication or a backoff (250 ms,
 * doubling to 5 s). The run logs once when it starts waiting and once when it rejoins or stops.
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
      const publications: PublicationWatch = {};
      const unsubscribe = registerPreparedModelRuntimePublicationListener((event) => {
        if (event.phase === "published" || event.phase === "invalidated") {
          publications.wake?.();
        }
      });
      let retries = 0;
      let delayMs = SUPERSEDED_SETUP_RETRY_INITIAL_DELAY_MS;
      try {
        for (;;) {
          try {
            const result = await refresh.run(generation);
            if (retries > 0) {
              log.info(
                `[prepared-runtime] run=${current().runId} rejoined the current publication after ${retryCount(retries)}`,
              );
            }
            return result;
          } catch (error) {
            if (!shouldRetry(error)) {
              if (retries > 0) {
                log.info(
                  `[prepared-runtime] run=${current().runId} stopped waiting for a newer publication after ${retryCount(retries)}`,
                );
              }
              throw error;
            }
            if (retries === 0) {
              log.info(
                `[prepared-runtime] run=${current().runId} runtime was replaced during setup; waiting to rejoin the current publication`,
              );
            }
            retries += 1;
            // The superseded generation releases its lease before the next one is acquired.
            await settled();
            const remainingMs =
              PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS - (Date.now() - (supersededSince ?? 0));
            await waitForPublicationOrDelay(
              publications,
              Math.max(0, Math.min(delayMs, remainingMs)),
              current().abortSignal,
            );
            // Grows on every retry; only a publication made during the wait cuts a wait short.
            delayMs = Math.min(delayMs * 2, SUPERSEDED_SETUP_RETRY_MAX_DELAY_MS);
          }
        }
      } finally {
        unsubscribe();
      }
    },
  };
}

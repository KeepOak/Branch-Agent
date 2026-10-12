import { racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import {
  PreparedModelRuntimeOwnerNotPublishedError,
  type PreparedModelRuntimePublicationSupersededError,
} from "./prepared-model-runtime.errors.js";

const PREPARED_RUNTIME_NO_PROGRESS_MS = 120_000;
export const PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS = 600_000;

/** One budget belongs to the turn, not to an individual publication or admission attempt. */
export function createPreparedModelRuntimeAdmissionBudget(abortSignal?: AbortSignal) {
  const deadline = Date.now() + PREPARED_RUNTIME_SUPERSEDED_TOTAL_CAP_MS;
  let progressAt = Date.now();
  let superseded: PreparedModelRuntimePublicationSupersededError | undefined;
  const failure = () =>
    superseded ??
    new PreparedModelRuntimeOwnerNotPublishedError(
      "prepared model runtime lease admission made no publication progress",
      { admissionBlocked: true },
    );
  const remaining = () =>
    Math.min(deadline, progressAt + PREPARED_RUNTIME_NO_PROGRESS_MS) - Date.now();
  const assert = () => {
    if (remaining() <= 0) {
      throw failure();
    }
  };
  return {
    assert,
    progress: () => {
      // Progress renews only the idle bound. Re-admission never renews the total deadline.
      assert();
      progressAt = Date.now();
    },
    recordSuperseded: (error: PreparedModelRuntimePublicationSupersededError) => {
      superseded = error;
    },
    wait: async <T>(publication: Promise<T>): Promise<T> => {
      assert();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        const check = () => {
          const left = remaining();
          if (left <= 0) {
            reject(failure());
          } else {
            // A different publication may have made progress while this reader was waiting.
            timer = setTimeout(check, left);
          }
        };
        timer = setTimeout(check, remaining());
      });
      try {
        return await racePromiseWithAbortSignal(Promise.race([publication, timeout]), abortSignal);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export type PreparedModelRuntimeAdmissionBudget = ReturnType<
  typeof createPreparedModelRuntimeAdmissionBudget
>;

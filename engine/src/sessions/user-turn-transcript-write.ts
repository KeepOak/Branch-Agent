// How a user turn write finds its target, and tries again when a full worker queue refused it.
import { WorkerTaskError } from "../infra/worker-task-pool.js";
import type {
  UserTurnTranscriptTarget,
  UserTurnTranscriptTargetResolver,
} from "./user-turn-transcript.types.js";

export async function resolveUserTurnTranscriptTarget(
  target: UserTurnTranscriptTargetResolver,
): Promise<UserTurnTranscriptTarget | undefined> {
  return typeof target === "function" ? await target() : target;
}

/**
 * Waits before each new try of a user turn write that a full worker queue refused. The refusal comes before the
 * write runs, and the write is idempotent by message key, so trying again is safe.
 */
const OVERLOADED_WRITE_RETRY_MS = [250, 500, 1_000, 2_000];

function isWorkerQueueFull(error: unknown): boolean {
  return error instanceof WorkerTaskError && error.code === "overloaded";
}

/** Approved custody, or a write the worker queue refused (nothing was written), may be persisted again later. */
export function mayRetry(pendingInput: unknown, error: unknown): boolean {
  return Boolean(pendingInput) || isWorkerQueueFull(error);
}

/** Runs one user turn write, again while the worker queue refuses it, up to the waits above. */
export async function retryWrite<Params, Result>(
  write: (params: Params) => Promise<Result>,
  params: Params,
): Promise<Result> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await write(params);
    } catch (error) {
      const waitMs = OVERLOADED_WRITE_RETRY_MS[attempt];
      if (!isWorkerQueueFull(error) || waitMs === undefined) {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, waitMs);
      });
    }
  }
}

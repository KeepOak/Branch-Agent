import { hasErrnoCode } from "../infra/errors.js";
import { retryAsync } from "../infra/retry.js";

/** Retry only a Trash sharing failure, never a failed ownership or path recheck. */
export async function retryAgentDeleteTrashMove(options: {
  prepare: () => void | Promise<void>;
  move: () => Promise<void>;
}): Promise<void> {
  let trashFailure: unknown;
  await retryAsync(
    async () => {
      trashFailure = undefined;
      await options.prepare();
      try {
        await options.move();
      } catch (error) {
        trashFailure = error;
        throw error;
      }
    },
    {
      attempts: process.platform === "win32" ? 3 : 1,
      minDelayMs: 250,
      maxDelayMs: 5_000,
      shouldRetry: (error) =>
        error === trashFailure &&
        ["EPERM", "EBUSY", "EACCES"].some((code) => hasErrnoCode(error, code)),
    },
  );
}

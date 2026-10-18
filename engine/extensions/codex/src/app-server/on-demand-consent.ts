/**
 * The owner's yes before a first-use Codex download. Yes lets the fetch start.
 * Cancel rejects anyone waiting and fetches nothing.
 */

type ConsentWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

export type DownloadConsent = {
  allowed(): boolean;
  allow(): void;
  decline(): void;
  /** Drops a yes after the download settles, without rejecting a new waiter. */
  clear(): void;
  waiting(): boolean;
  wait(signal?: AbortSignal): Promise<void>;
};

export function createDownloadConsent(cancelled: () => Error): DownloadConsent {
  let allowed = false;
  let waiters: ConsentWaiter[] = [];

  return {
    allowed: () => allowed,
    allow() {
      allowed = true;
      const waiting = waiters;
      waiters = [];
      for (const waiter of waiting) {
        waiter.resolve();
      }
    },
    decline() {
      allowed = false;
      const waiting = waiters;
      waiters = [];
      const error = cancelled();
      for (const waiter of waiting) {
        waiter.reject(error);
      }
    },
    clear() {
      allowed = false;
    },
    waiting: () => waiters.length > 0,
    wait(signal) {
      if (allowed) {
        return Promise.resolve();
      }
      if (signal?.aborted) {
        return Promise.reject(cancelled());
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const entry: ConsentWaiter = {
          resolve: () => {
            if (settled) {
              return;
            }
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
          reject: (error) => {
            if (settled) {
              return;
            }
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            reject(error);
          },
        };
        const onAbort = () => {
          waiters = waiters.filter((waiter) => waiter !== entry);
          entry.reject(cancelled());
        };
        waiters.push(entry);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

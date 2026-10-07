/**
 * The desktop's one update lock. An in-place update, crash recovery, a staged-update replacement and Undo each hold
 * it for their whole run, so none of them starts against another. A holder that calls work which would otherwise
 * take the lock itself (Undo calling the in-place swap) passes its handle, and that work runs under the same hold.
 */
export interface UpdateLockHandle { readonly purpose: string }

export interface UpdateLock {
  /** True while anyone holds the lock. */
  readonly held: boolean;
  /** What the current holder is doing, for logs and for queueing an Update click behind a replacement. */
  readonly purpose: string | undefined;
  /** Takes the lock, or resolves undefined when it is already held: callers never wait for it. */
  acquire(purpose: string): UpdateLockHandle | undefined;
  /** True when `handle` is the current holder. */
  holds(handle: UpdateLockHandle | undefined): boolean;
  /** Releases `handle` if it still holds the lock, then runs the release hook; a stale or repeated release does nothing. */
  release(handle: UpdateLockHandle): Promise<void>;
}

export function createUpdateLock(afterRelease: (released: UpdateLockHandle) => void | Promise<void> = () => {}): UpdateLock {
  let holder: UpdateLockHandle | undefined;
  return {
    get held() { return holder !== undefined; },
    get purpose() { return holder?.purpose; },
    acquire(purpose) {
      if (holder) return undefined;
      holder = { purpose };
      return holder;
    },
    holds: handle => handle !== undefined && handle === holder,
    async release(handle) {
      if (handle !== holder) return;
      holder = undefined;
      await afterRelease(handle);
    },
  };
}

// Waits until no permission-style request (getUserMedia, Notification.requestPermission) is in flight
// in the crawled window, or until the cap. The page is reached only through the three functions passed in,
// so the wait can be tested without a browser.
export const REQUEST_WAIT_CAP_MS = 5000;
const POLL_MS = 20;

/**
 * Returns { timedOut, pending }. `frames(n)` resolves after n animation frames (with a time fallback),
 * `readPending()` returns the in-flight count, and `wait(ms)` pauses between reads.
 */
export async function waitForPermissionRequests({
  readPending,
  frames,
  wait,
  now = Date.now,
  capMs = REQUEST_WAIT_CAP_MS,
}) {
  // One frame first, so the click's handler has started any request before the first read.
  await frames(1);
  const started = now();
  for (;;) {
    const pending = await readPending();
    if (pending === 0) {
      // Two frames: a request's result reaches React after it settles, and a frame commits it.
      await frames(2);
      return { timedOut: false, pending: 0 };
    }
    if (now() - started > capMs) return { timedOut: true, pending };
    await wait(POLL_MS);
  }
}

// A settings read that never answers must not spin forever. Each read starts a timer; if no answer has come by then
// and nothing is shown yet, the read reports a plain failure that offers Try again. An answer that arrives later still
// replaces that failure, because the read keeps waiting; the timer only changes what is shown while it waits.

/** How long a read may wait before it says it did not answer. The live engine answers in a few seconds. */
export const STALL_MS = 15_000;

/** The plain line a stalled read shows. Read by people, so it names no method or engine detail. */
export const STALL_TEXT = "Branch didn’t answer in time.";

/** Calls `onStall` once if the read is still open after `ms`. Returns the function that stops the timer. */
export function stallAfter(onStall: () => void, ms = STALL_MS): () => void {
  const timer = setTimeout(onStall, ms);
  return () => clearTimeout(timer);
}

/** The read as a promise that rejects with the stall line if it has no answer by `ms`. A late answer is ignored here,
 *  because the caller has already moved on; use it where one unanswered read must not hold up the rest. */
export function stalledRead<T>(read: Promise<T>, ms = STALL_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = stallAfter(() => reject(new Error(STALL_TEXT)), ms);
    read.then((value) => { stop(); resolve(value); }, (error: unknown) => { stop(); reject(error); });
  });
}

/** Runs `run` once, `ms` after the first call in a burst; later calls in that window join it. Unlike a debounce it still
 *  runs during a steady stream of events (a working Trunk sends contacts.changed about once a second). `cancel` drops a
 *  pending run. */
export function coalesce(run: () => void, ms: number): { (): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const call = () => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; run(); }, ms);
  };
  return Object.assign(call, { cancel: () => { if (timer) clearTimeout(timer); timer = null; } });
}

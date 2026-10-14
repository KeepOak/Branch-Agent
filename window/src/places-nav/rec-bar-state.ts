// The recommendation bar's dismissals (preview recBar): "Not now" hides a question until tomorrow, "Don't ask again"
// for good. Per-viewer memory in localStorage. If storage is blocked the question simply comes back, which is the safe side.
export type RecKind = "gateway" | "update";

const NEVER = "never";
const keyOf = (kind: RecKind) => `branch.recBar.${kind}`;

/** Local midnight after `now`: the moment "Not now" answers until. */
export function tomorrowAt(now: Date): number {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

/** True while the question is dismissed: for good, or until a moment still ahead. */
export function isDismissed(kind: RecKind, now = Date.now()): boolean {
  let raw: string | null = null;
  try { raw = localStorage.getItem(keyOf(kind)); } catch { return false; }
  if (raw === NEVER) return true;
  const until = Number(raw);
  return raw !== null && Number.isFinite(until) && until > now;
}

export function dismiss(kind: RecKind, how: "later" | "never", now = Date.now()): void {
  const value = how === "never" ? NEVER : String(tomorrowAt(new Date(now)));
  try { localStorage.setItem(keyOf(kind), value); } catch { /* storage blocked: the question asks again */ }
}

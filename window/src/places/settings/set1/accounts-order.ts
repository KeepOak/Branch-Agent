// Settings › Accounts: the order and pause rules as plain functions. An account moves only within its own provider, and
// a paused account stays signed in but is skipped in the order. The engine applies the skip (models.authPauseSet).
import type { Account } from "./accounts";

export type MoveTo = "up" | "down" | "top" | "bottom";
export type PauseChoice = "hour" | "tomorrow" | "indefinite";
export type Pause = { until?: number };

const HOUR_MS = 60 * 60 * 1000;

/** The provider's account ids with the item at `from` placed at `to`. Other accounts keep their order. */
export function reorderedIds(ids: string[], from: number, to: number): string[] {
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return [...ids];
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The provider's ids after moving one account. Up and down move one place; top and bottom move to the ends. */
export function orderAfterMove(acc: Account, all: Account[], to: MoveTo): string[] {
  const ids = all.filter((x) => x.p === acc.p).map((x) => x.a.profileId);
  const from = ids.indexOf(acc.a.profileId);
  const target = to === "top" ? 0 : to === "bottom" ? ids.length - 1 : to === "up" ? from - 1 : from + 1;
  return reorderedIds(ids, from, target);
}

/** The provider's ids after a drag: the dragged account lands where the drop happened. */
export function orderAfterDrop(all: Account[], provider: Account["p"], fromId: string, toId: string): string[] {
  const ids = all.filter((x) => x.p === provider).map((x) => x.a.profileId);
  return reorderedIds(ids, ids.indexOf(fromId), ids.indexOf(toId));
}

/** When a pause ends, in ms since the epoch (local time). Undefined means until the owner turns it back on. */
export function pauseEnd(choice: PauseChoice, now: Date): number | undefined {
  if (choice === "indefinite") return undefined;
  if (choice === "hour") return now.getTime() + HOUR_MS;
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}

/** True while a pause holds: an open pause, or a timed one before its end. */
export function isPausedNow(pause: Pause | undefined, now = Date.now()): boolean {
  return pause !== undefined && (pause.until === undefined || pause.until > now);
}

/** The short line that goes with the Paused badge. */
export function pauseLabel(pause: Pause | undefined, now = Date.now()): string {
  if (!isPausedNow(pause, now) || !pause) return "";
  if (pause.until === undefined) return "Paused until you turn it back on";
  return `Paused until ${new Date(pause.until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

/** How many accounts of this account's provider Branch may still use (not paused). */
export function usableCountFor(acc: Account, all: Account[], now = Date.now()): number {
  return all.filter((x) => x.p === acc.p && !isPausedNow(x.a.paused, now)).length;
}

// Freedom Mode (owner item 6): the sidebar and the threads column resize freely. The rules are the preview's (preview.html
// 44137-44300): a rail of 68 px at the smallest, each side at most 45% of the window while the chat keeps 420 px, a drag below
// 40 px closes a side, below 180 px it becomes the rail, and widths persist (try/catch) with "Reset widths" to put them back.
import { useSyncExternalStore } from "react";

export const RAIL_W = 68;
/** The threads column folds to this narrowest width (the preview's rail for threads is 64). */
export const TOPICS_MIN = 64;
export const CHAT_MIN = 420;
export const STEP = 80;
const STORAGE_KEY = "branch.r1.free";
const CLOSE_BELOW = 40;
const RAIL_BELOW = 180;

export type FreeState = {
  side: number; sideRail: boolean; sideHidden: boolean; lastSide: number;
  topics: number; lastTopics: number;
  /** The edge the person touched last: ⌘[ and ⌘] act on it. */
  last: "side" | "topics";
};

export const FREE_DEFAULT: FreeState = { side: 292, sideRail: false, sideHidden: false, lastSide: 292, topics: 300, lastTopics: 300, last: "topics" };

/** The sidebar's width on screen: 0 when closed, the rail, or its wide width. */
export const sideNow = (s: FreeState) => (s.sideHidden ? 0 : s.sideRail ? RAIL_W : s.side);

export function maxSide(app: number, topics: number): number {
  return Math.max(64, Math.min(app * 0.45, app - topics - CHAT_MIN));
}
export function maxTopics(app: number, side: number): number {
  return Math.max(64, Math.min(app * 0.45, app - side - CHAT_MIN));
}

/** The content tier of a width: 1 shows the face and dot, 4 shows three lines and the meta. */
export const sideTier = (w: number) => (w < 180 ? 1 : w < 260 ? 2 : w < 380 ? 3 : 4);
export const topicsTier = (w: number) => (w < 120 ? 1 : w < 220 ? 2 : w < 340 ? 3 : 4);

/** A sidebar drag's end: below 40 it closes, below 180 it becomes the rail, else it is the wide width (kept within the maximum). */
export function commitSide(s: FreeState, width: number, app: number): FreeState {
  if (width < CLOSE_BELOW) return { ...s, sideHidden: true };
  if (width < RAIL_BELOW) return { ...s, sideHidden: false, sideRail: true };
  return { ...s, sideHidden: false, sideRail: false, side: Math.round(Math.min(width, maxSide(app, s.topics))) };
}

/** A threads drag's end: below 40 it closes (0), otherwise it is kept between 64 and its maximum. */
export function commitTopics(s: FreeState, width: number, app: number): FreeState {
  if (width < CLOSE_BELOW) return { ...s, topics: 0 };
  return { ...s, topics: Math.round(Math.max(64, Math.min(width, maxTopics(app, sideNow(s))))) };
}

/** Alt-drag: the other edge moves in proportion, within its own limits. */
export function proportional(from: number, fromStart: number, otherStart: number, max: number): number {
  if (fromStart <= 0 || otherStart <= 0) return otherStart;
  return Math.max(64, Math.min((otherStart * from) / fromStart, max));
}

/** ⌘[ and ⌘] (and the arrow keys on a handle): one step of 80 px on the chosen edge. */
export function step(s: FreeState, edge: "side" | "topics", dir: 1 | -1, app: number): FreeState {
  if (edge === "side") {
    if (dir < 0 && s.sideRail) return { ...s, sideHidden: true };
    if (dir > 0 && (s.sideHidden || s.sideRail)) {
      const wasHidden = s.sideHidden;
      return { ...s, sideHidden: false, sideRail: wasHidden, side: wasHidden ? s.side : Math.max(RAIL_BELOW, s.side) };
    }
    return commitSide(s, sideNow(s) + dir * STEP, app);
  }
  if (s.topics <= 0 && dir > 0) return commitTopics(s, TOPICS_MIN, app);
  const width = s.topics + dir * STEP;
  if (width <= TOPICS_MIN && dir < 0 && s.topics <= TOPICS_MIN) return { ...s, topics: 0 };
  return commitTopics(s, width, app);
}

/** Double-click an edge, or Enter on its handle: rail or closed ⇄ the last width. */
export function toggleRail(s: FreeState, edge: "side" | "topics"): FreeState {
  if (edge === "side") {
    if (s.sideRail || s.sideHidden) return { ...s, sideRail: false, sideHidden: false, side: Math.max(RAIL_BELOW, s.lastSide || 292) };
    return { ...s, sideRail: true, lastSide: s.side };
  }
  if (s.topics <= TOPICS_MIN) return { ...s, topics: Math.max(120, s.lastTopics || 300) };
  return { ...s, lastTopics: s.topics, topics: TOPICS_MIN };
}

/** ⌘\: collapse both to their rails, and again to bring them back. */
export function collapseBoth(s: FreeState, hasTopics: boolean): FreeState {
  const both = (s.sideRail || s.sideHidden) && s.topics <= TOPICS_MIN;
  if (both) return { ...s, sideRail: false, sideHidden: false, side: Math.max(RAIL_BELOW, s.lastSide || 292), topics: Math.max(120, s.lastTopics || 300) };
  return {
    ...s, lastSide: !s.sideRail && !s.sideHidden ? s.side : s.lastSide, lastTopics: s.topics > TOPICS_MIN ? s.topics : s.lastTopics,
    sideRail: true, sideHidden: false, topics: hasTopics ? TOPICS_MIN : s.topics,
  };
}

/** Reads the saved widths, or the defaults when nothing valid is saved. */
export function parseFree(raw: string | null): FreeState {
  try {
    const value = JSON.parse(raw || "null") as Partial<FreeState> | null;
    const num = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fallback);
    if (!value || typeof value !== "object") return FREE_DEFAULT;
    return {
      side: num(value.side, FREE_DEFAULT.side), sideRail: value.sideRail === true, sideHidden: value.sideHidden === true,
      lastSide: num(value.lastSide, FREE_DEFAULT.lastSide), topics: num(value.topics, FREE_DEFAULT.topics),
      lastTopics: num(value.lastTopics, FREE_DEFAULT.lastTopics), last: value.last === "side" ? "side" : "topics",
    };
  } catch {
    return FREE_DEFAULT;
  }
}

let current: FreeState | null = null;
const listeners = new Set<() => void>();
export function getFree(): FreeState {
  if (current === null) {
    try { current = parseFree(localStorage.getItem(STORAGE_KEY)); } catch { current = FREE_DEFAULT; }
  }
  return current;
}
export function setFree(next: FreeState): void {
  current = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Keep the widths for this window when storage is blocked. */ }
  listeners.forEach((listen) => listen());
}
/** "Reset widths" (the layout picker): the usual sizes. */
export function resetFree(): void {
  setFree(FREE_DEFAULT);
}
function subscribe(listen: () => void) {
  listeners.add(listen);
  return () => { listeners.delete(listen); };
}
export function useFree(): FreeState {
  return useSyncExternalStore(subscribe, getFree, getFree);
}
/** Tests reset the in-memory copy along with the storage. */
export function forgetFreeForTests(): void {
  current = null;
}

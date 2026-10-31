// The person's level (Regular, Advanced, Technical), read where a screen only needs to know it: their look's "level"
// (users.prefs ui.window.look, or this device without a profile), else the level kept in this window's storage.
import { useSyncExternalStore } from "react";
import type { WindowEngine } from "../../connect/engine";
import { lookStore } from "../../places/settings/set1/appearance-store";
import type { Level } from "./nav";

export const LEVEL_WORD = ["regular", "advanced", "technical"] as const;
export const LEVEL_KEY = "branch.level";

/** The level kept in this window's storage, or null when there is none or storage is blocked (it must never throw
 *  while Settings draws). */
export function savedLevel(): string | null {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(LEVEL_KEY); } catch { return null; }
}

/** A level word as its number: Regular 0, Advanced 1, Technical 2 (an unknown word reads as Regular). */
export const levelOfWord = (word: unknown): Level => Math.max(0, LEVEL_WORD.indexOf(word as (typeof LEVEL_WORD)[number])) as Level;

/** The level in use, read without loading the look: the window loads it once it is connected. */
export function useLevelNow(engine: WindowEngine): Level {
  const store = lookStore(engine);
  // A stand-in store with no subscribe (a test's) reads as a look with no level.
  const snap = useSyncExternalStore((fn) => (typeof store.subscribe === "function" ? store.subscribe(fn) : () => undefined), () => store.snap, () => store.snap);
  // A look that has not loaded yet (or a stand-in store) has no level of its own: this window's storage says it.
  return levelOfWord(snap?.look?.level ?? savedLevel());
}

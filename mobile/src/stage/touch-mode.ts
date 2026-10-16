// How a touch screen drives the computer while you have it: Touch (a tap clicks under the finger) or Trackpad
// (a finger moves a pointer). Chosen on the take-control screen and kept on this phone. Copied from
// window/src/stage/touch-mode.ts, using an in-memory choice plus optional storage instead of localStorage.
import { useEffect, useState } from "react";
import type { TouchMode } from "../../../window/src/stage/touch-gestures";
import type { KeyValueStore } from "../storage/keyValueStore";

export const TOUCH_MODE_KEY = "branch.drive.touchMode";
const listeners = new Set<(mode: TouchMode) => void>();
let current: TouchMode = "touch";

export function readTouchMode(): TouchMode {
  return current;
}

export function parseTouchMode(value: string | null | undefined): TouchMode {
  return value === "trackpad" ? "trackpad" : "touch";
}

export function setTouchMode(mode: TouchMode, store?: KeyValueStore) {
  current = mode === "trackpad" ? "trackpad" : "touch";
  for (const listener of [...listeners]) listener(current);
  if (store) void store.set(TOUCH_MODE_KEY, current);
}

export async function restoreTouchMode(store: KeyValueStore): Promise<TouchMode> {
  const saved = parseTouchMode(await store.get(TOUCH_MODE_KEY));
  if (saved !== current) setTouchMode(saved);
  return saved;
}

/** The current touch mode, updated when the Touch / Trackpad control changes it. */
export function useTouchMode(): TouchMode {
  const [mode, setMode] = useState<TouchMode>(readTouchMode);
  useEffect(() => {
    listeners.add(setMode);
    return () => {
      listeners.delete(setMode);
    };
  }, []);
  return mode;
}

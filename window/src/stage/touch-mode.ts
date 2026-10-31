// How a touch screen drives the Trunk's browser and computer while you have them: Touch (a tap clicks under the finger)
// or Trackpad (a finger moves a pointer). Chosen in the pane's ⋯ menu and kept on this computer.
import { useEffect, useState } from "react";
import type { TouchMode } from "./touch-gestures";

export const TOUCH_MODE_KEY = "branch.drive.touchMode";
const EVENT = "branch:touch-mode";

export function readTouchMode(): TouchMode {
  try {
    return localStorage.getItem(TOUCH_MODE_KEY) === "trackpad" ? "trackpad" : "touch";
  } catch {
    return "touch";
  }
}

export function setTouchMode(mode: TouchMode) {
  try {
    localStorage.setItem(TOUCH_MODE_KEY, mode);
  } catch {
    // Storage can be refused (private windows); the choice still holds until the window closes.
  }
  window.dispatchEvent(new CustomEvent<TouchMode>(EVENT, { detail: mode }));
}

/** The current touch mode, updated when the ⋯ menu changes it. */
export function useTouchMode(): TouchMode {
  const [mode, setMode] = useState<TouchMode>(readTouchMode);
  useEffect(() => {
    const changed = (e: Event) => setMode((e as CustomEvent<TouchMode>).detail === "trackpad" ? "trackpad" : "touch");
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  return mode;
}

// Last desktop-control values Branch itself wrote in this window. Regular Starting up (and a level switch that
// lands there) must read only this, never Electron's login-item list. On macOS, getLoginItemSettings walks other
// apps' login items and Sequoia treats that as "access data from other apps".
import type { DesktopControlsState } from "../../connect/desktop-controls";

export const DESKTOP_OWN_STATE_KEY = "branch.desktop-controls";

/** Reads that belong to other apps. The Settings level-switch / Regular Starting-up path must not do them. */
export const FOREIGN_DESKTOP_READS = [
  "getLoginItemSettings",
  "SMAppService.loginItemService",
  "defaults read of another bundle id",
  "~/Library/Containers/",
  "~/Library/Group Containers/",
] as const;

export function readOwnDesktopState(): DesktopControlsState | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(DESKTOP_OWN_STATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" ? value as DesktopControlsState : null;
  } catch {
    return null;
  }
}

export function writeOwnDesktopState(state: DesktopControlsState): void {
  try {
    localStorage.setItem(DESKTOP_OWN_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked: the row keeps the in-memory snapshot for this window */
  }
}

/** Regular Starting up and the level switch never call the app's get() (login items / other bundle IDs). */
export function regularStartingUpForeignReads(): readonly string[] {
  return [];
}

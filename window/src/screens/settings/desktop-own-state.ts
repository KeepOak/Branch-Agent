// Last desktop-control values Branch itself wrote in this window, after a real get() or a change. Regular Starting
// up (and a level switch that lands there) must not read Electron's login-item list on first mount. On macOS,
// getLoginItemSettings walks other apps' login items and Sequoia treats that as "access data from other apps".
import type { DesktopControlsState } from "../../connect/desktop-controls";

export const DESKTOP_OWN_STATE_KEY = "branch.desktop-controls";

/** A real snapshot has at least one on/off. An empty {} is not ready and must not fall back to a false on. */
export function isDesktopStateReady(state: unknown): state is DesktopControlsState {
  return Boolean(state && typeof state === "object" && Object.values(state).some((value) => typeof value === "boolean"));
}

/** What Branch stored itself; DesktopStore.start shows it (not fresh) so a row is not greyed until first use. */
export function readOwnDesktopState(): DesktopControlsState | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(DESKTOP_OWN_STATE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    return isDesktopStateReady(value) ? value : null;
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

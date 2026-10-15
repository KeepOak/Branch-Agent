// The desktop's browser bridge for this window, and the pop-out address a second window was opened with.
import { guestAddress } from "./guest-drive";

export type GuestBridge = {
  /** True when the engine runs on this computer. It does not pick the view: the Trunk's browser is always the default. */
  local: boolean;
  /** Opens a page in its own window. Null when the desktop has no such method: "Open in a window" is then greyed. */
  openPopout: ((url: string) => Promise<void>) | null;
  /** Fires when a page in the pane asks for a new window or tab. Null when the desktop has no such method: "Your browser"
   *  is then greyed, since the pane can't take its pages' new tabs. */
  onOpenTab: ((listener: (url: string) => void) => () => void) | null;
};

type RawBridge = {
  local?: unknown;
  openPopout?: unknown;
  onOpenTab?: unknown;
};

// One wrapper per desktop bridge object, so the pane's effects see the same identity on every render.
const wrapped = new WeakMap<object, GuestBridge>();

/**
 * The bridge when this window is an R1 window on the desktop, or null (plain web page, remote engine). Presence is
 * decided by the bridge object alone; each method is detected on its own, and a missing one is null, never a no-op, so
 * the control that needs it can be drawn greyed with its reason instead of doing nothing.
 */
export function guestBridge(): GuestBridge | null {
  const raw = (window as unknown as { branchDesktop?: { browserGuest?: RawBridge } }).branchDesktop?.browserGuest;
  if (!raw || typeof raw !== "object") return null;
  const cached = wrapped.get(raw);
  if (cached) return cached;
  const openPopout = typeof raw.openPopout === "function" ? (raw.openPopout as (url: string) => Promise<void>) : null;
  const onOpenTab = typeof raw.onOpenTab === "function" ? (raw.onOpenTab as (listener: (url: string) => void) => () => void) : null;
  const bridge: GuestBridge = {
    local: raw.local === true,
    openPopout: openPopout ? (url: string) => openPopout.call(raw, url) : null,
    onOpenTab: onOpenTab ? (listener) => onOpenTab.call(raw, listener) : null,
  };
  wrapped.set(raw, bridge);
  return bridge;
}

/** Null for the main window. A pop-out window (?browser=popout&url=...) returns its page address, or "" if it has none. */
export function popoutAddress(search: string = window.location.search): string | null {
  const params = new URLSearchParams(search);
  if (params.get("browser") !== "popout") return null;
  return guestAddress(params.get("url") ?? "") ?? "";
}

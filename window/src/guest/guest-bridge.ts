// The desktop's browser bridge for this window, and the pop-out address a second window was opened with.
import { guestAddress } from "./guest-drive";

export type GuestBridge = {
  /** True when the owner's own browser should be the default view. */
  local: boolean;
  openPopout(url: string): Promise<void>;
  /** Fires when a page in the pane asks for a new window or tab. */
  onOpenTab(listener: (url: string) => void): () => void;
};

type RawBridge = Partial<GuestBridge>;

// One wrapper per desktop bridge object, so the pane's effects see the same identity on every render.
const wrapped = new WeakMap<object, GuestBridge>();

/**
 * The bridge when this window is an R1 window on the desktop, or null (plain web page, remote engine). Presence is
 * decided by the bridge object alone. A method the desktop did not provide becomes a no-op, so the switch still shows.
 */
export function guestBridge(): GuestBridge | null {
  const raw = (window as unknown as { branchDesktop?: { browserGuest?: RawBridge } }).branchDesktop?.browserGuest;
  if (!raw || typeof raw !== "object") return null;
  const cached = wrapped.get(raw);
  if (cached) return cached;
  const bridge: GuestBridge = {
    local: raw.local === true,
    openPopout: (url: string) => (typeof raw.openPopout === "function" ? raw.openPopout(url) : Promise.resolve()),
    onOpenTab: (listener) => (typeof raw.onOpenTab === "function" ? raw.onOpenTab(listener) : () => {}),
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

// The desktop's browser bridge for this window, and the pop-out address a second window was opened with.
import { guestAddress } from "./guest-drive";

export type GuestBridge = {
  /** True when the owner's own browser should be the default view. */
  local: boolean;
  openPopout(url: string): Promise<void>;
  /** Fires when a page in the pane asks for a new window or tab. */
  onOpenTab(listener: (url: string) => void): () => void;
};

/** The bridge when this window is an R1 window on the desktop, or null (plain web page, remote engine). */
export function guestBridge(): GuestBridge | null {
  const bridge = (window as unknown as { branchDesktop?: { browserGuest?: GuestBridge } }).branchDesktop?.browserGuest;
  return bridge && typeof bridge.openPopout === "function" && typeof bridge.onOpenTab === "function" ? bridge : null;
}

/** Null for the main window. A pop-out window (?browser=popout&url=...) returns its page address, or "" if it has none. */
export function popoutAddress(search: string = window.location.search): string | null {
  const params = new URLSearchParams(search);
  if (params.get("browser") !== "popout") return null;
  return guestAddress(params.get("url") ?? "") ?? "";
}

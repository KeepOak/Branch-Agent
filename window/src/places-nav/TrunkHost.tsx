// Opens a Trunk's profile or editor from anywhere in the window. The conversation ⋯ menu and the thread header's
// face and name open a place, then dispatch "branch:open-trunk" { agentId, view: "profile" | "edit" }.
// The listener is installed when this module loads, so a request sent before the place mounts still opens.
import { useEffect, useSyncExternalStore } from "react";
import { TrunkEditor, TrunkProfile } from "../places/trunk";
import type { PlaceProps } from "./PlaceFrame";

/** The Trunk tab an editor opens on: "may" holds the Trunk's own model and stand-ins. */
export type OpenTrunk = { agentId: string; view: "profile" | "edit"; tab?: "look" | "may" | "computers" };
const EDITOR_TABS = ["look", "may", "computers"] as const;

let current: OpenTrunk | null = null;
const listeners = new Set<() => void>();
function setOpen(next: OpenTrunk | null): void {
  current = next;
  listeners.forEach((fn) => fn());
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The request in a "branch:open-trunk" event, or null when it names no Trunk. */
export function readOpenTrunk(detail: unknown): OpenTrunk | null {
  const d = (detail ?? {}) as { agentId?: unknown; view?: unknown; tab?: unknown };
  if (typeof d.agentId !== "string" || !d.agentId) return null;
  const view = d.view === "edit" ? "edit" : "profile";
  const tab = EDITOR_TABS.find((t) => t === d.tab);
  return view === "edit" && tab ? { agentId: d.agentId, view, tab } : { agentId: d.agentId, view };
}

if (typeof window !== "undefined") {
  window.addEventListener("branch:open-trunk", (e) => {
    const next = readOpenTrunk((e as CustomEvent).detail);
    if (next) setOpen(next);
  });
}

/** Draws the requested Trunk profile or editor over the window while a place is shown. */
export function TrunkHost({ engine, level, openSettings, openPlace, openConversation }: Pick<PlaceProps, "engine" | "level" | "openSettings" | "openPlace"> & Partial<Pick<PlaceProps, "openConversation">>) {
  const open = useSyncExternalStore(subscribe, () => current);
  useEffect(() => () => setOpen(null), []);
  if (!open) return null;
  const close = () => setOpen(null);
  return open.view === "edit"
    ? <TrunkEditor key={open.agentId} engine={engine} agentId={open.agentId} level={level} onClose={close} openSettings={openSettings} tab={open.tab} />
    : <TrunkProfile key={open.agentId} engine={engine} agentId={open.agentId} level={level} onClose={close} openSettings={openSettings} openPlace={openPlace} openConversation={openConversation} />;
}

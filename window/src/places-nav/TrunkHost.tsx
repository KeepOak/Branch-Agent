// Opens a Trunk's profile or editor from anywhere in the window. The conversation ⋯ menu and the thread header's
// face and name open a place, then dispatch "branch:open-trunk" { agentId, view: "profile" | "edit" }.
// The listener is installed when this module loads, so a request sent before the place mounts still opens.
import { useEffect, useSyncExternalStore } from "react";
import { TrunkEditor, TrunkProfile } from "../places/trunk";
import type { PlaceProps } from "./PlaceFrame";

export type OpenTrunk = { agentId: string; view: "profile" | "edit" };

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
  const d = (detail ?? {}) as { agentId?: unknown; view?: unknown };
  if (typeof d.agentId !== "string" || !d.agentId) return null;
  return { agentId: d.agentId, view: d.view === "edit" ? "edit" : "profile" };
}

if (typeof window !== "undefined") {
  window.addEventListener("branch:open-trunk", (e) => {
    const next = readOpenTrunk((e as CustomEvent).detail);
    if (next) setOpen(next);
  });
}

/** Draws the requested Trunk profile or editor over the window while a place is shown. */
export function TrunkHost({ engine, level, openSettings, openPlace }: Pick<PlaceProps, "engine" | "level" | "openSettings" | "openPlace">) {
  const open = useSyncExternalStore(subscribe, () => current);
  useEffect(() => () => setOpen(null), []);
  if (!open) return null;
  const close = () => setOpen(null);
  return open.view === "edit"
    ? <TrunkEditor key={open.agentId} engine={engine} agentId={open.agentId} level={level} onClose={close} openSettings={openSettings} />
    : <TrunkProfile key={open.agentId} engine={engine} agentId={open.agentId} level={level} onClose={close} openSettings={openSettings} openPlace={openPlace} />;
}

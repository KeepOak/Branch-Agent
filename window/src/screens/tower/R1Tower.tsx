import { useEffect, useState } from "react";
import type { Conversation } from "../../connect/conversations";
import type { WindowEngine } from "../../connect/engine";
import { ControlTower } from "../../shell/ControlTower";
import { PLACES, type PlaceId } from "../../places-nav/routes";
import "./r1-tower.css";

/** Below this width the Classic tower has no room beside the conversation, so R1 shows it in the main column instead. */
export const TOWER_NARROW = "(max-width: 1100px)";
/** The Classic preference key, so the tower's shown or hidden state is the same in both windows. */
export const TOWER_KEY = "branch.controlTower";

function narrowQuery(): MediaQueryList | null { return typeof matchMedia === "function" ? matchMedia(TOWER_NARROW) : null; }

/** Whether the window is too narrow for the tower to sit beside the conversation. */
export function useTowerNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => narrowQuery()?.matches ?? false);
  useEffect(() => {
    const media = narrowQuery();
    if (!media) return;
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** Shown at start as in Classic (unless hidden there or here), but never by default when it would cover the conversation. */
export function readTowerOn(): boolean {
  if (narrowQuery()?.matches) return false;
  try { return localStorage.getItem(TOWER_KEY) !== "hidden"; } catch { return true; }
}

export function saveTowerOn(on: boolean): void {
  try { localStorage.setItem(TOWER_KEY, on ? "shown" : "hidden"); } catch { /* current window only */ }
}

type Props = {
  engine: WindowEngine; rows: Conversation[]; needsCount: number; trunkName: (id?: string) => string; inMain?: boolean;
  onOpen: (key: string) => void; onPlace: (place: PlaceId) => void; onSettings: (page: string) => void; onClose: () => void;
};

/**
 * The Classic control tower, re-hosted unchanged inside the R1 frame (parity row 5). Only this wrapper is R1: a clear
 * glass column beside the conversation (README item 48), or the main column itself on a narrow window. The tower's
 * own links (All history, Automations, Add an account) ask the window to open a place or a Settings page; R1 answers
 * them here, the way the Classic window does.
 */
export function R1Tower({ engine, rows, needsCount, trunkName, inMain, onOpen, onPlace, onSettings, onClose }: Props) {
  useEffect(() => {
    const place = (event: Event) => {
      const detail = (event as CustomEvent<{ place?: string; tab?: string }>).detail;
      const id = PLACES.find(p => p.id === detail?.place)?.id;
      if (!id) return;
      onPlace(id);
      if (typeof detail?.tab === "string") {
        const tab = detail.tab;
        setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: id, tab } })), 0);
      }
    };
    const settings = (event: Event) => {
      const page = (event as CustomEvent<{ page?: string }>).detail?.page;
      if (typeof page === "string" && /^[a-z][a-z0-9-]*$/.test(page)) onSettings(page);
    };
    window.addEventListener("branch:navigate-place", place);
    window.addEventListener("branch:navigate-settings", settings);
    return () => { window.removeEventListener("branch:navigate-place", place); window.removeEventListener("branch:navigate-settings", settings); };
  }, [onPlace, onSettings]);
  return <div className="r1-tower g-clear" data-in-main={inMain || undefined}>
    <ControlTower engine={engine} rows={rows} needsCount={needsCount} trunkName={trunkName} onOpen={onOpen} onInbox={() => onPlace("inbox")} onClose={onClose} />
  </div>;
}

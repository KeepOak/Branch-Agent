// Settings › Appearance › What's shown (§4.7.3): which parts of the frame the person keeps. The switches are saved in
// users.prefs "ui.window.look" as show.* keys; the window's look store holds them and redraws on every change (the
// same change that sends "branch:look-change").
import { useSyncExternalStore } from "react";
import type { WindowEngine } from "../connect/engine";
import { lookStore } from "../places/settings/set1/appearance-store";
import type { MenuItem } from "./Menu";
import { menuIcon } from "./menu-icons";

export type Shown = { usage: boolean; gateway: boolean; statusBar: boolean; projects: boolean; gfx: boolean };

/** Each part is shown unless its switch is off. */
export function shownFrom(look: Record<string, unknown>): Shown {
  const on = (key: string) => look[key] !== false;
  // The graphics and memory readout ships off, as in Hermes; only its switch turns it on (the preview's S.hide.gfx).
  return { usage: on("show.usage"), gateway: on("show.gateway"), statusBar: on("show.statusbar"), projects: on("show.projects"), gfx: look["show.gfx"] === true };
}

export function useShown(engine: WindowEngine): Shown {
  const store = lookStore(engine);
  const look = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap.look, () => store.snap.look);
  return shownFrom(look);
}

/** The parts that hide from a right-click (data-hide="<part>"), as the preview's: its What's shown key for each. */
export const HIDEABLE: Record<string, string> = { usage: "show.usage", gateway: "show.gateway", projects: "show.projects", gfx: "show.gfx" };

/** The part a right-click landed on, or null. */
export function hideTarget(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest<HTMLElement>("[data-hide]") : null;
  const part = el?.dataset.hide ?? "";
  return part in HIDEABLE ? part : null;
}

/** The right-click menu on a part: Hide this, or Choose what's shown… (Settings › Appearance). */
export function hideMenuItems(hide: () => void, choose: () => void): MenuItem[] {
  return [
    { label: "Hide this", icon: menuIcon("eye"), run: hide, testid: "hide-this" },
    { label: "Choose what’s shown…", icon: menuIcon("sliders"), run: choose, testid: "hide-choose" },
  ];
}

/** The pet as Appearance sets it (look keys pet, petName, roam). */
export function usePetLook(engine: WindowEngine): { id: string; name: string; roam: boolean } {
  const store = lookStore(engine);
  const look = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap.look, () => store.snap.look);
  return {
    id: typeof look.pet === "string" ? look.pet : "px-squirrel",
    name: typeof look.petName === "string" && look.petName ? look.petName : "Hazel",
    roam: look.roam === true,
  };
}

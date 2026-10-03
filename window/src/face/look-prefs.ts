// Settings › Appearance rows that change how faces and the list draw (§4.7.3): read from the look the window keeps
// ("branch.look", written by the look store in places/settings/set1/appearance-store.tsx) and kept current by its
// "branch:look-change" event, which fires on every change, on load from users.prefs and on users.prefs.changed.
import { useSyncExternalStore } from "react";

export type AgentSize = "s" | "m" | "l";
/** The agent beside the conversation, per size (the preview's AG_SIZE_C18). */
export const AGENT_SIZE_PX: Record<AgentSize, number> = { s: 72, m: 110, l: 150 };

export type LookPrefs = {
  agentSize: AgentSize;
  /** "Headlines for working conversations": the list's second line under a working conversation. */
  headlines: boolean;
  /** "What a working Trunk is doing, in the list": the row's preview shows its latest step. */
  liveInList: boolean;
  /** "Acts out what it is doing": faces play their state (thinking, searching, working, waiting, celebrating). */
  actsOut: boolean;
  /** "Moves while it speaks": the talking face plays while it speaks. */
  movesWhileSpeaking: boolean;
  /** "Reacts when you touch it": hover and pat reactions. */
  reactsToTouch: boolean;
  /** "Captions under it": what it says, under the face in a call. */
  captions: boolean;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The rows' values from a look record, each falling back to the page's default. */
export function lookPrefsOf(look: Record<string, unknown>): LookPrefs {
  const size = look.agentSize;
  return {
    agentSize: size === "s" || size === "l" ? size : "m",
    headlines: look.headlines !== false,
    liveInList: look["show.live"] !== false,
    actsOut: look["ch.act"] !== false,
    movesWhileSpeaking: look["ch.move"] !== false,
    reactsToTouch: look["ch.touch"] !== false,
    captions: look["ch.cap"] !== false,
  };
}

function readLook(): Record<string, unknown> {
  try {
    return rec(rec(JSON.parse(localStorage.getItem("branch.look") ?? "{}")).look);
  } catch {
    return {}; // storage blocked or damaged: the defaults stand until the look store announces a change
  }
}

let current: LookPrefs = lookPrefsOf(readLook());
const listeners = new Set<() => void>();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("branch:look-change", (e: Event) => {
    current = lookPrefsOf(rec(rec((e as CustomEvent).detail).look));
    listeners.forEach((fn) => fn());
  });
}
if (typeof window !== "undefined") listen(); // from load, so no change is missed before the first face draws
function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The Appearance rows faces and the list follow, current with every change. */
export function useLookPrefs(): LookPrefs {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

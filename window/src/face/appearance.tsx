import { createContext, useContext } from "react";

export type Appearance = { still: string; states?: Partial<Record<string, string>>; colour?: string };
export const TrunkAppearances = createContext<Record<string, Appearance>>({});
export const useTrunkAppearance = (name?: string) => useContext(TrunkAppearances)[name ?? ""];
export type PebbleLook = { colour?: string; shape?: string; eyes?: string };
export const TrunkPebbleLooks = createContext<Record<string, PebbleLook>>({});
export const useTrunkPebbleLook = (name?: string) => useContext(TrunkPebbleLooks)[name ?? ""];
export const TrunkEmojiFaces = createContext<Record<string, string>>({});
export const useTrunkEmojiFace = (name?: string) => useContext(TrunkEmojiFaces)[name ?? ""];
/** Characters with art under public/assets/agents (full set) and public/assets/art17/agents (think, work, yay). */
export const CHARACTERS = ["bolt", "ember", "juniper", "kite", "lumen", "morel", "pebble", "tide", "tock", "wisp"];
export const EXTRA = ["nib", "skein", "sorrel"];

/** Every non-default Trunk starts with a character; only the default keeps the classic pebble. */
export function trunkAppearance(avatar: string | undefined, _name: string, colour?: string): Appearance | undefined {
  if (avatar === "classic") return undefined;
  const chosen = avatar;
  if (!chosen) return undefined;
  const id = chosen.replace(/^branch:/, "").replace(/^.*\/agents\//, "").split("/")[0];
  if (id === "branch") return { still: "/assets/branch-wave.webp", states: Object.fromEntries(["idle", "sleep", "think", "work", "search", "read", "talk", "wait", "yay", "oops"].map((state) => [state, `/assets/anim-${state}.webm`])), colour };
  if (CHARACTERS.includes(id) || EXTRA.includes(id)) {
    const base = `/assets/${EXTRA.includes(id) ? "art17/" : ""}agents/${id}/`;
    const states = Object.fromEntries(["idle", "sleep", "think", "work", "search", "read", "talk", "wait", "yay", "oops"].map(s => [s, base + s + ".webm"]));
    return { still: base + "still.webp", states, colour };
  }
  if (/^(https?:\/\/|data:image\/|\/avatar\/)/i.test(chosen)) return { still: chosen };
  return undefined;
}

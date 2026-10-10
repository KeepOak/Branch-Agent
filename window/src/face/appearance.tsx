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

/** Nature-themed pebbles for a Trunk or grafted agent with no look of its own: the same name always gets the same one. */
const NATURE_COLOURS = ["#5E7F4A", "#7A5A3C", "#4F7FA0", "#B0643F", "#8A8F4B", "#2F7C7A", "#6A5A8C", "#B39A5A"];
const NATURE_SHAPES = ["Circle", "Stone", "Leaf", "Acorn", "Shield"];

/** The identity key a name is matched on: lowercased, with spaces and hyphens folded together. */
export function identityKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, " ");
}

/** The key a nature look is drawn from: a JSON pair of the name's identity key and the computer's (null when unknown),
 *  so no name can collide with a name-plus-computer pair. */
export function lookKey(name: string, where?: string): string {
  return JSON.stringify([identityKey(name), where?.trim() ? identityKey(where) : null]);
}

/** A deterministic moss, bark, sky or clay pebble from a look key (djb2 hash). */
export function natureLook(key: string): PebbleLook {
  let hash = 5381;
  for (const ch of key) hash = ((hash << 5) + hash + ch.charCodeAt(0)) >>> 0;
  return {
    colour: NATURE_COLOURS[hash % NATURE_COLOURS.length],
    shape: NATURE_SHAPES[Math.floor(hash / NATURE_COLOURS.length) % NATURE_SHAPES.length],
    eyes: "Round",
  };
}

/** A look with its gaps filled from the name's nature look, so a face never falls back to the grey placeholder. */
export function completePebbleLook(look: PebbleLook | undefined, name: string | undefined, where?: string): PebbleLook {
  const nature = natureLook(lookKey(name ?? "", where));
  return { colour: look?.colour ?? nature.colour, shape: look?.shape ?? nature.shape, eyes: look?.eyes ?? nature.eyes };
}

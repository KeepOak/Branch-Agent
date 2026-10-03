import { createContext, useContext } from "react";

export type Appearance = { still: string; states?: Partial<Record<string, string>> };
export const TrunkAppearances = createContext<Record<string, Appearance>>({});
export const useTrunkAppearance = (name?: string) => useContext(TrunkAppearances)[name ?? ""];
/** Characters with art under public/assets/agents (full set) and public/assets/art17/agents (think, work, yay). */
export const CHARACTERS = ["bolt", "ember", "juniper", "kite", "lumen", "morel", "pebble", "tide", "tock", "wisp"];
export const EXTRA = ["nib", "skein", "sorrel"];
const DEFAULT_LOOKS: Record<string, string> = { scout: "ember", ledger: "tock", ada: "kite", fieldnotes: "morel", quill: "lumen" };

/** Preview looks apply to those Trunks only. Sapling keeps its classic face; configured avatars win. */
export function trunkAppearance(avatar: string | undefined, name: string): Appearance | undefined {
  if (avatar === "classic") return undefined;
  const chosen = avatar || DEFAULT_LOOKS[name.toLowerCase()];
  if (!chosen) return undefined;
  const id = chosen.replace(/^branch:/, "").replace(/^.*\/agents\//, "").split("/")[0];
  if (CHARACTERS.includes(id) || EXTRA.includes(id)) {
    const base = `/assets/${EXTRA.includes(id) ? "art17/" : ""}agents/${id}/`;
    const states = Object.fromEntries((EXTRA.includes(id) ? ["think", "work", "yay"] : ["think", "work", "search", "read", "talk", "wait", "yay", "oops"]).map(s => [s, base + s + ".webm"]));
    return { still: base + "still.webp", states };
  }
  if (/^(https?:\/\/|data:image\/|\/avatar\/)/i.test(chosen)) return { still: chosen };
  return undefined;
}

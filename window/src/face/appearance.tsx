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

/** Theme tokens (tokens.css --trunk-1..7) for Trunks with no colour of their own, so none looks like another (DA-04). */
export const ROSTER_COLOURS = [1, 2, 3, 4, 5, 6, 7].map((n) => `var(--trunk-${n})`);
const ROSTER_EYES = ["Round", "Wide", "Sleepy"];

/** The looks of a Trunk roster: each Trunk keeps what it chose, and the gaps are filled with the least-used colour,
 *  shape and eyes, so no two Trunks share a face while the options last (DA-04). The name picks its first choice and
 *  the roster is walked in name order, so a Trunk keeps its look across reloads. */
export function rosterPebbleLooks(
  trunks: { name: string; colour?: string; shape?: string; eyes?: string }[],
  /** Turns a token into the colour it stands for, so a Trunk's own hex steers the others off the same token. */
  resolve: (colour: string) => string = (colour) => colour,
): Record<string, PebbleLook> {
  const unique = [...new Map(trunks.map((t) => [t.name, t])).values()];
  const seen = { colour: new Map<string, number>(), shape: new Map<string, number>(), eyes: new Map<string, number>() };
  const faces = new Set<string>();
  const hue = (colour: string) => resolve(colour).trim().toUpperCase();
  const face = (l: Required<PebbleLook>) => `${hue(l.colour)}|${l.shape}|${l.eyes}`;
  const bump = (field: keyof typeof seen, value: string) => seen[field].set(value, (seen[field].get(value) ?? 0) + 1);
  // The least-used option, looking from the name's own pick, so ties keep the name's choice.
  const pick = (field: keyof typeof seen, options: string[], start: number) => {
    const used = (option: string) => seen[field].get(field === "colour" ? hue(option) : option) ?? 0;
    let best = options[start % options.length];
    for (let i = 1; i < options.length; i++) {
      const option = options[(start + i) % options.length];
      if (used(option) < used(best)) best = option;
    }
    return best;
  };
  for (const t of unique) {
    if (t.colour) bump("colour", hue(t.colour));
    if (t.shape) bump("shape", t.shape);
    if (t.eyes) bump("eyes", t.eyes);
    if (t.colour && t.shape && t.eyes) faces.add(face({ colour: t.colour, shape: t.shape, eyes: t.eyes }));
  }
  const looks: Record<string, PebbleLook> = {};
  for (const t of unique.toSorted((x, y) => identityKey(x.name).localeCompare(identityKey(y.name)))) {
    let hash = 5381;
    for (const ch of lookKey(t.name)) hash = ((hash << 5) + hash + ch.charCodeAt(0)) >>> 0;
    const colour = t.colour ?? pick("colour", ROSTER_COLOURS, hash);
    const shape = t.shape ?? pick("shape", NATURE_SHAPES, Math.floor(hash / 7));
    let eyes = t.eyes ?? pick("eyes", ROSTER_EYES, Math.floor(hash / 35));
    if (!t.eyes && faces.has(face({ colour, shape, eyes }))) eyes = ROSTER_EYES.find((e) => !faces.has(face({ colour, shape, eyes: e }))) ?? eyes;
    if (!t.colour) bump("colour", hue(colour));
    if (!t.shape) bump("shape", shape);
    if (!t.eyes) bump("eyes", eyes);
    faces.add(face({ colour, shape, eyes }));
    looks[t.name] = { colour, shape, eyes };
  }
  return looks;
}

/** The value a theme token holds on the page (`var(--trunk-1)` gives its hex); anything else comes back as it is. */
export function themeColour(colour: string): string {
  const token = /^var\((--[\w-]+)\)$/.exec(colour.trim());
  if (!token || typeof document === "undefined") return colour;
  return getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim() || colour;
}

/** A face's look: the fields it was handed, then the roster's, so a Trunk screen and the sidebar draw the same face. */
export function mergePebbleLook(own: PebbleLook | undefined, roster: PebbleLook | undefined): PebbleLook | undefined {
  if (!own) return roster;
  if (!roster) return own;
  return { colour: own.colour || roster.colour, shape: own.shape || roster.shape, eyes: own.eyes || roster.eyes };
}

/** A look with its gaps filled from the name's nature look, so a face never falls back to the grey placeholder. */
export function completePebbleLook(look: PebbleLook | undefined, name: string | undefined, where?: string): PebbleLook {
  const nature = natureLook(lookKey(name ?? "", where));
  return { colour: look?.colour ?? nature.colour, shape: look?.shape ?? nature.shape, eyes: look?.eyes ?? nature.eyes };
}

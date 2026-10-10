// The editor's controls, and what a change to each one means: which control shows the Saved tick, and which changes
// take something away from the Trunk (a switch turned off, a stand-in dropped). Those can be undone for 5 seconds.
import type { Draft } from "./api";

export type FieldKey = "name" | "theme" | "look" | "emoji" | "colour" | "shape" | "eyes" | "model" | "read" | "browse" | "decide" | "fallbacks" | "startOn";
export type Removal = { label: string; revert: (d: Draft) => Partial<Draft> };

/** The controls whose value differs between two drafts. */
export function changedFields(was: Draft, now: Draft): FieldKey[] {
  const pairs: [FieldKey, boolean][] = [
    ["name", was.name !== now.name], ["theme", was.theme !== now.theme], ["look", was.look !== now.look], ["emoji", was.emoji !== now.emoji],
    ["colour", was.colour !== now.colour], ["shape", was.shape !== now.shape], ["eyes", was.eyes !== now.eyes], ["model", was.model !== now.model],
    ["read", was.may.read !== now.may.read], ["browse", was.may.browse !== now.may.browse], ["decide", was.may.decide !== now.may.decide],
    ["fallbacks", was.may.fallbacks.join("\n") !== now.may.fallbacks.join("\n")], ["startOn", was.may.startOn !== now.may.startOn],
  ];
  return pairs.filter(([, changed]) => changed).map(([key]) => key);
}

/** Puts `ref` back at `index`, unless the list already has it. */
function insertAt(list: string[], index: number, ref: string): string[] {
  if (list.includes(ref)) return list;
  const next = [...list];
  next.splice(index, 0, ref);
  return next;
}

/** The removals in a change: each one names what went and how to put it back. */
export function removals(was: Draft, now: Draft): Removal[] {
  const out: Removal[] = [];
  if (was.may.read && !now.may.read) out.push({ label: "Reading files is off", revert: (d) => ({ may: { ...d.may, read: true } }) });
  if (was.may.browse && !now.may.browse) out.push({ label: "The browser is off", revert: (d) => ({ may: { ...d.may, browse: true } }) });
  const index = was.may.fallbacks.findIndex((ref) => !now.may.fallbacks.includes(ref));
  if (index >= 0) {
    const ref = was.may.fallbacks[index];
    out.push({ label: "Stand-in removed", revert: (d) => ({ may: { ...d.may, fallbacks: insertAt(d.may.fallbacks, index, ref) } }) });
  }
  return out;
}

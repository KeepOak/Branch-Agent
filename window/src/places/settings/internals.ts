import { versionParts } from "../../connect/branch-version";

// How Branch works inside (ports, process ids, build hashes, raw settings keys, folder slugs) shows only at Technical
// (owner rule). Every Settings view, R1 or a Classic block inside R1, asks this one place.

/** "How much to show" that first shows engine internals: Technical (0 Regular, 1 Advanced, 2 Technical). */
export const INTERNALS_FROM = 2;

const WORDS = ["regular", "advanced", "technical"] as const;

/** Whether this level shows engine internals. Takes R1's number or Classic's word. */
export function showsInternals(level: number | (typeof WORDS)[number]): boolean {
  return (typeof level === "number" ? level : WORDS.indexOf(level)) >= INTERNALS_FROM;
}

/** A raw settings key such as messages.statusReactions.enabled or agents.entries.main.model.fallbacks[0]. */
const RAW_KEY = /\b[a-z][\w-]*(?:\.[\w*:@-]+|\[\d+\])+/;

/** Whether a line names a raw settings key. */
export const hasRawKey = (text: string): boolean => RAW_KEY.test(text);

/** A Branch version as a person reads it ("0.4.4"), with its build hash only at Technical. */
export function versionLabel(version: string, level: number | (typeof WORDS)[number]): string {
  const parts = versionParts(version);
  return showsInternals(level) ? parts.detail : parts.short;
}

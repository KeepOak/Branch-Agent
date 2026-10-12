// Seeds (owner items 31 and 35): a short text that names one Seedbank item, so it can be pasted anywhere in Branch or saved
// as a .seed file. A seed carries the item's reference only, never files or secrets. Seed links on keepoak.com are not
// local yet, so they show Coming. The safety check reads what the engine returned about the item (its SKILL.md or
// readme) for hidden instructions and secrets, and fingerprints that text with SHA-256.
import type { Entry, KindId } from "./catalog";

export type Seed = { kind: Extract<KindId, "agents" | "skills" | "mcp" | "plugins">; name: string; by: string; ref: string };
export const SEED_FORMAT = "branch.seed";

/** The seed text for an entry, or null when its kind has no seed yet. */
export function seedText(entry: Entry): string | null {
  const s = entry.source;
  const ref = s.type === "template" ? s.template.id : s.type === "skill" ? s.ref : s.type === "plugin" ? s.packageName : null;
  if (!ref || (entry.kind !== "agents" && entry.kind !== "skills" && entry.kind !== "mcp" && entry.kind !== "plugins")) return null;
  return JSON.stringify({ format: SEED_FORMAT, version: 1, kind: entry.kind, name: entry.name, by: entry.by, ref });
}

export const SEED_LINK_COMING = "Seed links from keepoak.com arrive in a later update.";
export const NOT_A_SEED = "That isn’t a seed link or file.";

export type Parsed = { ok: true; seed: Seed } | { ok: false; reason: string; coming?: boolean };

/** Reads pasted text or a .seed file. */
export function parseSeed(text: string): Parsed {
  const t = text.trim();
  if (!t) return { ok: false, reason: NOT_A_SEED };
  if (/keepoak\.com\/s\//i.test(t)) return { ok: false, reason: SEED_LINK_COMING, coming: true };
  if (!t.startsWith("{")) return { ok: false, reason: NOT_A_SEED };
  let value: unknown;
  try { value = JSON.parse(t); } catch { return { ok: false, reason: NOT_A_SEED }; }
  const o = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (o.format !== SEED_FORMAT || typeof o.ref !== "string" || !o.ref || typeof o.kind !== "string") return { ok: false, reason: NOT_A_SEED };
  if (!["agents", "skills", "mcp", "plugins"].includes(o.kind)) return { ok: false, reason: "Adding this kind of seed comes in a later update.", coming: true };
  return { ok: true, seed: { kind: o.kind as Seed["kind"], ref: o.ref, name: typeof o.name === "string" && o.name ? o.name : o.ref, by: typeof o.by === "string" ? o.by : "" } };
}

const HIDDEN = [
  /ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|prompts|messages)/i,
  /disregard (all |any )?(the )?(previous|prior|above|system) (instructions|prompt)/i,
  /(reveal|print|send|upload|exfiltrate)[^.\n]{0,40}(system prompt|api keys?|passwords?|secrets?|credentials|tokens?)/i,
  /exfiltrat/i,
  /do not (tell|show|inform) the (user|owner)/i,
  /[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/,
];
/** True when the text tries to change a Trunk's instructions or hide what it does. */
export function hasHiddenInstructions(text: string): boolean {
  return HIDDEN.some(pattern => pattern.test(text));
}

const SECRETS = [/\bsk-[A-Za-z0-9_-]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
/** True when the text carries something that looks like a key or token. */
export function hasSecrets(text: string): boolean {
  return SECRETS.some(pattern => pattern.test(text));
}

/** The first 8 hex digits of the text's SHA-256. */
export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");
}

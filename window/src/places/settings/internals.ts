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

/** The top-level sections of Branch's settings file: a dotted path starting with one of them is a settings key. */
const CONFIG_ROOTS = [
  "agents", "approvals", "auth", "bindings", "browser", "canvasHost", "channels", "commands", "cron", "diagnostics", "discovery", "env",
  "gateway", "hooks", "logging", "mcp", "memory", "messages", "meta", "models", "nodeHost", "plugins", "session", "skills",
  "talk", "tools", "tts", "ui", "update", "wizard",
];
/** A raw settings key: messages.statusReactions.enabled, agents.entries.main.model.fallbacks[0] or auth.profiles.anthropic:you.
 *  A section name must start it, so host names (keepoak.com, example.org) and versions (0.4.4) are never one. */
const RAW_KEY = new RegExp(`(?<![\\w.])(?:${CONFIG_ROOTS.join("|")})(?:\\.[\\w*-]+)+(?:\\[\\d+\\]|:[^\\s,]+)?`);

/** A web address ending, so "tools.dev" or "agents.io" stays a host name, not a key. */
const HOST_END = /\.(?:com|org|net|io|dev|ai|app|co|uk|de|fr|eu|us)$/;

/** Whether a line names a raw settings key. */
export const hasRawKey = (text: string): boolean => {
  const all = new RegExp(RAW_KEY.source, "g");
  for (const [found] of text.matchAll(all)) if (found.split(".").length > 2 || !HOST_END.test(found)) return true;
  return false;
};

/** A Branch version as a person reads it ("0.4.4"), with its build hash only at Technical. */
export function versionLabel(version: string, level: number | (typeof WORDS)[number]): string {
  const parts = versionParts(version);
  return showsInternals(level) ? parts.detail : parts.short;
}

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

/** File extensions that look like a last key segment (memory.md, session.json) but name a file a person reads. */
const FILE_EXTENSIONS = new Set([
  "md", "markdown", "txt", "json", "json5", "jsonl", "yaml", "yml", "toml", "ini", "csv", "log", "xml", "html", "css",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "sh", "rs", "go", "rb", "java", "swift", "kt", "c", "h", "cpp",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "pdf", "doc", "docx", "xlsx", "pptx", "zip", "tar", "gz", "mp3",
  "mp4", "mov", "wav", "seed", "lock", "env", "bak",
]);

/** Whether a matched token ends in a file extension, so it names a file and not a settings key. */
const isFileName = (token: string): boolean => {
  const dot = token.lastIndexOf(".");
  return dot > 0 && !token.endsWith("]") && FILE_EXTENSIONS.has(token.slice(dot + 1));
};

/** Whether a line names a raw settings key. Host names and plain file names (memory.md, skills.yaml) are not keys. */
export const hasRawKey = (text: string): boolean => {
  const all = new RegExp(RAW_KEY.source, "g");
  for (const [found] of text.matchAll(all)) {
    if (isFileName(found)) continue;
    if (found.split(".").length > 2 || !HOST_END.test(found)) return true;
  }
  return false;
};

/** A Branch version as a person reads it ("0.4.4"), with its build hash only at Technical. */
export function versionLabel(version: string, level: number | (typeof WORDS)[number]): string {
  const parts = versionParts(version);
  return showsInternals(level) ? parts.detail : parts.short;
}

/** The plain word for the engine below Technical. "Gateway" is an engine word the owner does not use; Regular and
 *  Advanced say "engine", the word Remote access already uses ("Restart the engine"). Raw keys such as
 *  gateway.auth.token are left alone, and grammar follows the article the copy already has. */
export function plainCopy(text: string, level: number | (typeof WORDS)[number]): string {
  if (showsInternals(level) || !/gateway/i.test(text)) return text;
  return text.replace(/(\b(?:the|a|an)\s+)?\bgateway\b(?![.\w-])/gi, (_match, article: string | undefined, offset: number, whole: string) => {
    if (article) {
      const up = article.trimStart()[0] === article.trimStart()[0].toUpperCase();
      const lower = article.trim().toLowerCase();
      if (lower === "a" || lower === "an") return up ? "An engine" : "an engine";
      return `${up ? "The" : "the"} engine`;
    }
    const sentenceStart = offset === 0 || /[.!?:;]\s*$/.test(whole.slice(0, offset));
    const capital = whole[offset] === "G";
    return sentenceStart || capital ? "The engine" : "the engine";
  });
}

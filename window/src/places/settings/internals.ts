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
const RAW_KEY = /\b[a-z][\w-]*(?:\.[\w*:@-]+|\[\d+\])+/g;

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

/** Whether a line names a raw settings key. Plain file names (memory.md, skills.yaml) are not keys. */
export const hasRawKey = (text: string): boolean =>
  [...text.matchAll(RAW_KEY)].some((match) => !isFileName(match[0]));

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

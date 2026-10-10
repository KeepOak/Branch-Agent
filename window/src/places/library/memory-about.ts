// Library › Memory › About you: USER.md starts as a developer template. Show a
// short summary of real facts, preserving inline markdown; hide template boilerplate, fences, HTML
// comments and docs links. Superseded directives stay out of the summary.

const TEMPLATE_LINES = new Set([
  "store stable user preferences and profile facts as directives that can guide future sessions.",
  "use one directive per entry:",
  "begin each directive with an imperative such as always, never, or prefer.",
  "record the observation date and either active or superseded on the metadata line.",
  "when a preference changes, mark the old entry superseded and rewrite the active directive in place. never append a contradictory active directive.",
  "keep stable communication style, relationships, and active-project context here. put durable non-profile facts and decisions in memory.md.",
  "save this file at the workspace root as user.md. it loads every session with a separate 4,000-character budget.",
  "replace the example below with a real directive and a real observation date before you save this file. never leave a placeholder directive active.",
]);

const PLACEHOLDER = /^(prefer|always|never)\s+\.\.\.$/i;
const EMPTY_FIELD = /^[^:]+:\s*$/;
const DOCS_LINK = /^\[[^\]]+\]\(\s*(\/|https?:|#)/i;
const HEADING = /^#{1,6}\s/;
const FENCE = /^```/;
const RULE = /^-{3,}$/;
const OBSERVED = /<!--\s*observed:[^>]*?\bstatus:\s*(\w+)\s*-->/gi;
const STATUS_MARK = /^\0status:(\w+)$/;

function stripFrontMatter(content: string): string {
  return content.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "");
}

function normalize(line: string): string {
  return line.toLowerCase().replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function bulletText(line: string): string {
  return line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
}

function isTemplateLine(line: string): boolean {
  return TEMPLATE_LINES.has(normalize(line));
}

/** Real facts with inline markdown, or "" for an empty file or a bundled template. */
export function aboutYouSummary(content: string): string {
  // The fixed development persona is not a profile of the person using Library.
  if (/^This is the fixed profile that `branch gateway --dev` seeds\b/m.test(content)) return "";
  const raw = stripFrontMatter(content.replace(/\r\n/g, "\n"))
    .replace(OBSERVED, (_all, status: string) => `\n\0status:${status.toLowerCase()}\n`)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?(```|$)/g, "");
  const kept: string[] = [];
  let skip = false;
  for (const original of raw.split("\n")) {
    const line = original.trim();
    const status = STATUS_MARK.exec(line);
    if (status) { skip = status[1] === "superseded"; continue; }
    if (!line || skip || HEADING.test(line) || FENCE.test(line) || RULE.test(line)) continue;
    const item = bulletText(line);
    if (DOCS_LINK.test(item) || isTemplateLine(item)) continue;
    const text = item.replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    if (!text || PLACEHOLDER.test(text) || EMPTY_FIELD.test(text)) continue;
    kept.push(item);
  }
  return kept.join("\n");
}

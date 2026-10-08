// Library › Memory › About you: USER.md starts as a developer template. Show a
// short plain summary of real facts; hide template boilerplate, fences, HTML
// comments and docs links.

const TEMPLATE_MARK = [
  "store stable user preferences and profile facts",
  "use one directive per entry",
  "begin each directive with an imperative",
  "record the observation date",
  "when a preference changes, mark the old entry",
  "keep stable communication style, relationships",
  "save this file at the workspace root",
  "replace the example below with a real directive",
  "never leave a placeholder directive",
  "put durable non-profile facts",
];

const PLACEHOLDER = /^(prefer|always|never)\s+\.\.\.$/i;
const EMPTY_FIELD = /^[^:]+:\s*$/;
const DOCS_LINK = /^\[[^\]]+\]\(\s*(\/|https?:|#)/i;
const HEADING = /^#{1,6}\s/;
const FENCE = /^```/;
const RULE = /^-{3,}$/;

function stripFrontMatter(content: string): string {
  return content.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, "");
}

function bulletText(line: string): string {
  return line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "");
}

function isTemplateLine(line: string): boolean {
  const lower = line.toLowerCase();
  return TEMPLATE_MARK.some((mark) => lower.includes(mark));
}

/** Plain facts from USER.md, or "" when the file is empty or still the template. */
export function aboutYouSummary(content: string): string {
  const raw = stripFrontMatter(content.replace(/\r\n/g, "\n"))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?(```|$)/g, "");
  const kept: string[] = [];
  for (const original of raw.split("\n")) {
    const line = original.trim();
    if (!line || HEADING.test(line) || FENCE.test(line) || RULE.test(line)) continue;
    const item = bulletText(line);
    if (DOCS_LINK.test(item) || isTemplateLine(item)) continue;
    const text = item.replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
    if (!text || PLACEHOLDER.test(text) || EMPTY_FIELD.test(text)) continue;
    kept.push(text);
  }
  return kept.join("\n");
}

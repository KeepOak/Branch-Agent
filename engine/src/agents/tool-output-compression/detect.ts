// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/detect.go (atlas AGENT-LOOP-0349).
// Deterministic and fail-open: anything it is not confident about is "text".
// Not ported in this slice: unwrapping agent file tags and read-tool line gutters
// before detection (engine/filewrap.go, engine/listing.go).
import { looksConfig, looksTabular } from "./detect-structured.js";

export type ToolOutputContentType =
  | "json"
  | "log"
  | "code"
  | "diff"
  | "search-result"
  | "text"
  | "html"
  | "terminal"
  | "tabular"
  | "config";

/** Log lines carry a level token or a timestamp. */
const LOG_LINE_RE =
  /(\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|PANIC)\b|^\s*\[[A-Z]+\]|\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|\b\d{2}:\d{2}:\d{2}\b)/i;
const DIFF_LINE_RE = /^(diff --git |@@ |--- |\+\+\+ |[+-][^+-])/gm;
const SEARCH_LINE_RE = /^([./~A-Za-z0-9_-][^:\n]{0,240}:\d+(:\d+)?:|https?:\/\/\S+)/;
const CODE_KEYWORD_RE =
  /\b(func|package|import|def|class|function|return|const|let|var|public|private|protected|static|void|struct|interface|namespace|module|fn|impl|trait|export|async|await)\b/g;
const CODE_SYMBOL_RE = /(=>|::|->|\)\{|\) \{|;\n|^\s*#include|^\s*from .+ import )/g;
/** A raw ANSI/CSI escape is the conclusive terminal signal. */
// oxlint-disable-next-line no-control-regex -- the escape byte is the signal being detected.
const ANSI_ESC_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/;
const CODE_PREFIXES = [
  "import ",
  "export ",
  "package ",
  "func ",
  "def ",
  "const ",
  "#include",
  "#!",
  "//",
  "/*",
];
const CODE_LINE_STARTS = [
  "\nimport ",
  "\nexport ",
  "\npackage ",
  "\nfunc ",
  "\ndef ",
  "\nclass ",
  "\nconst ",
];
const HTML_CONTAINERS = ["<body", "<article", "<main", "<div", "<p>", "<p "];

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function countMatches(text: string, re: RegExp, limit = Number.POSITIVE_INFINITY): number {
  let count = 0;
  const matches = text.matchAll(re);
  while (count < limit && !matches.next().done) {
    count++;
  }
  return count;
}

function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** ANSI escapes are conclusive; three bare carriage returns (a redrawn progress bar) also count. */
function looksLikeTerminal(input: string): boolean {
  return ANSI_ESC_RE.test(input) || countOf(input, "\r") - countOf(input, "\r\n") >= 3;
}

function looksLikeDiff(input: string): boolean {
  const marked =
    input.includes("\n@@ ") ||
    input.includes("diff --git ") ||
    (input.includes("\n--- ") && input.includes("\n+++ "));
  return marked && countMatches(input, DIFF_LINE_RE, 4) >= 4;
}

/** Source syntax an HTML document would not carry, so JSX and markup-bearing source route to code. */
function hasCodeStructure(input: string): boolean {
  if (input.includes("=>") || input.includes("className=") || input.includes("});")) {
    return true;
  }
  const trimmed = input.trim();
  return (
    CODE_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) ||
    CODE_LINE_STARTS.some((start) => input.includes(start))
  );
}

function looksLikeHtml(input: string): boolean {
  const s = input.trim().toLowerCase();
  if (s.startsWith("<!doctype html") || s.startsWith("<html")) {
    return true;
  }
  if (hasCodeStructure(input)) {
    return false;
  }
  return HTML_CONTAINERS.some((tag) => s.includes(tag)) && countOf(s, "<") >= 6;
}

function looksLikeLog(input: string): boolean {
  const lines = input.split("\n");
  if (lines.length < 4) {
    return false;
  }
  const matched = lines.filter((line) => LOG_LINE_RE.test(line)).length;
  return matched >= 3 && matched * 2 >= lines.length;
}

/** A log whose messages contain code keywords is still a log. */
function looksLikeCode(input: string): boolean {
  if (looksLikeLog(input)) {
    return false;
  }
  if (input.trim().startsWith("#!")) {
    return true;
  }
  const keywords = countMatches(input, CODE_KEYWORD_RE);
  const structural =
    countMatches(input, CODE_SYMBOL_RE, 1) >= 1 ||
    input.includes("{") ||
    (input.includes("def ") && input.includes(":")) ||
    input.includes("\n    ");
  return keywords >= 3 && structural;
}

function looksLikeSearchResult(input: string): boolean {
  const lines = input.split("\n");
  if (lines.length < 6) {
    return false;
  }
  const matched = lines.filter((line) => SEARCH_LINE_RE.test(line)).length;
  return matched >= 4 && matched * 3 >= lines.length;
}

/** Classifies a tool output. Order: strict JSON, terminal, diff, HTML, table, code, log, search, config. */
export function detectContentType(input: string): ToolOutputContentType {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return "text";
  }
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && isValidJson(trimmed)) {
    return "json";
  }
  const ordered: Array<[ToolOutputContentType, (text: string) => boolean]> = [
    ["terminal", looksLikeTerminal],
    ["diff", looksLikeDiff],
    ["html", looksLikeHtml],
    ["tabular", looksTabular],
    ["code", looksLikeCode],
    ["log", looksLikeLog],
    ["search-result", looksLikeSearchResult],
    ["config", looksConfig],
  ];
  return ordered.find(([, test]) => test(input))?.[0] ?? "text";
}

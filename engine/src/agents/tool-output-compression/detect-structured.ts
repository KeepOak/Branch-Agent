// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/tabular.go (LooksTabular, parseTable, parseMarkdownTable)
// and engine/compressors/config.go (LooksConfig, parseConfig, validYAML) (atlas AGENT-LOOP-0349).
// readStrictCsv follows Go encoding/csv with LazyQuotes off: bare quotes and stray
// characters after a closing quote are errors, and every record must match the first.
import { parseAllDocuments } from "yaml";
import { isWellFormedText, splitLines } from "./line-ends.js";

const MARKDOWN_SEPARATOR_CELL_RE = /^:?-{3,}:?$/;
const YAML_KEY_RE = /^\s*(?:-\s*)?[A-Za-z0-9_.-]+\s*:\s*/;
const CONFIG_ASSIGNMENT_RE = /^\s*[A-Za-z0-9_.-]+\s*=\s*\S/;
const CONFIG_SECTION_RE = /^\s*\[[A-Za-z0-9_.:"' -]+\]\s*(?:[#;].*)?$/;
const YAML_BLOCK_SCALAR_RE = /:\s*[|>][0-9+-]*\s*(?:#.*)?$/;

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function readQuotedField(text: string, start: number, delimiter: string) {
  let pos = start + 1;
  let field = "";
  while (true) {
    const quote = text.indexOf('"', pos);
    if (quote < 0) {
      return undefined;
    }
    field += text.slice(pos, quote);
    pos = quote + 1;
    const next = text[pos];
    if (next === '"') {
      field += '"';
      pos++;
    } else if (next === delimiter || next === "\n" || next === undefined) {
      return { field, pos };
    } else {
      return undefined;
    }
  }
}

function readField(text: string, start: number, delimiter: string) {
  if (text[start] === '"') {
    return readQuotedField(text, start, delimiter);
  }
  let pos = start;
  while (pos < text.length && text[pos] !== delimiter && text[pos] !== "\n") {
    pos++;
  }
  const field = text.slice(start, pos);
  return field.includes('"') ? undefined : { field, pos };
}

/** Strict CSV/TSV reader matching Go encoding/csv defaults; undefined on any parse error. */
export function readStrictCsv(input: string, delimiter: string): string[][] | undefined {
  let text = input.replaceAll("\r\n", "\n");
  text = text.endsWith("\r") ? text.slice(0, -1) : text;
  const rows: string[][] = [];
  let pos = 0;
  while (pos < text.length) {
    if (text[pos] === "\n") {
      pos++;
      continue;
    }
    const row: string[] = [];
    while (true) {
      const read = readField(text, pos, delimiter);
      if (!read) {
        return undefined;
      }
      row.push(read.field);
      pos = read.pos + 1;
      if (text[read.pos] !== delimiter) {
        break;
      }
    }
    if (rows.length > 0 && row.length !== rows[0]?.length) {
      return undefined;
    }
    rows.push(row);
  }
  return rows;
}

function parseMarkdownTable(input: string): string[][] | undefined {
  const normalized = input.replaceAll("\r\n", "\n");
  const raw = (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
  if (raw.length < 3) {
    return undefined;
  }
  const rows: string[][] = [];
  for (const line of raw) {
    const text = line.trim();
    if (!text.startsWith("|") || !text.endsWith("|")) {
      return undefined;
    }
    rows.push(
      text
        .replace(/^\|+|\|+$/g, "")
        .split("|")
        .map((part) => part.trim()),
    );
  }
  const width = rows[0]?.length ?? 0;
  const separator = rows[1] ?? [];
  if (width < 2 || separator.length !== width) {
    return undefined;
  }
  if (!separator.every((cell) => MARKDOWN_SEPARATOR_CELL_RE.test(cell))) {
    return undefined;
  }
  return rows.slice(2).every((row) => row.length === width) ? rows : undefined;
}

function parseTable(input: string): string[][] | undefined {
  if (!isWellFormedText(input) || input.trim().length === 0) {
    return undefined;
  }
  const markdown = parseMarkdownTable(input);
  if (markdown) {
    return markdown;
  }
  const firstLine = input.trim().split("\n")[0] ?? "";
  const tabs = countOf(firstLine, "\t");
  const delimiter = tabs >= 1 && tabs > countOf(firstLine, ",") ? "\t" : ",";
  if (countOf(firstLine, delimiter) < 1) {
    return undefined;
  }
  const rows = readStrictCsv(input, delimiter);
  const fields = rows?.[0]?.length ?? 0;
  return rows && rows.length >= 2 && fields >= 2 && fields <= 128 ? rows : undefined;
}

/** A strict CSV, TSV or Markdown table with at least eight rows. */
export function looksTabular(input: string): boolean {
  const rows = parseTable(input);
  return rows !== undefined && rows.length >= 8;
}

function validYaml(input: string): boolean {
  try {
    const documents = parseAllDocuments(input);
    return (
      Array.isArray(documents) &&
      documents.length > 0 &&
      documents.every((document) => document.errors.length === 0)
    );
  } catch {
    return false;
  }
}

type ConfigCounts = {
  yamlKeys: number;
  assignments: number;
  sections: number;
  prose: number;
  blockScalar: boolean;
};

function countConfigLines(lines: string[]): ConfigCounts {
  const counts: ConfigCounts = {
    yamlKeys: 0,
    assignments: 0,
    sections: 0,
    prose: 0,
    blockScalar: false,
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    counts.blockScalar ||= YAML_BLOCK_SCALAR_RE.test(line);
    if (CONFIG_SECTION_RE.test(line)) {
      counts.sections++;
    } else if (CONFIG_ASSIGNMENT_RE.test(line)) {
      counts.assignments++;
    } else if (YAML_KEY_RE.test(line)) {
      counts.yamlKeys++;
    } else if (!line.startsWith("- ")) {
      counts.prose++;
    }
  }
  return counts;
}

function parseConfig(input: string): string[] | undefined {
  if (!isWellFormedText(input) || input.trim().length === 0) {
    return undefined;
  }
  const { lines } = splitLines(input);
  const c = countConfigLines(lines);
  const significant = c.yamlKeys + c.assignments + c.sections + c.prose;
  if (significant === 0) {
    return undefined;
  }
  if (
    c.sections >= 2 &&
    c.assignments >= 4 &&
    c.prose === 0 &&
    !input.includes('"""') &&
    !input.includes("'''")
  ) {
    return lines;
  }
  const yamlShaped = c.yamlKeys >= 6 && c.yamlKeys * 2 >= significant && c.prose * 4 <= significant;
  return yamlShaped && !c.blockScalar && validYaml(input) ? lines : undefined;
}

/** Dense YAML, TOML or INI with at least twelve lines. */
export function looksConfig(input: string): boolean {
  const lines = parseConfig(input);
  return lines !== undefined && lines.length >= 12;
}

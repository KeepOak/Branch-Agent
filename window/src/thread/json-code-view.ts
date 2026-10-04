import { createScanner, parseTree, type Node, type ParseError } from "jsonc-parser";

export type JsonCode = { text: string; root?: Node };
// Existing native JSON tree budgets; complete Raw and Copy source remain available.
const MAX_JSON_CHARS = 20_000, MAX_JSON_DEPTH = 64, MAX_JSON_TOKENS = 4_000;

/** Native markdown-json.ts scanner/AST contract preserves member order and numeric lexemes. */
export function parseJsonCode(text: string): JsonCode | null {
  if (text.length > MAX_JSON_CHARS) {
    try { JSON.parse(text); return { text }; } catch { return null; }
  }
  const scanner = createScanner(text, true);
  let depth = 0, tokens = 0;
  for (scanner.scan(); scanner.getTokenLength() > 0; scanner.scan()) {
    const delimiter = text[scanner.getTokenOffset()];
    if (delimiter === "{" || delimiter === "[") depth++;
    if (delimiter === "}" || delimiter === "]") depth--;
    if (depth > MAX_JSON_DEPTH || ++tokens > MAX_JSON_TOKENS) {
      try { JSON.parse(text); return { text }; } catch { return null; }
    }
  }
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  return root && errors.length === 0 ? { text, root } : null;
}

// Cline rule semantics, pinned at 0809928ab28783c0d2b41c1e56edaf0951dadcab.
import picomatch from "picomatch";
import { parseDocument } from "yaml";

export function parseExternalRule(markdown: string): {
  data: Record<string, unknown>;
  body: string;
  parseError?: string;
} {
  const normalized = markdown.replace(/^\uFEFF/u, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) {
    return { data: {}, body: normalized };
  }
  try {
    // YAML 1.2 core retains the donor JSON_SCHEMA's ordinary plain strings.
    const document = parseDocument(match[1]!, { schema: "core" });
    const issue = document.errors[0] ?? document.warnings[0];
    if (issue) {
      throw issue;
    }
    const parsed: unknown = document.toJS({ maxAliasCount: -1 });
    const data =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { data, body: match[2]! };
  } catch (error) {
    return { data: {}, body: normalized, parseError: String(error) };
  }
}

export function externalRuleMatches(
  data: Record<string, unknown>,
  candidates: string[],
): { passed: boolean; matched: string[] } {
  const paths = data.paths;
  if (
    !Array.isArray(paths) ||
    !paths.every((value) => typeof value === "string" && value.length > 0)
  ) {
    return { passed: true, matched: [] };
  }
  const patterns: string[] = paths.map((value: string) => value.trim()).filter(Boolean);
  const normalized = candidates.map((value) => value.replaceAll("\\", "/")).filter(Boolean);
  const matched = patterns.filter((pattern) => {
    const matcher = picomatch(pattern, { dot: true });
    return normalized.some((candidate) => matcher(candidate));
  });
  return { passed: matched.length > 0, matched };
}

/** Exact donor request hints; these do not normalize admitted filesystem names. */
export function extractExternalRulePaths(text: string): string[] {
  const cleaned = text.replace(/```[\s\S]*?```/gu, " ").replace(/\b\w+:\/\/[^\s]+/gu, " ");
  const token =
    /(?:^|[\s([{"'`])((?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?|[A-Za-z0-9_.-]+\.[A-Za-z0-9]{1,10}))(?=$|[\s)\]}"'`,.;:!?])/gu;
  const paths = new Set<string>();
  for (const match of cleaned.matchAll(token)) {
    const token = match[1]!;
    const candidate = token.startsWith("./") ? token.slice(2) : token;
    if (
      candidate.length <= 300 &&
      candidate !== "/" &&
      !candidate.startsWith("/") &&
      !candidate.includes("..")
    ) {
      paths.add(candidate.replaceAll("\\", "/"));
    }
  }
  return [...paths];
}

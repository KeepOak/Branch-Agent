// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// packages/core/src/runtime/fact-write-dedupe.ts.
// Structural write-time dedupe for Markdown memory entries: before an entry is
// added, find an existing entry with the same normalized text in the same file
// (Branch's equivalent of eliza's room + entity scope) so the write is skipped
// and the existing entry is reported back. Equivalence is canonical text
// equality, not semantic similarity; paraphrase-level dedupe stays with rings.

/** Bounded to the same recent window eliza's FACTS reader uses. */
export const DEDUPE_CANDIDATE_POOL = 120;

/**
 * Canonical form for fact-text equality: case-, punctuation-, and
 * whitespace-insensitive, unicode-aware. An empty key never matches (so
 * punctuation-only or empty texts are never deduped against each other).
 */
export function normalizeFactTextKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type MemoryEntryLine = {
  /** Zero-based line index in the file. */
  index: number;
  /** Full original line, including any list marker. */
  line: string;
  /** Leading indentation plus list marker (for example "- " or "  1. "). */
  prefix: string;
  /** Entry text without the list marker. */
  text: string;
};

const LIST_MARKER = /^(\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/u;

/** Markdown lines that carry memory entries: not blank, headings, comments or fences. */
export function listMemoryEntryLines(content: string): MemoryEntryLine[] {
  const entries: MemoryEntryLine[] = [];
  let inFence = false;
  const lines = content.split("\n");
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r$/u, "");
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed || trimmed.startsWith("#") || trimmed.startsWith("<!--")) {
      continue;
    }
    const prefix = LIST_MARKER.exec(line)?.[1] ?? "";
    entries.push({ index, line, prefix, text: line.slice(prefix.length).trim() });
  }
  return entries;
}

/**
 * Returns the existing entry equivalent to `text` (same normalized text in the
 * same file), or null when the write should proceed. The candidate pool is
 * bounded to the most recent entries, so a very deep file degrades to a plain
 * append rather than an error.
 */
export function findEquivalentMemoryEntry(content: string, text: string): MemoryEntryLine | null {
  const key = normalizeFactTextKey(text);
  if (!key) {
    return null;
  }
  const candidates = listMemoryEntryLines(content).slice(-DEDUPE_CANDIDATE_POOL);
  for (const candidate of candidates) {
    if (normalizeFactTextKey(candidate.text) === key) {
      return candidate;
    }
  }
  return null;
}

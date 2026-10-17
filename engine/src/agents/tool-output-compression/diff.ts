// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/diff.go (atlas AGENT-LOOP-0349).
// Keeps file/hunk headers plus changed lines and collapses long runs of unchanged
// context. Lossy: callers only use it when the full original is stored.
import { crSuffix, isWellFormedText, joinLines, splitLines, synthLine } from "./line-ends.js";

const DIFF_MARKER_RE = /^… \d+ context lines elided …\r?$/;
const KEEP_CONTEXT = 2;
const MIN_LINES = 12;
const STRUCTURAL_PREFIXES = ["diff --git ", "index ", "--- ", "+++ ", "@@ "];

function diffMarker(n: number): string {
  return `… ${n} context lines elided …`;
}

/**
 * An added/removed hunk line. A bare "+" or "-" is a change too (git's rendering
 * of an added or deleted blank line), and content that itself starts with "+" or
 * "-" is still a change, so only the first character is checked.
 */
function isChangedDiffLine(line: string): boolean {
  return line.startsWith("+") || line.startsWith("-");
}

function isDiffStructuralLine(line: string): boolean {
  return STRUCTURAL_PREFIXES.some((prefix) => line.startsWith(prefix)) || isChangedDiffLine(line);
}

function selectDiffLines(lines: string[]): boolean[] {
  const keep = lines.map(() => false);
  lines.forEach((line, i) => {
    if (!isDiffStructuralLine(line) && !DIFF_MARKER_RE.test(line)) {
      return;
    }
    const last = Math.min(lines.length - 1, i + KEEP_CONTEXT);
    for (let j = Math.max(0, i - KEEP_CONTEXT); j <= last; j++) {
      keep[j] = true;
    }
  });
  return keep;
}

/** Compresses a unified diff; undefined means pass the original through unchanged. */
export function compressDiff(input: string): string | undefined {
  if (!isWellFormedText(input)) {
    return undefined;
  }
  const { lines, trailing } = splitLines(input);
  if (lines.length < MIN_LINES) {
    return undefined;
  }
  const cr = crSuffix(input);
  const keep = selectDiffLines(lines);
  const out: string[] = [];
  let dropped = 0;
  lines.forEach((line, i) => {
    if (!keep[i]) {
      dropped++;
      return;
    }
    if (dropped > 0) {
      out.push(synthLine(diffMarker(dropped), cr));
      dropped = 0;
    }
    out.push(line);
  });
  if (dropped > 0) {
    out.push(synthLine(diffMarker(dropped), cr));
  }
  return out.length === lines.length ? undefined : joinLines(out, trailing);
}

// From JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/log.go and the elision helpers in engine/compressors/invariants.go (atlas AGENT-LOOP-0349).
// Keeps errors, stack frames and the first/last lines, and collapses runs of
// repetitive INFO/DEBUG/progress noise into one marker line. Lossy: callers only
// use it when the full original is stored and retrievable.
// Not ported in this slice: the per-run invariant summary (summarizeElided). A run
// with no summary is elided on its count alone, which is upstream's own rule.

import {
  crSuffix,
  isWellFormedText,
  joinLines,
  splitLines,
  synthLine,
  utf8Length,
} from "./line-ends.js";
import { keepNonRedundant } from "./redundancy.js";
import { keepQueryRelevant } from "./relevance.js";

/** Lines worth keeping: errors, failures, warnings, stack-trace frames. */
export const IMPORTANT_LINE_RE =
  /(\b(ERROR|FATAL|PANIC|EXCEPTION|TRACEBACK|FAIL|FAILED|FAILURE|WARN|WARNING)\b|^\s+at\s|^\s+File "|\.go:\d+|^\s+--->|caused by)/i;
/** Markers from an earlier pass are kept so the compressor stays idempotent. */
const LOG_MARKER_RE = /^… \d+ lines elided …\r?$/;
/** Opens the one-per-payload contract line; detected on re-entry so it is never duplicated. */
export const ELISION_NOTE_PREFIX = "… elided ";
/** A payload must drop this many bytes before it can afford the contract line. */
const ELISION_NOTE_MIN_ELIDED_BYTES = 4096;
/** The smallest run collapsed on the strength of its count alone. */
const INVARIANT_MIN_ELIDE_UNITS = 3;
const KEEP_HEAD = 2;
const KEEP_TAIL = 2;
const IMPORTANT_LITERALS = [
  "error",
  "fatal",
  "panic",
  "exception",
  "traceback",
  "fail",
  "warn",
  ".go:",
  "caused by",
];

function hasNonAscii(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) >= 0x80) {
      return true;
    }
  }
  return false;
}

/** Fast filter with the same answers as IMPORTANT_LINE_RE. */
export function importantLogLine(line: string): boolean {
  if (line.length === 0) {
    return false;
  }
  if (line.charCodeAt(0) <= 0x20 || hasNonAscii(line)) {
    return IMPORTANT_LINE_RE.test(line);
  }
  const lower = line.toLowerCase();
  return (
    IMPORTANT_LITERALS.some((literal) => lower.includes(literal)) && IMPORTANT_LINE_RE.test(line)
  );
}

function logMarker(n: number): string {
  return `… ${n} lines elided …`;
}

/** The trailing line that tells the agent how to read a view with elided units. */
export function elisionNote(unit: string): string {
  return (
    ELISION_NOTE_PREFIX +
    unit +
    " resemble shown " +
    unit +
    ". Answer from this view; if you truly cannot, read the full output once …"
  );
}

function isNoteOrMarker(line: string): boolean {
  return line.startsWith(ELISION_NOTE_PREFIX) || LOG_MARKER_RE.test(line);
}

function selectLogLines(lines: string[]): boolean[] {
  const keep = lines.map(
    (line, i) => i < KEEP_HEAD || importantLogLine(line) || isNoteOrMarker(line),
  );
  // The tail window counts real log lines, so a contract line from an earlier
  // pass cannot push the last real line out and make a second pass differ.
  for (let i = lines.length - 1, budget = KEEP_TAIL; i >= KEEP_HEAD && budget > 0; i--) {
    keep[i] = true;
    if (!isNoteOrMarker(lines[i] ?? "")) {
      budget--;
    }
  }
  return keep;
}

function elideRuns(
  lines: string[],
  keep: boolean[],
  cr: string,
): { out: string[]; elidedBytes: number } {
  const out: string[] = [];
  let run: string[] = [];
  let elidedBytes = 0;
  const flush = () => {
    if (run.length >= INVARIANT_MIN_ELIDE_UNITS) {
      out.push(synthLine(logMarker(run.length), cr));
      elidedBytes += run.reduce((sum, line) => sum + utf8Length(line) + 1, 0);
    } else {
      out.push(...run);
    }
    run = [];
  };
  lines.forEach((line, i) => {
    if (keep[i]) {
      flush();
      out.push(line);
    } else {
      run.push(line);
    }
  });
  flush();
  return { out, elidedBytes };
}

/** Compresses a log; undefined means pass the original through unchanged. */
export function compressLog(input: string, query = ""): string | undefined {
  if (!isWellFormedText(input)) {
    return undefined;
  }
  const { lines, trailing } = splitLines(input);
  if (lines.length < 4) {
    return undefined;
  }
  const cr = crSuffix(input);
  const keep = selectLogLines(lines);
  keepQueryRelevant(keep, lines, query, 16, 0.3);
  keepNonRedundant(lines, keep);
  const { out, elidedBytes } = elideRuns(lines, keep, cr);
  if (elidedBytes >= ELISION_NOTE_MIN_ELIDED_BYTES && !input.includes(ELISION_NOTE_PREFIX)) {
    out.push(synthLine(elisionNote("lines"), cr));
  }
  return joinLines(out, trailing);
}

// Unicode normalization wrapper.
/// <reference lib="es2024.string" />

/**
 * Returns `text` with every lone surrogate replaced by U+FFFD. Well-formed
 * input is returned as the same string instance (the native fast path scans
 * without allocating).
 */
function toWellFormedUnicode(text: string): string {
  return text.toWellFormed();
}

// Trim the router's error narration to a single short, user-readable clause:
// drop leading label/emoji/quote annotations and skip bare internal codes.
export function extractFailureReason(errorOutput: string): string {
  const lines = errorOutput.replace(/\r\n/g, "\n").split("\n");
  const firstLine = lines
    .map((line) =>
      line
        .replace(/^[\s>*•-]+/, "")
        .replace(/^\[[^\]]*\]\s*/, "")
        .trim(),
    )
    .find((line) => line.length > 0 && /\s/.test(line));
  if (!firstLine) return "";
  return toWellFormedUnicode(firstLine);
}

export function buildFailureReply(label: string, reason: string): string {
  const what = label ? `the "${label}" task` : "that task";
  const normalizedReason = reason.replace(/[.!?]+$/u, "");
  const because = normalizedReason ? ` — ${normalizedReason}` : "";
  return `Couldn't finish ${what}${because}. Want me to retry?`;
}

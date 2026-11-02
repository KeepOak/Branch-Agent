// A commit or build hash: 12+ hex characters with at least one digit and one a-f letter.
// All-digit runs such as order numbers are not hashes and stay visible.
const HASH = String.raw`\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,64}\b`;
// A hash goes together with the label it belongs to, so the line does not end in a fragment:
// - a label joined to it, such as "head=", "sha:" or "-build-" in "0.4.4-build-1f28...";
// - a spaced label such as "head:", "commit" or "Final head:", with an optional lead-in word.
const JOINED_LABEL = String.raw`(?:[-_+.@]?[a-z][a-z0-9]*)*[-_+.@=:]`;
const LEAD_IN = String.raw`(?:(?:final|new|old|base|current|latest|at|in|on|from|to|of|as)\s+)?`;
const SPACED_LABEL = String.raw`${LEAD_IN}\b(?:head|sha|commit|build|hash|rev|revision|ref)\b\s*[:=#]?\s*`;
const HASH_RE = new RegExp(`(?:${SPACED_LABEL}|${JOINED_LABEL})?${HASH}`, "giu");
// Machine review markers that agents post for each other, not for people.
const MARKER_RE = /\bbranch-verdict:\s*/giu;

/** The last-message line on an agent card, without hashes or review markers (#1927). */
export function agentCardPreviewText(preview: string | null | undefined): string {
  if (!preview) {
    return "";
  }
  return preview
    .replace(MARKER_RE, "")
    .replace(HASH_RE, "")
    .replace(/\(\s*\)|\[\s*\]/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
}

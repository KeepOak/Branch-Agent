// Commit and build hashes (12+ hex characters with at least one digit), with an optional key such as "head=".
const HASH_RE = /(?:\b[\w-]+=)?\b(?=[0-9a-f]*\d)[0-9a-f]{12,64}\b/giu;
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
    .replace(/\s+/gu, " ")
    .trim();
}

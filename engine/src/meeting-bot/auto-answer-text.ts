// Copied from Natively-AI-assistant/natively-cluely-ai-assistant@39293c97a9d38ae19c8e1fbb7f9d391f9f2f6587:electron/intelligence/autoAnswer/AutoAnswerText.ts (atlas VOICE-0140)
/**
 * The text utilities the auto-answer judge needs: grounding a model-extracted
 * question in the candidate it came from. Pure, no state, no I/O.
 */

export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenContainment(needle: string, haystack: string): number {
  const nq = normalizeForCompare(needle).split(" ").filter(Boolean);
  if (nq.length === 0) {
    return 0;
  }
  const have = new Set(normalizeForCompare(haystack).split(" ").filter(Boolean));
  let hit = 0;
  for (const t of nq) {
    if (have.has(t)) {
      hit++;
    }
  }
  return hit / nq.length;
}

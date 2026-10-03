import { normalizeSessionKeyForUiComparison } from "../sessions/session-key.ts";
import { isActiveCanopyCard } from "./card-state.ts";
import type { CanopyCard } from "./types.ts";

// These reserved names exist per agent; a saved card key alone cannot identify one.
export function isReservedSessionKey(sessionKey: string): boolean {
  const key = normalizeSessionKeyForUiComparison(sessionKey);
  return key === "global" || key === "unknown";
}

function canopySessionLookupKeys(sessionKey: string): string[] {
  const key = normalizeSessionKeyForUiComparison(sessionKey);
  if (!key) {
    return [];
  }
  // Only a stored agentless Canopy link is provisional. Never collapse two
  // explicit agent identities just because their local session tails agree.
  const suffixIndex = key.lastIndexOf(":subagent:canopy-");
  return suffixIndex < 0 ? [key] : [key, key.slice(suffixIndex + 1)];
}

export function canopySessionKeyMatches(
  candidate: string | undefined,
  linkedSessionKey: string,
): boolean {
  return Boolean(
    candidate &&
    canopySessionLookupKeys(candidate).includes(
      normalizeSessionKeyForUiComparison(linkedSessionKey),
    ),
  );
}

function cardSessionKeys(card: CanopyCard): string[] {
  return [
    card.sessionKey,
    card.execution?.sessionKey,
    ...(card.metadata?.attempts?.map((attempt) => attempt.sessionKey) ?? []),
    ...(card.events?.map((event) => event.sessionKey) ?? []),
  ]
    .filter((key): key is string => typeof key === "string")
    .map(normalizeSessionKeyForUiComparison)
    .filter(Boolean);
}

function compareSessionCards(left: CanopyCard, right: CanopyCard): number {
  return (
    Number(!isActiveCanopyCard(left)) - Number(!isActiveCanopyCard(right)) ||
    right.updatedAt - left.updatedAt
  );
}

function indexCanopySessionCards(cards: readonly CanopyCard[]): Map<string, CanopyCard> {
  const index = new Map<string, CanopyCard>();
  for (const card of cards) {
    for (const key of cardSessionKeys(card)) {
      const previous = index.get(key);
      if (!previous || compareSessionCards(card, previous) < 0) {
        index.set(key, card);
      }
    }
  }
  return index;
}

export function findCanopySessionCard(
  cards: readonly CanopyCard[],
  sessionKey: string,
): CanopyCard | null {
  if (isReservedSessionKey(sessionKey)) {
    return null;
  }
  // A local session tail cannot establish its agent owner. Provisional link
  // resolution belongs to session-resolution; this lookup needs recorded identity.
  const key = normalizeSessionKeyForUiComparison(sessionKey);
  return indexCanopySessionCards(cards).get(key) ?? null;
}

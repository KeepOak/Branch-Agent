import type { CanopyCard } from "@branch/canopy-contract";
import { cardBoardId, cardRunId, cardSessionKey } from "./store-card-helpers.js";

function sanitizeSessionSegment(value: string | undefined, fallback: string): string {
  const sanitized = (value ?? fallback)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (sanitized || fallback).slice(0, 96);
}

export function canopySessionKeyForCard(card: CanopyCard): string {
  const boardId = sanitizeSessionSegment(cardBoardId(card), "default");
  const cardId = sanitizeSessionSegment(card.id, "card");
  const suffix = `subagent:canopy-${boardId}-${cardId}`;
  return card.agentId ? `agent:${sanitizeSessionSegment(card.agentId, "agent")}:${suffix}` : suffix;
}

function sessionKeyMatchesCard(candidate: string, cardKey: string): boolean {
  return (
    candidate === cardKey ||
    (cardKey.startsWith("subagent:canopy-") && candidate.endsWith(`:${cardKey}`))
  );
}

export function canopyCardMatchesLifecycleLink(
  card: CanopyCard,
  source: { sessionKey?: string; runId?: string },
): boolean {
  const linkedSessionKey = cardSessionKey(card);
  const sessionMatches = Boolean(
    source.sessionKey &&
    (linkedSessionKey
      ? sessionKeyMatchesCard(source.sessionKey, linkedSessionKey)
      : sessionKeyMatchesCard(source.sessionKey, canopySessionKeyForCard(card))),
  );
  const linkedRunId = cardRunId(card);
  if (linkedRunId && source.runId) {
    if (source.runId !== linkedRunId && !linkedRunId.startsWith(`canopy:${card.id}:`)) {
      return false;
    }
    return linkedSessionKey && source.sessionKey ? sessionMatches : true;
  }
  return sessionMatches;
}

export function canopyCardSessionLookupKey(card: CanopyCard): string {
  return cardSessionKey(card) ?? canopySessionKeyForCard(card);
}

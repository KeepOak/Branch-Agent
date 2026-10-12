import type { GatewaySessionRow } from "../../api/types.ts";
import { getCanopyLifecycle } from "./lifecycle.ts";
import type { CanopyCard, CanopyHealthKey, CanopyUiState } from "./types.ts";

const CANOPY_RECENT_DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function hasCanopyProofEvidence(card: CanopyCard): boolean {
  return Boolean(
    card.metadata?.proof?.length ||
    card.metadata?.artifacts?.length ||
    card.metadata?.attachments?.length,
  );
}

export function canopyCardMatchesHealthKey(
  card: CanopyCard,
  key: CanopyHealthKey,
  sessions: readonly GatewaySessionRow[],
): boolean {
  switch (key) {
    case "stale":
      return Boolean(card.metadata?.stale || getCanopyLifecycle(card, sessions).state === key);
    case "missingProof":
      return card.status === "done" && !hasCanopyProofEvidence(card);
  }
  return false;
}

export function filterCanopyCards(params: {
  cards: readonly CanopyCard[];
  filters: Pick<
    CanopyUiState,
    "statusFilter" | "priorityFilter" | "attentionFilter" | "donePeriod"
  >;
  sessions: readonly GatewaySessionRow[];
  now: number;
  ignore?: "status" | "priority" | "attention";
}): CanopyCard[] {
  const { statusFilter, priorityFilter, attentionFilter, donePeriod } = params.filters;
  return params.cards.filter((card) => {
    if (params.ignore !== "status" && statusFilter.size && !statusFilter.has(card.status)) {
      return false;
    }
    if (params.ignore !== "priority" && priorityFilter.size && !priorityFilter.has(card.priority)) {
      return false;
    }
    if (
      params.ignore !== "attention" &&
      attentionFilter.size &&
      ![...attentionFilter].some((key) => canopyCardMatchesHealthKey(card, key, params.sessions))
    ) {
      return false;
    }
    // The completion window trims history without hiding unfinished work.
    return (
      donePeriod === "all" ||
      card.status !== "done" ||
      (card.completedAt ?? card.updatedAt) >= params.now - CANOPY_RECENT_DONE_WINDOW_MS
    );
  });
}

import { normalizeUniqueTrimmedStringList } from "branch/plugin-sdk/string-coerce-runtime";
import type { GatewaySessionRow } from "../../api/types.ts";
import { matchesBoardFilter } from "./board-filter.ts";
import type {
  CanopyCard,
  CanopyDependencyState,
  CanopyMetadata,
  CanopyStaleState,
  CanopyStatus,
  CanopyTemplateId,
  CanopyUiState,
} from "./types.ts";

const CANOPY_STALE_SESSION_MS = 30 * 60 * 1000;

export function isActiveCanopyCard(card: CanopyCard): boolean {
  return !card.metadata?.archivedAt;
}

export function nextCanopyCardPosition(
  cards: readonly CanopyCard[],
  card: CanopyCard,
  status: CanopyStatus,
): number {
  const boardId = card.metadata?.automation?.boardId?.trim() || "default";
  const positions = cards
    .filter(
      (candidate) =>
        candidate.id !== card.id &&
        candidate.status === status &&
        (candidate.metadata?.automation?.boardId?.trim() || "default") === boardId,
    )
    .map((candidate) => candidate.position);
  // Archived cards still own their persisted positions in the canonical store.
  return Math.max(0, ...positions) + 1000;
}

type CanopyCardDropMove =
  | { id: string; status: CanopyStatus; position: number }
  | { id: string; expectedUpdatedAt: number; position: number };

export function planCanopyCardDrop(
  cards: readonly CanopyCard[],
  card: CanopyCard,
  status: CanopyStatus,
  beforeCardId: string | null,
  boardFilter: CanopyUiState["boardFilter"],
): CanopyCardDropMove[] {
  const peers = cards
    .filter(
      (candidate) =>
        candidate.id !== card.id &&
        candidate.status === status &&
        matchesBoardFilter(candidate, boardFilter),
    )
    .toSorted((left, right) => left.position - right.position || left.createdAt - right.createdAt);
  const beforeIndex = peers.findIndex((candidate) => candidate.id === beforeCardId);
  const index = beforeIndex < 0 ? peers.length : beforeIndex;
  const previous = peers[index - 1]?.position ?? -1;
  const next = peers[index]?.position;
  if (
    card.status === status &&
    card.position > previous &&
    (next === undefined || card.position < next)
  ) {
    return [];
  }
  const position =
    next === undefined
      ? Math.max(0, previous) + 1000
      : next - previous > 1
        ? Math.floor((previous + next) / 2)
        : previous + 1000;
  const moves: CanopyCardDropMove[] = [];
  // Positions are nonnegative integers. Make room from the end when the gap is full.
  let occupied = position;
  for (const peer of peers.slice(index)) {
    if (peer.position > occupied) {
      break;
    }
    occupied += 1000;
    moves.push({ id: peer.id, expectedUpdatedAt: peer.updatedAt, position: occupied });
  }
  return [...moves.toReversed(), { id: card.id, status, position }];
}

export function selectedCanopyBoardParams(
  state: Pick<CanopyUiState, "boards" | "boardFilter">,
): { boardId?: string } {
  const boardId = state.boards.find((board) => board.id === state.boardFilter)?.id;
  return boardId ? { boardId } : {};
}

export function setCanopyCards(state: CanopyUiState, cards: CanopyCard[]) {
  state.cards = cards;
  const selectableIds = new Set(cards.filter(isActiveCanopyCard).map((card) => card.id));
  for (const id of state.selectedCardIds) {
    if (!selectableIds.has(id)) {
      state.selectedCardIds.delete(id);
    }
  }
  if (state.bulkDialog) {
    state.bulkDialog.cardIds = state.bulkDialog.cardIds.filter((id) =>
      state.selectedCardIds.has(id),
    );
    if (!state.bulkDialog.cardIds.length) {
      state.bulkDialog = null;
    }
  }
}

export function replaceCard(state: CanopyUiState, card: CanopyCard) {
  const next = state.cards.filter((existing) => existing.id !== card.id);
  next.push(card);
  setCanopyCards(
    state,
    next.toSorted((left, right) => left.position - right.position),
  );
}

function parentDependencyIds(card: CanopyCard): string[] {
  return normalizeUniqueTrimmedStringList(
    card.metadata?.links?.filter((link) => link.type === "parent").map((link) => link.targetCardId),
  );
}

export function getCanopyDependencyState(
  card: CanopyCard,
  cards: readonly CanopyCard[],
): CanopyDependencyState {
  const cardsById = new Map(cards.map((entry) => [entry.id, entry]));
  const parents = parentDependencyIds(card).map((id) => {
    const parent = cardsById.get(id);
    return {
      id,
      title: parent?.title ?? id,
      status: parent?.status,
      done: parent?.status === "done",
      missing: !parent,
    };
  });
  return {
    parents,
    blockedParents: parents.filter((parent) => !parent.done),
  };
}

export function removeCardAndReferences(
  cards: readonly CanopyCard[],
  cardId: string,
): CanopyCard[] {
  const nextCards: CanopyCard[] = [];
  for (const card of cards) {
    if (card.id === cardId) {
      continue;
    }
    const links = card.metadata?.links;
    if (!links?.some((link) => link.targetCardId === cardId)) {
      nextCards.push(card);
      continue;
    }
    const nextLinks = links.filter((link) => link.targetCardId !== cardId);
    const metadata: CanopyMetadata = { ...card.metadata, links: nextLinks };
    if (nextLinks.length === 0) {
      delete metadata.links;
    }
    nextCards.push(
      Object.keys(metadata).length ? { ...card, metadata } : { ...card, metadata: undefined },
    );
  }
  return nextCards;
}

export function resetDraftState(state: CanopyUiState) {
  const resolveStaleEdit = state.loaded && state.mutationReadiness === "stale_edit_draft";
  state.draftOpen = false;
  state.draftDiscardOpen = false;
  state.editingCardId = null;
  state.editingCardBase = null;
  state.draftTitle = "";
  state.draftNotes = "";
  state.draftStatus = "todo";
  state.draftPriority = "normal";
  state.draftLabels = "";
  state.draftAgentId = "";
  state.draftSessionKey = "";
  state.draftTemplateId = "";
  state.draftCommentBody = "";
  if (resolveStaleEdit) {
    state.mutationReadiness = "ready";
  }
}

export function normalizeDraftLabels(value: string): string[] {
  return normalizeUniqueTrimmedStringList(value.split(",")).slice(0, 12);
}

export function draftPayload(state: CanopyUiState) {
  return {
    title: state.draftTitle,
    notes: state.draftNotes,
    status: state.draftStatus,
    priority: state.draftPriority,
    labels: normalizeDraftLabels(state.draftLabels),
    agentId: state.draftAgentId,
    sessionKey: state.draftSessionKey,
    ...(state.draftTemplateId ? { templateId: state.draftTemplateId } : {}),
  };
}

type CanopyCardDraft = {
  title: string;
  notes: string;
  status: CanopyStatus;
  priority: CanopyCard["priority"];
  labels: string[];
  agentId: string;
  sessionKey: string;
  templateId: CanopyTemplateId | "";
};

function cardDraftPayload(card: CanopyCard): CanopyCardDraft {
  return {
    title: card.title,
    notes: card.notes ?? "",
    status: card.status,
    priority: card.priority,
    labels: card.labels,
    agentId: card.agentId ?? "",
    sessionKey: canopyCardSessionKey(card) ?? "",
    templateId: card.metadata?.templateId ?? "",
  };
}

export function changedDraftPayload(state: CanopyUiState): Record<string, unknown> {
  const base = state.editingCardBase;
  if (!base) {
    return {};
  }
  const draft: Record<string, unknown> = {
    ...draftPayload(state),
    templateId: state.draftTemplateId,
  };
  const previous: Record<string, unknown> = cardDraftPayload(base);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft)) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(previous[key])) {
      patch[key] = key === "templateId" && draft[key] === "" ? null : draft[key];
    }
  }
  return patch;
}

export function rebaseCanopyDraft(state: CanopyUiState, current: CanopyCard): void {
  const changed = new Set(Object.keys(changedDraftPayload(state)));
  const next = cardDraftPayload(current);
  if (!changed.has("title")) {
    state.draftTitle = next.title;
  }
  if (!changed.has("notes")) {
    state.draftNotes = next.notes;
  }
  if (!changed.has("status")) {
    state.draftStatus = next.status;
  }
  if (!changed.has("priority")) {
    state.draftPriority = next.priority;
  }
  if (!changed.has("labels")) {
    state.draftLabels = next.labels.join(", ");
  }
  if (!changed.has("agentId")) {
    state.draftAgentId = next.agentId;
  }
  if (!changed.has("sessionKey")) {
    state.draftSessionKey = next.sessionKey;
  }
  if (!changed.has("templateId")) {
    state.draftTemplateId = next.templateId;
  }
  state.editingCardBase = current;
}

export function isFailedSessionStatus(status: GatewaySessionRow["status"]): boolean {
  return status === "failed" || status === "killed" || status === "timeout";
}

export function staleSessionState(session: GatewaySessionRow): CanopyStaleState | undefined {
  if (session.status !== "running") {
    return undefined;
  }
  if (session.hasActiveRun !== false) {
    return undefined;
  }
  if (
    typeof session.updatedAt !== "number" ||
    Date.now() - session.updatedAt < CANOPY_STALE_SESSION_MS
  ) {
    return undefined;
  }
  return {
    detectedAt: Date.now(),
    lastSessionUpdatedAt: session.updatedAt,
    reason: "Linked session has not reported recent activity.",
  };
}

export function canopyCardSessionKey(card: CanopyCard): string | undefined {
  return card.sessionKey ?? card.execution?.sessionKey;
}

export function canopyCardRunId(card: CanopyCard): string | undefined {
  return card.runId ?? card.execution?.runId;
}

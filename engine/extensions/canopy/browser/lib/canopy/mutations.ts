import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { isGatewayRequestError, type GatewayBrowserClient } from "../../api/gateway.ts";
import {
  changedDraftPayload,
  draftPayload,
  planCanopyCardDrop,
  rebaseCanopyDraft,
  removeCardAndReferences,
  replaceCard,
  resetDraftState,
  selectedCanopyBoardParams,
  setCanopyCards,
} from "./card-state.ts";
import { loadCanopy } from "./loading.ts";
import { formatError } from "./normalization-utils.ts";
import { normalizeCardPayload, normalizeCardsPayload } from "./normalization.ts";
import {
  getCanopyRuntime,
  getCanopyState,
  invalidateCanopyLoads,
  canopyHasActiveWrites,
  canopyMutationsReady,
  type CanopyHost,
} from "./runtime.ts";
import type {
  CanopyCard,
  CanopyDeleteResult,
  CanopyDispatchSummary,
  CanopyStatus,
} from "./types.ts";

function normalizeDispatchSummary(value: unknown): CanopyDispatchSummary {
  const countArray = (key: string) =>
    isRecord(value) && Array.isArray(value[key]) ? value[key].length : 0;
  return {
    started: countArray("started"),
    failures: countArray("startFailures"),
    promoted: countArray("promoted"),
    blocked: countArray("blocked"),
    reclaimed: countArray("reclaimed"),
    orchestrated: countArray("orchestrated"),
  };
}

export async function saveCanopyCardDraft(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
}) {
  const state = getCanopyState(params.host);
  const cardId = state.editingCardId;
  const base = cardId ? state.editingCardBase : null;
  if (
    !params.client ||
    !canopyMutationsReady(state) ||
    !state.draftTitle.trim() ||
    state.dispatching ||
    state.draftSaving ||
    (cardId && state.busyCardIds.has(cardId))
  ) {
    return;
  }
  if (cardId && (!base || base.id !== cardId)) {
    state.error = "This card changed before editing began. Cancel and reopen it to continue.";
    params.requestUpdate?.();
    return;
  }
  invalidateCanopyLoads(params.host);
  state.draftSaving = true;
  state.loading = true;
  state.error = null;
  params.requestUpdate?.();
  try {
    let payload: unknown;
    if (base) {
      const patch = changedDraftPayload(state);
      if (Object.keys(patch).length === 0) {
        resetDraftState(state);
        return;
      }
      payload = await params.client.request("canopy.cards.update", {
        id: cardId,
        expectedUpdatedAt: base.updatedAt,
        patch,
      });
    } else {
      payload = await params.client.request("canopy.cards.create", {
        ...draftPayload(state),
        ...selectedCanopyBoardParams(state),
      });
    }
    replaceCard(state, normalizeCardPayload(payload));
    resetDraftState(state);
  } catch (error) {
    if (
      base &&
      isGatewayRequestError(error) &&
      error.code === "canopy_conflict" &&
      isRecord(error.details) &&
      error.details.type === "canopy_card_conflict"
    ) {
      const current = normalizeCardPayload(error.details);
      replaceCard(state, current);
      rebaseCanopyDraft(state, current);
      state.error = `${error.message} Your unsaved edits remain in the form.`;
    } else {
      state.error = formatError(error);
    }
  } finally {
    state.draftSaving = false;
    state.loading = false;
    params.requestUpdate?.();
  }
}

export async function addCanopyCardComment(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  cardId?: string;
  body?: string;
  requestUpdate?: () => void;
}) {
  const state = getCanopyState(params.host);
  const cardId = params.cardId ?? state.editingCardId;
  const draftField = params.body === undefined ? "draftCommentBody" : "detailCommentBody";
  const submittedDraft = params.body ?? state.draftCommentBody;
  const body = submittedDraft.trim();
  if (
    !cardId ||
    !params.client ||
    !canopyMutationsReady(state) ||
    !body ||
    state.dispatching ||
    state.draftSaving ||
    state.busyCardIds.has(cardId)
  ) {
    return;
  }
  invalidateCanopyLoads(params.host);
  state.busyCardIds.add(cardId);
  state.error = null;
  params.requestUpdate?.();
  try {
    const payload = await params.client.request("canopy.cards.comment", {
      id: cardId,
      body,
    });
    const current = normalizeCardPayload(payload);
    replaceCard(state, current);
    if (state.editingCardId === cardId && state.editingCardBase?.id === cardId) {
      rebaseCanopyDraft(state, current);
    }
    // The operator may type another note or switch cards while this request settles.
    // Clear only the draft that submitted it, preserving the raw text for comparison.
    const draftCardId =
      draftField === "draftCommentBody" ? state.editingCardId : state.detailCardId;
    if (
      draftField === "detailCommentBody" &&
      state.detailCommentDrafts.get(cardId) === submittedDraft
    ) {
      state.detailCommentDrafts.delete(cardId);
    }
    if (draftCardId === cardId && state[draftField] === submittedDraft) {
      state[draftField] = "";
    }
  } catch (error) {
    state.error = formatError(error);
  } finally {
    state.busyCardIds.delete(cardId);
    params.requestUpdate?.();
  }
}

function reconcileCardConflict(
  state: ReturnType<typeof getCanopyState>,
  error: unknown,
): boolean {
  if (
    isGatewayRequestError(error) &&
    error.code === "canopy_conflict" &&
    isRecord(error.details) &&
    error.details.type === "canopy_card_conflict"
  ) {
    replaceCard(state, normalizeCardPayload(error.details));
    return true;
  }
  return false;
}

export async function moveCanopyCard(
  params: {
    host: CanopyHost;
    client: GatewayBrowserClient | null;
    cardId: string;
    status: CanopyStatus;
    expectedUpdatedAt?: number;
    requestUpdate?: () => void;
  } & (
    | { position: number; beforeCardId?: never }
    | { beforeCardId: string | null; boardFilter: string; position?: never }
  ),
) {
  const state = getCanopyState(params.host);
  if (
    !params.client ||
    !canopyMutationsReady(state) ||
    state.dispatching ||
    state.busyCardIds.has(params.cardId)
  ) {
    return;
  }
  const card = state.cards.find((candidate) => candidate.id === params.cardId);
  const moves =
    params.beforeCardId === undefined
      ? [{ id: params.cardId, status: params.status, position: params.position }]
      : card
        ? planCanopyCardDrop(
            state.cards,
            card,
            params.status,
            params.beforeCardId,
            params.boardFilter,
          )
        : [];
  if (!moves.length || moves.some((move) => state.busyCardIds.has(move.id))) {
    return;
  }
  invalidateCanopyLoads(params.host);
  for (const move of moves) {
    state.busyCardIds.add(move.id);
  }
  state.error = null;
  // A recovered older load must not clear an error owned by this move.
  delete getCanopyRuntime(params.host).loadError;
  params.requestUpdate?.();
  let reloadAfterFailure = false;
  try {
    for (const move of moves) {
      const payload =
        "expectedUpdatedAt" in move
          ? await params.client.request("canopy.cards.update", {
              id: move.id,
              expectedUpdatedAt: move.expectedUpdatedAt,
              patch: { position: move.position },
            })
          : await params.client.request("canopy.cards.move", {
              ...move,
              ...(params.expectedUpdatedAt !== undefined && move.id === params.cardId
                ? { expectedUpdatedAt: params.expectedUpdatedAt }
                : {}),
            });
      replaceCard(state, normalizeCardPayload(payload));
    }
  } catch (error) {
    state.error = formatError(error);
    if (!reconcileCardConflict(state, error)) {
      // Even a single move can commit before its acknowledgment is lost.
      state.mutationReadiness = "canonical_reload_required";
      state.loaded = false;
      state.loadAttempted = false;
      reloadAfterFailure = true;
    }
  } finally {
    for (const move of moves) {
      state.busyCardIds.delete(move.id);
    }
    if (state.draggedCardId === params.cardId) {
      state.draggedCardId = null;
    }
    params.requestUpdate?.();
  }
  if (reloadAfterFailure) {
    invalidateCanopyLoads(params.host);
    await loadCanopy({
      host: params.host,
      client: params.client,
      requestUpdate: params.requestUpdate,
      force: true,
      preserveError: true,
    });
  }
}

type CanopyCardMutationParams = {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  cardId: string;
  requestUpdate?: () => void;
};

async function runCanopyCardMutation<T>(
  params: CanopyCardMutationParams,
  mutate: (state: ReturnType<typeof getCanopyState>, client: GatewayBrowserClient) => Promise<T>,
): Promise<T | false> {
  const state = getCanopyState(params.host);
  if (
    !params.client ||
    !canopyMutationsReady(state) ||
    state.dispatching ||
    state.busyCardIds.has(params.cardId)
  ) {
    return false;
  }
  invalidateCanopyLoads(params.host);
  state.busyCardIds.add(params.cardId);
  state.error = null;
  params.requestUpdate?.();
  try {
    return await mutate(state, params.client);
  } catch (error) {
    reconcileCardConflict(state, error);
    state.error = formatError(error);
    return false;
  } finally {
    state.busyCardIds.delete(params.cardId);
    params.requestUpdate?.();
  }
}

export async function updateCanopyCardProperties(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  card: CanopyCard;
  patch: Partial<Pick<CanopyCard, "priority" | "labels" | "agentId" | "title" | "notes">>;
  requestUpdate?: () => void;
}) {
  return runCanopyCardMutation({ ...params, cardId: params.card.id }, async (state, client) => {
    const payload = await client.request("canopy.cards.update", {
      id: params.card.id,
      expectedUpdatedAt: params.card.updatedAt,
      patch: params.patch,
    });
    replaceCard(state, normalizeCardPayload(payload));
    return true;
  });
}

export async function deleteCanopyCard(
  params: CanopyCardMutationParams & { expectedUpdatedAt?: number },
): Promise<CanopyDeleteResult | false> {
  return runCanopyCardMutation(params, async (state, client) => {
    const result = await client.request<CanopyDeleteResult>("canopy.cards.delete", {
      id: params.cardId,
      ...(params.expectedUpdatedAt !== undefined
        ? { expectedUpdatedAt: params.expectedUpdatedAt }
        : {}),
    });
    const referenceUpdates = new Map(
      (result.referenceUpdates ?? []).map((receipt) => [receipt.id, receipt]),
    );
    const remaining = removeCardAndReferences(state.cards, params.cardId);
    for (const [index, card] of remaining.entries()) {
      const receipt = referenceUpdates.get(card.id);
      if (receipt && card.updatedAt === receipt.previousUpdatedAt) {
        remaining[index] = { ...card, updatedAt: receipt.updatedAt };
      }
    }
    setCanopyCards(state, remaining);
    return result;
  });
}

export async function archiveCanopyCard(
  params: CanopyCardMutationParams & { archived?: boolean; expectedUpdatedAt?: number },
) {
  return runCanopyCardMutation(params, async (state, client) => {
    const payload = await client.request("canopy.cards.archive", {
      id: params.cardId,
      archived: params.archived ?? true,
      ...(params.expectedUpdatedAt !== undefined
        ? { expectedUpdatedAt: params.expectedUpdatedAt }
        : {}),
    });
    replaceCard(state, normalizeCardPayload(payload));
    return true;
  });
}

export async function dispatchCanopy(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
}) {
  const state = getCanopyState(params.host);
  if (
    !params.client ||
    !canopyMutationsReady(state) ||
    state.dispatching ||
    canopyHasActiveWrites(state)
  ) {
    return;
  }
  invalidateCanopyLoads(params.host);
  state.dispatching = true;
  state.error = null;
  state.lastDispatchSummary = null;
  state.bulkResult = null;
  params.requestUpdate?.();
  try {
    const dispatchResult = await params.client.request(
      "canopy.cards.dispatch",
      selectedCanopyBoardParams(state),
    );
    const payload = await params.client.request("canopy.cards.list", {});
    const normalized = normalizeCardsPayload(payload);
    setCanopyCards(state, normalized.cards);
    state.statuses = normalized.statuses;
    state.lastDispatchSummary = normalizeDispatchSummary(dispatchResult);
    // A teardown may have invalidated this in-flight dispatch. Keep its cached
    // result reload-required so reconnect cannot treat an old completion as canonical.
    state.loaded = canopyMutationsReady(state);
  } catch (error) {
    state.error = formatError(error);
  } finally {
    state.dispatching = false;
    params.requestUpdate?.();
  }
}

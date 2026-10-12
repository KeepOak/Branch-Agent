import type { CanopyChange } from "@branch/canopy-contract";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { normalizeCanopyChange } from "./change-payload.ts";
import { CANOPY_STATUSES, type CanopyUiState } from "./types.ts";

export type CanopyHost = object;

export type CanopyLoadToken = {
  queuedAfterGeneration?: number;
  catalogOnly: boolean;
};

type CanopyLiveRefreshEntry = {
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
  refresh?: () => Promise<boolean>;
  shouldDefer?: () => boolean;
};

type CanopyRuntime = {
  state?: CanopyUiState;
  cardsRevision?: CanopyChange | null;
  loadPromise?: Promise<boolean>;
  loadToken?: CanopyLoadToken;
  loadError?: string;
  loadGeneration?: number;
  liveRefreshGeneration?: number;
  liveChangeEpoch?: string;
  liveHighestSeenRevision?: number;
  liveAppliedRevision?: number;
  liveRefreshPending?: boolean;
  liveRefreshPromise?: Promise<void>;
  liveRefreshRetryTimer?: ReturnType<typeof setTimeout>;
  liveRefreshEntry?: CanopyLiveRefreshEntry;
};

const canopyRuntimes = new WeakMap<CanopyHost, CanopyRuntime>();
export function nextCanopyLoadGeneration(host: CanopyHost): number {
  const runtime = getCanopyRuntime(host);
  const generation = (runtime.loadGeneration ?? 0) + 1;
  runtime.loadGeneration = generation;
  return generation;
}

export function isCurrentCanopyLoadGeneration(host: CanopyHost, generation: number): boolean {
  return getCanopyRuntime(host).loadGeneration === generation;
}

export function invalidateCanopyLoads(host: CanopyHost) {
  const runtime = getCanopyRuntime(host);
  const state = runtime.state;
  if (state) {
    if (runtime.loadPromise) {
      if (!state.draftSaving) {
        state.loading = false;
      }
      if (!state.loaded) {
        state.loadAttempted = false;
      }
    }
  }
  delete runtime.cardsRevision;
  nextCanopyLoadGeneration(host);
  delete runtime.loadPromise;
  delete runtime.loadToken;
}

export function stopCanopyLiveRefresh(host: CanopyHost): void {
  const runtime = getCanopyRuntime(host);
  const loadInFlight = Boolean(runtime.loadPromise);
  runtime.liveRefreshGeneration = (runtime.liveRefreshGeneration ?? 0) + 1;
  if (runtime.liveRefreshRetryTimer) {
    clearTimeout(runtime.liveRefreshRetryTimer);
    delete runtime.liveRefreshRetryTimer;
  }
  delete runtime.liveRefreshEntry;
  delete runtime.liveRefreshPromise;
  delete runtime.liveChangeEpoch;
  delete runtime.liveHighestSeenRevision;
  delete runtime.liveAppliedRevision;
  delete runtime.liveRefreshPending;
  if (loadInFlight) {
    invalidateCanopyLoads(host);
  }
}

export function resetCanopyConnectionState(host: CanopyHost) {
  const runtime = getCanopyRuntime(host);
  const state = runtime.state;
  if (state) {
    // Detach stale loads so reconnecting can start fresh without letting the
    // old request clear a concurrent draft-save loading state.
    if (!state.draftSaving) {
      state.loading = false;
    }
    // Keep cached cards visible across disconnects, but require a canonical
    // reload before accepting writes against data that may now be stale.
    state.mutationReadiness = "canonical_reload_required";
    state.loaded = false;
    state.loadAttempted = false;
  }
  delete runtime.cardsRevision;
  nextCanopyLoadGeneration(host);
  delete runtime.loadPromise;
  delete runtime.loadToken;
}

function createDefaultState(): CanopyUiState {
  return {
    loading: false,
    loaded: false,
    loadAttempted: false,
    mutationReadiness: "ready",
    error: null,
    cards: [],
    boards: [],
    statuses: CANOPY_STATUSES,
    lastDispatchSummary: null,
    dispatching: false,
    query: "",
    searchOpen: false,
    priorityFilter: new Set(),
    statusFilter: new Set(),
    attentionFilter: new Set(),
    donePeriod: "all",
    agentFilter: "all",
    boardFilter: "__all__",
    showArchived: false,
    layout: "comfortable",
    viewMode: "board",
    emptyColumnMode: "show",
    collapsedStatuses: new Set(),
    expandedEmptyStatuses: new Set(),
    lastRefreshAt: null,
    lastRefreshError: null,
    draftOpen: false,
    draftDiscardOpen: false,
    draftSaving: false,
    editingCardId: null,
    editingCardBase: null,
    draftTitle: "",
    draftNotes: "",
    draftStatus: "todo",
    draftPriority: "normal",
    draftLabels: "",
    draftAgentId: "",
    draftSessionKey: "",
    draftTemplateId: "",
    draftCommentBody: "",
    detailCardId: null,
    detailTab: "overview",
    detailCommentBody: "",
    detailCommentDrafts: new Map(),
    busyCardIds: new Set(),
    selectedCardIds: new Set(),
    bulkDialog: null,
    bulkSaving: false,
    bulkResult: null,
    draggedCardId: null,
    dragOverStatus: null,
    dragBeforeCardId: null,
  };
}

export function getCanopyRuntime(host: CanopyHost): CanopyRuntime {
  let runtime = canopyRuntimes.get(host);
  if (!runtime) {
    runtime = {};
    canopyRuntimes.set(host, runtime);
  }
  return runtime;
}

export function getCanopyState(host: CanopyHost): CanopyUiState {
  const runtime = getCanopyRuntime(host);
  runtime.state ??= createDefaultState();
  return runtime.state;
}

export function canopyMutationsReady(state: CanopyUiState): boolean {
  return state.mutationReadiness === "ready";
}

export function canopyHasActiveWrites(state: CanopyUiState): boolean {
  return Boolean(state.bulkSaving || state.draftSaving || state.busyCardIds.size);
}

export function hasCurrentCanopyCards(host: CanopyHost, payload: unknown): boolean {
  const change = normalizeCanopyChange(payload);
  const held = getCanopyRuntime(host).cardsRevision;
  return Boolean(
    change && held && change.epoch === held.epoch && change.cardsRevision === held.revision,
  );
}

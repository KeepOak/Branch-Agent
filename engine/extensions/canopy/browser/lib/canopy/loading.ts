import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { setCanopyCards } from "./card-state.ts";
import { normalizeCanopyChange } from "./change-payload.ts";
import { formatError } from "./normalization-utils.ts";
import { normalizeCardsPayload } from "./normalization.ts";
import {
  getCanopyRuntime,
  getCanopyState,
  isCurrentCanopyLoadGeneration,
  nextCanopyLoadGeneration,
  canopyHasActiveWrites,
  type CanopyHost,
  type CanopyLoadToken,
} from "./runtime.ts";
import type { CanopyRefreshSource, CanopyUiState } from "./types.ts";

type LoadCanopyParams = {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
  force?: boolean;
  refreshDiagnostics?: boolean;
  preserveError?: boolean;
};

export async function loadCanopy(params: LoadCanopyParams): Promise<boolean> {
  return await loadCanopyInternal(params);
}

export async function loadCanopyCatalog(
  params: Pick<LoadCanopyParams, "host" | "client" | "requestUpdate">,
): Promise<boolean> {
  return await loadCanopyInternal({ ...params, force: true }, undefined, true);
}

async function loadCanopyInternal(
  params: LoadCanopyParams,
  queuedAfterGeneration?: number,
  catalogOnly = false,
): Promise<boolean> {
  const runtime = getCanopyRuntime(params.host);
  const state = getCanopyState(params.host);
  if (
    !params.client ||
    state.dispatching ||
    canopyHasActiveWrites(state) ||
    (!params.force && (state.loaded || state.loadAttempted))
  ) {
    return false;
  }
  const client = params.client;
  const existingLoad = runtime.loadPromise;
  if (existingLoad) {
    const existingGeneration = runtime.loadGeneration;
    const requiresTaskLoad = !catalogOnly && runtime.loadToken?.catalogOnly;
    const result = await existingLoad;
    const existingLoadIsCurrent =
      existingGeneration !== undefined &&
      isCurrentCanopyLoadGeneration(params.host, existingGeneration);
    const currentLoadMarker = runtime.loadToken;
    // Only follow a replacement created by this load's forced-waiter queue.
    // Fresh loads after teardown or writes must not revive stale callers.
    const queuedLoadReplacedExisting =
      existingGeneration !== undefined &&
      currentLoadMarker?.queuedAfterGeneration === existingGeneration &&
      Boolean(runtime.loadPromise);
    // Forced callers carry their own diagnostics/task-refresh contract, so a
    // weaker in-flight load cannot satisfy them.
    return (params.force || requiresTaskLoad) &&
      (existingLoadIsCurrent || queuedLoadReplacedExisting) &&
      !state.dispatching &&
      !canopyHasActiveWrites(state)
      ? await loadCanopyInternal(params, existingGeneration, catalogOnly)
      : result;
  }
  const generation = nextCanopyLoadGeneration(params.host);
  const loadToken: CanopyLoadToken = { queuedAfterGeneration, catalogOnly };
  runtime.loadToken = loadToken;
  if (!catalogOnly) {
    state.loadAttempted = true;
    state.loading = true;
    if (!params.preserveError) {
      delete runtime.loadError;
      state.error = null;
    }
    state.lastRefreshError = null;
    params.requestUpdate?.();
  }
  const loadPromise = (async () => {
    try {
      if (params.refreshDiagnostics) {
        try {
          await client.request("canopy.cards.diagnostics.refresh", {});
        } catch (error) {
          if (isCurrentCanopyLoadGeneration(params.host, generation)) {
            state.lastRefreshError = formatError(error);
          }
        }
      }
      const payload = await client.request(
        "canopy.cards.list",
        runtime.cardsRevision ? { sinceRevision: runtime.cardsRevision } : {},
      );
      if (!isCurrentCanopyLoadGeneration(params.host, generation)) {
        return false;
      }
      const unchanged = isRecord(payload) && payload.unchanged === true;
      if (
        catalogOnly &&
        !unchanged &&
        (!isRecord(payload) || !Array.isArray(payload.cards) || !Array.isArray(payload.boards))
      ) {
        return false;
      }
      const normalized = unchanged ? state : normalizeCardsPayload(payload);
      if (catalogOnly) {
        state.boards = normalized.boards;
      }
      // Keep navigation current without replacing cards beneath an unfinished draft.
      if ((catalogOnly || params.preserveError) && shouldDeferCanopyLiveRefresh(state)) {
        return catalogOnly;
      }
      runtime.cardsRevision = normalizeCanopyChange(isRecord(payload) ? payload.revision : null);
      setCanopyCards(state, normalized.cards);
      state.boards = normalized.boards;
      state.statuses = normalized.statuses;
      // Catalog hydration never authorizes stale edits.
      if (catalogOnly) {
        return true;
      }
      const recoveredLoadError = runtime.loadError;
      if (recoveredLoadError !== undefined && state.error === recoveredLoadError) {
        state.error = null;
      }
      delete runtime.loadError;
      // Preserve stale edit text for recovery, but never re-enable its full-card
      // save payload after canonical state may have changed.
      state.mutationReadiness = state.editingCardId ? "stale_edit_draft" : "ready";
      state.loaded = true;
      return true;
    } catch (error) {
      if (!catalogOnly && isCurrentCanopyLoadGeneration(params.host, generation)) {
        const formattedError = formatError(error);
        if (params.preserveError) {
          state.lastRefreshError = formattedError;
        } else {
          runtime.loadError = formattedError;
          state.error = formattedError;
        }
      }
      return false;
    } finally {
      const isCurrentGeneration = isCurrentCanopyLoadGeneration(params.host, generation);
      const ownsLoad = runtime.loadToken === loadToken;
      if (!catalogOnly && !isCurrentGeneration && !state.loaded) {
        state.loadAttempted = false;
      }
      if (!catalogOnly && (isCurrentGeneration || (ownsLoad && !state.draftSaving))) {
        state.loading = false;
      }
      if (ownsLoad) {
        delete runtime.loadPromise;
        delete runtime.loadToken;
      }
      params.requestUpdate?.();
    }
  })();
  runtime.loadPromise = loadPromise;
  return await loadPromise;
}

export async function refreshCanopy(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
  source: CanopyRefreshSource;
  refreshDiagnostics?: boolean;
}): Promise<boolean> {
  const state = getCanopyState(params.host);
  const passive = params.source === "live";
  if (state.dispatching || canopyHasActiveWrites(state)) {
    return false;
  }
  state.lastRefreshError = null;
  params.requestUpdate?.();
  if (!params.client) {
    state.lastRefreshError = "Gateway client unavailable";
    params.requestUpdate?.();
    return false;
  }
  const refreshed = await loadCanopy({
    host: params.host,
    client: params.client,
    requestUpdate: params.requestUpdate,
    force: true,
    refreshDiagnostics: params.refreshDiagnostics,
    preserveError: passive,
  });
  if (!passive && state.error) {
    state.lastRefreshError = state.error;
  } else if (refreshed) {
    state.lastRefreshAt = Date.now();
  }
  params.requestUpdate?.();
  return refreshed;
}

export function shouldDeferCanopyLiveRefresh(state: CanopyUiState): boolean {
  return Boolean(
    state.draftOpen ||
    state.editingCardId ||
    canopyHasActiveWrites(state) ||
    state.draggedCardId ||
    state.dispatching ||
    state.detailCommentBody.trim() ||
    state.draftCommentBody.trim(),
  );
}

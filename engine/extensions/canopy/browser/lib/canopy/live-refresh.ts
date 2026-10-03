import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { normalizeCanopyChange } from "./change-payload.ts";
import { refreshCanopy, shouldDeferCanopyLiveRefresh } from "./loading.ts";
import { getCanopyRuntime, getCanopyState, type CanopyHost } from "./runtime.ts";

const CANOPY_LIVE_REFRESH_RETRY_MS = 1000;

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function clearRetry(host: CanopyHost): void {
  const runtime = getCanopyRuntime(host);
  if (runtime.liveRefreshRetryTimer) {
    clearTimeout(runtime.liveRefreshRetryTimer);
    delete runtime.liveRefreshRetryTimer;
  }
}

function scheduleRetry(host: CanopyHost, generation: number): void {
  const runtime = getCanopyRuntime(host);
  if (runtime.liveRefreshRetryTimer) {
    return;
  }
  runtime.liveRefreshRetryTimer = setTimeout(() => {
    delete runtime.liveRefreshRetryTimer;
    if ((runtime.liveRefreshGeneration ?? 0) === generation) {
      void runPendingRefresh(host);
    }
  }, CANOPY_LIVE_REFRESH_RETRY_MS);
}

async function runPendingRefresh(host: CanopyHost): Promise<void> {
  const runtime = getCanopyRuntime(host);
  if (runtime.liveRefreshPromise) {
    return await runtime.liveRefreshPromise;
  }
  const generation = runtime.liveRefreshGeneration ?? 0;
  const promise = (async () => {
    while (runtime.liveRefreshPending && (runtime.liveRefreshGeneration ?? 0) === generation) {
      const entry = runtime.liveRefreshEntry;
      const state = getCanopyState(host);
      if (
        !entry?.client ||
        documentHidden() ||
        (!entry.refresh && shouldDeferCanopyLiveRefresh(state)) ||
        entry.shouldDefer?.()
      ) {
        return;
      }
      runtime.liveRefreshPending = false;
      const targetEpoch = runtime.liveChangeEpoch;
      const targetRevision = runtime.liveHighestSeenRevision ?? 0;
      const targetInvalidation = runtime.liveInvalidationRevision ?? 0;
      const refreshed = await (entry.refresh?.() ??
        refreshCanopy({
          host,
          client: entry.client,
          requestUpdate: entry.requestUpdate,
          source: "live",
        }));
      if ((runtime.liveRefreshGeneration ?? 0) !== generation) {
        return;
      }
      if (!refreshed) {
        runtime.liveRefreshPending = true;
        scheduleRetry(host, generation);
        return;
      }
      if (runtime.liveChangeEpoch === targetEpoch) {
        runtime.liveAppliedRevision = Math.max(runtime.liveAppliedRevision ?? 0, targetRevision);
      }
      runtime.liveRefreshPending =
        (runtime.liveInvalidationRevision ?? 0) !== targetInvalidation ||
        runtime.liveChangeEpoch !== targetEpoch ||
        (runtime.liveHighestSeenRevision ?? 0) > (runtime.liveAppliedRevision ?? 0);
    }
  })();
  runtime.liveRefreshPromise = promise;
  try {
    await promise;
  } finally {
    if (runtime.liveRefreshPromise === promise) {
      delete runtime.liveRefreshPromise;
    }
    const state = getCanopyState(host);
    if (
      runtime.liveRefreshPending &&
      !runtime.liveRefreshRetryTimer &&
      runtime.liveRefreshEntry?.client &&
      !documentHidden() &&
      !runtime.liveRefreshEntry.shouldDefer?.() &&
      (runtime.liveRefreshEntry.refresh || !shouldDeferCanopyLiveRefresh(state))
    ) {
      void runPendingRefresh(host);
    }
  }
}

export function configureCanopyLiveRefresh(params: {
  host: CanopyHost;
  client: GatewayBrowserClient | null;
  requestUpdate?: () => void;
  refresh?: () => Promise<boolean>;
  shouldDefer?: () => boolean;
}): boolean {
  const runtime = getCanopyRuntime(params.host);
  const requiresCanonicalReload = Boolean(
    params.client && runtime.liveRefreshEntry?.client !== params.client,
  );
  runtime.liveRefreshEntry = {
    client: params.client,
    requestUpdate: params.requestUpdate,
    refresh: params.refresh,
    shouldDefer: params.shouldDefer,
  };
  if (runtime.liveRefreshPending && !runtime.liveRefreshRetryTimer) {
    void runPendingRefresh(params.host);
  }
  return requiresCanonicalReload;
}

/** Observer bursts share the canonical read queue and its single coalescing timer. */
export function invalidateCanopyLiveRefresh(host: CanopyHost): void {
  const runtime = getCanopyRuntime(host);
  runtime.liveInvalidationRevision = (runtime.liveInvalidationRevision ?? 0) + 1;
  runtime.liveRefreshPending = true;
  scheduleRetry(host, runtime.liveRefreshGeneration ?? 0);
}

export function handleCanopyChanged(host: CanopyHost, payload: unknown): boolean {
  const change = normalizeCanopyChange(payload);
  if (!change) {
    return false;
  }
  const runtime = getCanopyRuntime(host);
  if (runtime.liveChangeEpoch !== change.epoch) {
    runtime.liveChangeEpoch = change.epoch;
    runtime.liveHighestSeenRevision = change.revision;
    runtime.liveAppliedRevision = 0;
  } else if (change.revision <= (runtime.liveHighestSeenRevision ?? 0)) {
    return false;
  } else {
    runtime.liveHighestSeenRevision = change.revision;
  }
  runtime.liveRefreshPending = true;
  clearRetry(host);
  void runPendingRefresh(host);
  return true;
}

export function resumeCanopyLiveRefresh(host: CanopyHost): void {
  const runtime = getCanopyRuntime(host);
  if (runtime.liveRefreshPending && !runtime.liveRefreshRetryTimer) {
    void runPendingRefresh(host);
  }
}

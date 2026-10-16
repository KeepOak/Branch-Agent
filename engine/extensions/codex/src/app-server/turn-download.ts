/**
 * A Codex turn that has to wait for the first-use download says so in its
 * conversation: "Getting Codex ready (134 MB)… 42%", updated as it goes, then
 * "Codex is ready." The download is not a question (the person already chose
 * Codex). Cancel (codex.runtime.cancel) ends the turn with "Cancelled"; a
 * failure (offline, a refused download) ends it with the reason, and the window
 * offers Try again (codex.runtime.download).
 *
 * Every line is a `run_status` event with phase "codex_download" on the
 * waiting run, so the window draws it where the turn is waiting.
 */
import type { CodexAppServerStartOptions } from "./config.js";
import {
  getManagedCodexOnDemand,
  isManagedCodexDownloadPending,
  type ManagedCodexOnDemand,
} from "./managed-binary.js";
import {
  CODEX_DOWNLOAD_CANCELLED,
  CodexRuntimeUnavailableError,
  codexDownloadProgress,
  type CodexDownloadProgress,
} from "./on-demand.js";

export const CODEX_DOWNLOAD_PHASE = "codex_download";

export type CodexTurnDownloadState = "downloading" | "ready" | "failed" | "cancelled";

export type CodexTurnDownloadEvent = {
  stream: "run_status";
  data: {
    phase: typeof CODEX_DOWNLOAD_PHASE;
    state: CodexTurnDownloadState;
    message: string;
    received?: number;
    bytes?: number;
    percent?: number;
    reason?: string;
  };
};

export type PrepareCodexForTurnParams = {
  startOptions: CodexAppServerStartOptions;
  /** The run's signal: stopping the turn stops waiting (and the download, if nobody else waits). */
  signal: AbortSignal;
  emit: (event: CodexTurnDownloadEvent) => void | Promise<void>;
  /** Tests: the on-demand source and the pending check. */
  onDemand?: ManagedCodexOnDemand;
  pending?: (startOptions: CodexAppServerStartOptions) => Promise<boolean>;
};

/**
 * Downloads Codex before the turn starts it, when the turn would otherwise wait
 * on the download with nothing on screen. Runs outside the app-server startup
 * timeout: a slow connection is not a failed start. Throws the reason
 * (CodexRuntimeUnavailableError, "Cancelled" for a cancel) after saying it.
 */
export async function prepareCodexForTurn(params: PrepareCodexForTurnParams): Promise<void> {
  const onDemand = params.onDemand ?? getManagedCodexOnDemand();
  if (!onDemand) {
    return;
  }
  const pending =
    params.pending ??
    ((start: CodexAppServerStartOptions) => isManagedCodexDownloadPending(start, { onDemand }));
  if (!(await pending(params.startOptions))) {
    return;
  }
  const emit = (data: Omit<CodexTurnDownloadEvent["data"], "phase">) => {
    try {
      void Promise.resolve(
        params.emit({ stream: "run_status", data: { phase: CODEX_DOWNLOAD_PHASE, ...data } }),
      ).catch(() => undefined);
    } catch {
      // The chat line is a courtesy; the download goes on without it.
    }
  };
  let shownPercent = -1;
  let last: CodexDownloadProgress | undefined;
  const onProgress = (progress: CodexDownloadProgress) => {
    last = progress;
    // One line per whole percent, not one per network chunk.
    if (progress.percent === shownPercent) {
      return;
    }
    shownPercent = progress.percent;
    emit({
      state: "downloading",
      message: progress.message,
      received: progress.received,
      bytes: progress.bytes,
      percent: progress.percent,
    });
  };
  const status = await readStatus(onDemand);
  if (status) {
    onProgress(status);
  }
  try {
    await onDemand.ensureLauncher({ signal: params.signal, onProgress });
  } catch (error) {
    if (error instanceof CodexRuntimeUnavailableError && error.reason === "cancelled") {
      emit({ state: "cancelled", message: CODEX_DOWNLOAD_CANCELLED });
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    emit({
      state: "failed",
      message,
      ...(error instanceof CodexRuntimeUnavailableError ? { reason: error.reason } : {}),
      ...(last ? { bytes: last.bytes } : {}),
    });
    throw error;
  }
  emit({
    state: "ready",
    message: "Codex is ready.",
    ...(last ? { bytes: last.bytes, received: last.bytes, percent: 100 } : {}),
  });
}

/** The size to show before the first byte arrives ("… 0%"), from codex.runtime's status. */
async function readStatus(
  onDemand: ManagedCodexOnDemand,
): Promise<CodexDownloadProgress | undefined> {
  const status = await (onDemand as Partial<{ status: () => Promise<unknown> }>)
    .status?.()
    .catch(() => undefined);
  const record = (status ?? {}) as { state?: unknown; bytes?: unknown; received?: unknown };
  if (typeof record.bytes !== "number" || record.bytes <= 0) {
    return undefined;
  }
  return codexDownloadProgress(
    { bytes: record.bytes },
    typeof record.received === "number" ? record.received : 0,
  );
}

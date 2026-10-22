/**
 * A Codex turn that needs the first-use download asks before any byte is
 * fetched, with the same size question the Settings row and the model menu
 * use. Yes (`codex.runtime.download` with confirmed) starts it; Cancel does
 * not. Then the conversation shows "Getting Codex ready (134 MB)… 42%",
 * updated as it goes, then "Codex is ready."
 *
 * Every line is a `run_status` event with phase "codex_download" on the
 * waiting run, so the window draws it where the turn is waiting.
 */
import { isGatewayCliClient } from "branch/plugin-sdk/routing";
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

export type CodexTurnDownloadState = "confirm" | "downloading" | "ready" | "failed" | "cancelled";

export type CodexTurnDownloadEvent = {
  stream: "run_status";
  data: {
    phase: typeof CODEX_DOWNLOAD_PHASE;
    state: CodexTurnDownloadState;
    message: string;
    /** The size question, kept on a failure so Try again asks again. */
    ask?: string;
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
  /**
   * False when nobody can answer the size question for this run (the CLI, a
   * chat channel, a scheduled or background run). The turn then fails at once
   * with what to do, instead of waiting on a yes that never comes.
   */
  canAsk?: boolean;
};

/** Run triggers with nobody watching the conversation to say yes. */
const UNATTENDED_TRIGGERS = new Set(["cron", "heartbeat", "memory", "overflow"]);

/** Only the Branch window draws the download question and its Yes button. */
export function canAskCodexDownload(params: {
  trigger?: string;
  messageChannel?: string;
  gatewayClientMode?: string;
}): boolean {
  if (params.trigger && UNATTENDED_TRIGGERS.has(params.trigger)) {
    return false;
  }
  // `branch-engine agent -m` reaches the gateway on the internal channel too,
  // but a terminal has no Yes button: only window clients can answer.
  if (isGatewayCliClient({ mode: params.gatewayClientMode })) {
    return false;
  }
  return params.messageChannel?.trim().toLowerCase() === "webchat";
}

/** What an unattended run says when Codex still has to be downloaded. */
export function codexDownloadNeededMessage(question: string | undefined): string {
  const ask = question ? ` "${question}"` : " the Codex download";
  return (
    `Codex isn't downloaded yet, so this agent can't answer here. ` +
    `Open the Branch window and say yes to${ask}, or pick a model that doesn't use Codex.`
  );
}

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
  if (!onDemand.downloadAllowed() && params.canAsk === false) {
    const question = onDemand.askMessage();
    const message = codexDownloadNeededMessage(question);
    emit({
      state: "failed",
      message,
      ...(question ? { ask: question } : {}),
      reason: "not-downloaded",
    });
    throw new CodexRuntimeUnavailableError("not-downloaded", message);
  }
  if (!onDemand.downloadAllowed()) {
    const question = onDemand.askMessage() ?? "Download Codex?";
    const preview = await readStatus(onDemand);
    emit({
      state: "confirm",
      message: question,
      ask: question,
      ...(preview ? { bytes: preview.bytes, received: 0, percent: 0 } : {}),
    });
    try {
      await onDemand.waitForDownloadConsent(params.signal);
    } catch (error) {
      if (error instanceof CodexRuntimeUnavailableError && error.reason === "cancelled") {
        emit({ state: "cancelled", message: CODEX_DOWNLOAD_CANCELLED });
      }
      throw error;
    }
  }
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
    const question = onDemand.askMessage();
    emit({
      state: "failed",
      message,
      ...(question ? { ask: question } : {}),
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

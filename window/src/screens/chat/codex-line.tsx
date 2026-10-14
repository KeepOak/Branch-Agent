// Codex fetched on first use (Private #983 part 3): the conversation whose Codex turn waits for the download says so
// in plain words, "Getting Codex ready (134 MB)… 42%", updating as it goes, with Cancel. There is no question to answer:
// choosing Codex was the choice. The turn reports the download as `run_status` "codex_download" lines (thread/model.ts);
// after the turn ends, Cancelled or the reason stays, and Try again restarts the download (codex.runtime.download),
// read again through codex.runtime until Codex is ready. Both controls go through Coming like every engine call.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { RunEnd } from "../../connect/session";
import type { Block, CodexDownloadLine } from "../../thread/model";
import { NoticeLine } from "./lines";

export const CODEX_LINE_NEED = { cancel: "codex.runtime.cancel", download: "codex.runtime.download" } as const;
const CANCEL_REASON = "This engine can’t cancel the Codex download.";
const RETRY_REASON = "This engine can’t download Codex.";

export type CodexLineView = { state: CodexDownloadLine["state"]; text: string; runId?: string };

type CodexNotice = Extract<Block, { kind: "notice" }> & { codex: CodexDownloadLine };

/** The waiting turn's Codex line in this run's blocks, if it has one. */
export function codexNoticeOf(blocks: readonly Block[]): CodexNotice | undefined {
  return blocks.find((b): b is CodexNotice => b.kind === "notice" && Boolean(b.codex));
}

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000) + " MB";

/** codex.runtime's answer while Try again runs: the download with its real size, ready, or the reason. */
export function codexLineOfRuntime(runtime: unknown): CodexLineView | null {
  const r = (runtime && typeof runtime === "object" ? runtime : {}) as Record<string, unknown>;
  const message = typeof r.message === "string" ? r.message.trim() : "";
  const bytes = typeof r.bytes === "number" && r.bytes > 0 ? r.bytes : 0;
  if (r.state === "downloading" || r.state === "download") {
    // "download" right after Try again: the request is in, the first byte isn't yet.
    const received = r.state === "downloading" && typeof r.received === "number" ? r.received : 0;
    const percent = bytes ? Math.max(0, Math.min(99, Math.floor((received / bytes) * 100))) : 0;
    const text = r.state === "downloading" && message.startsWith("Getting Codex ready") ? message
      : bytes ? `Getting Codex ready (${megabytes(bytes)})… ${percent}%` : "Getting Codex ready…";
    return { state: "downloading", text };
  }
  if (r.state === "ready") return { state: "ready", text: "Codex is ready. Send your message again." };
  if (r.state === "unavailable") return { state: "failed", text: message || "Codex couldn’t be downloaded." };
  return null;
}

/** The line for this conversation: the waiting turn's, then (after it ended) Cancelled or the reason with Try again. */
export function useCodexLine({ engine, live, running, ended, sessionKey, toast }: {
  engine?: WindowEngine; live: readonly Block[]; running: boolean; ended?: RunEnd | null; sessionKey?: string | null; toast: (text: string) => void;
}) {
  const [after, setAfter] = useState<CodexLineView | null>(null);
  const [polling, setPolling] = useState(false);
  const last = useRef<CodexLineView | null>(null);
  const notice = running ? codexNoticeOf(live) : undefined;
  const fromTurn: CodexLineView | null = notice ? { state: notice.codex.state, text: notice.text, runId: notice.codex.runId } : null;
  const turnKey = fromTurn ? fromTurn.runId + ":" + fromTurn.state + ":" + fromTurn.text : "";
  useEffect(() => {
    if (fromTurn) { last.current = fromTurn; setAfter(null); setPolling(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);
  // The turn that showed the line ended: Cancelled or the reason stays, with Try again.
  useEffect(() => {
    const seen = last.current;
    if (running || !ended || !seen || ended.runId !== seen.runId) return;
    last.current = null;
    setAfter(seen.state === "failed" || seen.state === "cancelled" ? seen : null);
  }, [running, ended]);
  // Another conversation: its own line, not this one's.
  const conversation = useRef(sessionKey);
  useEffect(() => {
    if (conversation.current === sessionKey) return;
    conversation.current = sessionKey;
    last.current = null; setAfter(null); setPolling(false);
  }, [sessionKey]);
  // Try again: read codex.runtime every second until Codex is ready or says why not.
  useEffect(() => {
    if (!polling || !engine) return;
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      engine.request<unknown>("codex.runtime", {}).then((runtime) => {
        if (!on) return;
        const line = codexLineOfRuntime(runtime);
        if (line) setAfter(line);
        if (line?.state === "downloading") timer = setTimeout(tick, 1000);
        else setPolling(false);
      }, (error: unknown) => {
        if (!on) return;
        setPolling(false);
        setAfter({ state: "failed", text: error instanceof Error ? error.message : String(error) });
      });
    };
    timer = setTimeout(tick, 1000);
    return () => { on = false; if (timer) clearTimeout(timer); };
  }, [polling, engine]);

  const cancel = useCallback(() => {
    if (!engine) return;
    engine.request<unknown>("codex.runtime.cancel", {}).then(() => {
      // The waiting turn ends itself with Cancelled; a Try again download has no turn, so the line says it here.
      if (!running) { setPolling(false); setAfter({ state: "cancelled", text: "Cancelled" }); }
    }, (error: unknown) => toast(error instanceof Error ? error.message : String(error)));
  }, [engine, running, toast]);
  const retry = useCallback(() => {
    if (!engine) return;
    engine.request<unknown>("codex.runtime.download", {}).then((runtime) => {
      const line = codexLineOfRuntime(runtime);
      setAfter(line ?? { state: "downloading", text: "Getting Codex ready…" });
      setPolling(!line || line.state === "downloading");
    }, (error: unknown) => setAfter({ state: "failed", text: error instanceof Error ? error.message : String(error) }));
  }, [engine]);

  const view = fromTurn ?? (running ? null : after);
  return { view, cancel, retry };
}

/** One quiet line: progress with Cancel, Cancelled, the reason with Try again, or ready. */
export function CodexLine({ view, onCancel, onRetry }: { view: CodexLineView; onCancel: () => void; onRetry: () => void }) {
  if (view.state === "downloading") {
    return <NoticeLine text={view.text} links={[{ label: "Cancel", onClick: onCancel, need: CODEX_LINE_NEED.cancel, reason: CANCEL_REASON }]} testid="codex-download" />;
  }
  if (view.state === "cancelled") return <NoticeLine text="Cancelled" testid="codex-cancelled" />;
  if (view.state === "failed") {
    return <NoticeLine tone="bad" text={view.text} links={[{ label: "Try again", onClick: onRetry, need: CODEX_LINE_NEED.download, reason: RETRY_REASON }]} testid="codex-failed" />;
  }
  return <NoticeLine text={view.text} testid="codex-ready" />;
}

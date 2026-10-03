// From OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f:src/components/features/conversation/transcript-export-modal.tsx (atlas SESSIONS-0047). Adapted to Branch's dialog and gateway.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Dialog } from "../shell/Dialog";
import { loadCompleteTranscript } from "./load";
import { eventsToHtml, eventsToMarkdown, type TranscriptExportFormat } from "./render";
import { eventsToReplayHtml } from "./replay-html";
import "./export.css";

export function exportFilename(title: string, format: TranscriptExportFormat): string {
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim() || "Conversation";
  return `${/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem) ? "_" : ""}${stem}${format === "replay" ? ".replay" : ""}.${format === "markdown" ? "md" : "html"}`;
}

export function downloadTranscript(content: string, title: string, format: TranscriptExportFormat): void {
  const url = URL.createObjectURL(new Blob([content], { type: format === "markdown" ? "text/markdown;charset=utf-8" : "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(title, format);
  document.body.append(link);
  try { link.click(); } finally { link.remove(); URL.revokeObjectURL(url); }
}

export function ExportDialog({ engine, sessionKey, title, onClose, initialFormat = "markdown" }: { engine: WindowEngine; sessionKey: string; title: string; onClose: () => void; initialFormat?: TranscriptExportFormat }) {
  const [format, setFormat] = useState<TranscriptExportFormat>(initialFormat);
  const [includeToolDetails, setTools] = useState(true);
  const [includeTimestamps, setTimestamps] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => { controller.current?.abort(); onClose(); };
  const save = async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError(null);
    try {
      const blocks = await loadCompleteTranscript(engine, sessionKey, request.signal);
      request.signal.throwIfAborted();
      const options = { title, sessionKey, includeToolDetails, includeTimestamps };
      const render = format === "markdown" ? eventsToMarkdown : format === "replay" ? eventsToReplayHtml : eventsToHtml;
      downloadTranscript(render(blocks, options), title, format);
      close();
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  };
  return <Dialog title="Export conversation" onClose={close} testid="export-conversation" footer={<><button className="btn" onClick={close}>Not now</button><button className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Reading conversation…" : "Save file"}</button></>}>
    <p>Save this conversation as a file on this computer.</p>
    <div className="export-fields"><label>Format <select aria-label="Export format" value={format} disabled={busy} onChange={e => setFormat(e.target.value as TranscriptExportFormat)}><option value="markdown">Markdown</option><option value="html">HTML</option><option value="replay">HTML replay</option></select></label>
    <label><input type="checkbox" checked={includeToolDetails} disabled={busy} onChange={e => setTools(e.target.checked)} /> Include tool details</label>
    <label><input type="checkbox" checked={includeTimestamps} disabled={busy} onChange={e => setTimestamps(e.target.checked)} /> Include timestamps</label></div>
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}

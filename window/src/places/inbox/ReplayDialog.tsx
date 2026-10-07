import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { loadCompleteTranscript } from "../../transcript-export/load";
import { eventsToReplayHtml } from "../../transcript-export/replay-html";
import { errorText } from "./data";

export function ReplayDialog({ engine, sessionKey, title, onClose }: { engine: WindowEngine; sessionKey: string; title: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    setContent(null);
    setError(null);
    (async () => {
      try {
        const blocks = await loadCompleteTranscript(engine, sessionKey, request.signal);
        request.signal.throwIfAborted();
        setContent(eventsToReplayHtml(blocks, { title, sessionKey, includeToolDetails: true, includeTimestamps: true }));
      } catch (reason) {
        if (!request.signal.aborted) setError(errorText(reason));
      }
    })();
    return () => request.abort();
  }, [engine, sessionKey, title]);
  return <Dialog title="Watch a task again" onClose={onClose} wide testid="replay-dialog">
    {error ? <p className="ib-err" role="alert">{error}</p>
      : content ? <iframe sandbox="allow-scripts" srcDoc={content} title={`Replay: ${title}`} style={{ width: "100%", minHeight: "60vh", border: 0 }} />
      : <p className="ib-hint" role="status">Reading the conversation…</p>}
  </Dialog>;
}

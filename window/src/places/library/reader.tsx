// A read-only look at one file in a Trunk's project folder (agents.workspace.get), as a dialog.
import { useEffect, useRef } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { fileOf, useResource } from "./data";

export function FileDialog({ engine, agentId, path, line, onClose }: { engine: WindowEngine; agentId: string; path: string; line?: number; onClose: () => void }) {
  const file = useResource<unknown>(engine, "agents.workspace.get", { agentId, path });
  const at = useRef<HTMLSpanElement>(null);
  useEffect(() => { at.current?.scrollIntoView?.({ block: "center" }); }, [file.data]);
  const f = file.data ? fileOf(file.data) : null;
  const image = f?.encoding === "base64" && f.mimeType?.startsWith("image/");
  return <Dialog title={path.split("/").pop() || path} wide onClose={onClose} testid="file-dialog">
    <p className="lib-hint">{path} · read only</p>
    {file.loading && <p className="lib-hint" role="status">Loading…</p>}
    {file.error && <p className="lib-bad" role="alert">{file.error}</p>}
    {f && (image ? <img className="lib-img" alt={f.name} src={`data:${f.mimeType};base64,${f.content}`} />
      : f.encoding === "base64" ? <p className="lib-hint">This file isn’t text, so it can’t be shown here.</p>
      : <pre className="lib-pre">{(f.content ?? "").split("\n").map((l, i) => <span key={i} ref={line === i + 1 ? at : undefined} className={line !== undefined && i + 1 === line ? "lib-at" : undefined}>{l + "\n"}</span>)}</pre>)}
  </Dialog>;
}

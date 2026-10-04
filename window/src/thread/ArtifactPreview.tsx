import { useEffect, useRef, useState } from "react";
import { ArtifactChart } from "./ArtifactChart";
import { CodeBlock } from "./CodeBlock";
import { copyText, useThread } from "./context";
import { readChart, saveArtifact, sealedDocument, type ArtifactKind } from "./artifact-preview";
import "./artifact-preview.css";

function PreviewBody({ kind, text, title }: { kind: ArtifactKind; text: string; title: string }) {
  if (kind !== "chart") return <iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={sealedDocument(text)} />;
  try { return <ArtifactChart chart={readChart(text)} />; }
  catch (error) { return <p role="alert">{error instanceof Error ? error.message : String(error)}</p>; }
}

/** Reply artifacts are passive previews; interactive widgets keep their own native grants. */
export function ArtifactPreview({ kind, text }: { kind: ArtifactKind; text: string }) {
  const { engine, sessionKey, toast } = useThread();
  const [larger, setLarger] = useState(false), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""), [saved, setSaved] = useState(false);
  const lifetime = useRef({ active: true }), pending = useRef(false);
  const label = kind === "chart" ? "Chart" : kind === "svg" ? "Diagram" : "Page";
  let title: string = label;
  if (kind === "chart") { try { title = readChart(text).title; } catch { /* Body gives the parser error. */ } }
  const reason = !engine ? "Connect to save to Library." : !engine.agentId ? "The engine has not identified this Trunk."
    : !engine.scopes.includes("operator.admin") ? "Needs operator.admin access to save to Library." : "";
  useEffect(() => {
    const ticket = { active: true }; lifetime.current = ticket; pending.current = false;
    setBusy(false); setNotice(""); setSaved(false); setLarger(false);
    return () => { ticket.active = false; };
  }, [engine, sessionKey, engine?.agentId, kind, text]);
  async function save() {
    if (reason || !engine?.agentId || pending.current || saved) return;
    const ticket = lifetime.current, agentId = engine.agentId, sourceKey = engine.sessionKey;
    const current = () => ticket.active && lifetime.current === ticket && engine.agentId === agentId && engine.sessionKey === sourceKey && engine.scopes.includes("operator.admin");
    pending.current = true; setBusy(true); setNotice("");
    try {
      const path = await saveArtifact(engine, agentId, kind, text);
      if (current()) { setSaved(true); setNotice(`Saved to Library: ${path}.`); }
    } catch (error) {
      if (current()) setNotice(error instanceof Error ? error.message : String(error));
    } finally { if (current()) { pending.current = false; setBusy(false); } }
  }
  return <div className="artifact-preview">
    <div className="artifact-preview-head"><b>{title}</b><span className="pill">{label}</span></div>
    <p className="artifact-preview-note">Shown in a sealed frame: it can’t run a script, reach this page or reach the internet.</p>
    <PreviewBody kind={kind} text={text} title={title} />
    <div className="artifact-preview-actions">
      <button type="button" className="btn sm" onClick={() => setLarger(true)}>Open larger</button>
      <button type="button" className="btn sm" onClick={() => void copyText(text, toast)}>Copy code</button>
      <button type="button" className="btn sm" disabled={!!reason || busy || saved} title={reason || undefined} onClick={() => void save()}>{saved ? "In Library" : busy ? "Saving…" : "Save to Library"}</button>
    </div>
    {reason && <p className="artifact-preview-note">{reason}</p>}
    {notice && <p role="status" className="artifact-preview-note">{notice}</p>}
    <details><summary>The code that drew it</summary><CodeBlock lang={kind} text={text} /></details>
    {larger && <Expanded kind={kind} text={text} title={title} close={() => setLarger(false)} />}
  </div>;
}

function Expanded({ kind, text, title, close }: { kind: ArtifactKind; text: string; title: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="artifact-preview-dialog" onCancel={close} onClose={close}>
    <div className="artifact-preview-head"><b>{title}</b><button type="button" className="btn sm" onClick={close}>Close</button></div>
    <PreviewBody kind={kind} text={text} title={title} />
  </dialog>;
}

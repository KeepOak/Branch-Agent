// Library › Documents: a document you can type in (card #1095, walkthrough B-073). "Write a new document" opens the new
// blank document ready to type (the create result seeds the editor so it does not wait to load). Open on a text
// document in a Trunk's Documents folder does too. It loads the text through agents.workspace.get and saves through
// agents.documents.set, which only replaces the text it opened, so a Trunk's edit made meanwhile is never lost. At
// Regular the title is the document's name without its extension.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import { fileOf, plainFailure, rec, useResource } from "./data";

/** A document's name as people read it: "Untitled document", not "Untitled document.md". When another file beside it
 * would read the same ("plan.md" and "plan.txt"), both keep their extension; Advanced always shows it. */
export function documentTitle(name: string, level: Level, siblings: readonly string[] = []): string {
  if (shows(level, "advanced")) return name;
  const stem = (file: string) => { const dot = file.lastIndexOf("."); return dot > 0 ? file.slice(0, dot) : file; };
  const plain = stem(name);
  return siblings.some(other => other !== name && stem(other) === plain) ? name : plain;
}

/** Text documents the Library edits: the ones in a Trunk's Documents folder that "Write a new document" makes. */
export function editableDocument(path: string): boolean {
  return /^Documents\/[^/]+\.(md|markdown|txt)$/i.test(path);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The text and hash we already have (a new blank document from agents.documents.create), so typing starts at once. */
export type DocumentSeed = { content: string; hash: string };

export function DocumentEditor({ engine, agentId, path, level, onClose, onSaved, seed }: { engine: WindowEngine; agentId: string; path: string; level: Level; onClose: () => void; onSaved?: () => void; seed?: DocumentSeed }) {
  const file = useResource<unknown>(engine, "agents.workspace.get", { agentId, path });
  const loaded = file.data ? fileOf(file.data) : null;
  const name = path.split("/").pop() || path;
  const typed = useRef(false);
  const seededHash = useRef(seed?.hash ?? null);
  const [text, setText] = useState<string | null>(seed ? seed.content : null);
  // The text as last loaded or saved, and its hash: Save replaces only that text.
  const [saved, setSaved] = useState<string | null>(seed ? seed.content : null);
  const [base, setBase] = useState<string | null>(seed ? seed.hash : null);
  const [state, setState] = useState<{ busy: boolean; note?: string; error?: string }>({ busy: false });
  const [asking, setAsking] = useState(false);
  // A remote workspace has no atomic compare-and-set, so agents.workspace.get marks its files read only.
  const readOnly = rec(rec(file.data).file).readOnly === true;
  useEffect(() => {
    const first = file.data ? fileOf(file.data) : null;
    if (!first || first.encoding === "base64") return;
    const content = first.content ?? "";
    let live = true;
    // A person already typing in a new document keeps their words; a late fetch must not wipe them.
    if (!typed.current) {
      setText(content);
      setSaved(content);
      if (seededHash.current && content === (seed?.content ?? "")) setBase(seededHash.current);
      else {
        seededHash.current = null;
        setBase(null);
        void sha256(content).then(hash => { if (live) setBase(hash); });
      }
    }
    return () => { live = false; };
  }, [file.data, seed?.content]);
  const dirty = text !== null && text !== saved;
  /** Every way out (Close, the ×, Escape, the scrim) asks first when there is unsaved text. */
  const close = () => { if (dirty && !readOnly) setAsking(true); else onClose(); };
  async function save() {
    if (text === null || base === null || state.busy) return;
    setState({ busy: true });
    try {
      const result = rec(await engine.request<unknown>("agents.documents.set", { agentId, name, content: text, expectedHash: base }));
      const hash = rec(result.file).hash;
      setSaved(text);
      setBase(typeof hash === "string" ? hash : await sha256(text));
      setState({ busy: false, note: "Saved." });
      onSaved?.();
    } catch (error) {
      const type = rec(rec(error).details).type;
      setState({ busy: false, error: type === "document_changed" ? "Something changed since you looked. Look again." : "Couldn’t save it. Try again." });
    }
  }
  const footer = asking
    ? <><span className="lib-hint">Discard your changes?</span><button type="button" className="btn ghost" onClick={() => setAsking(false)}>Keep editing</button><button type="button" className="btn bad" onClick={onClose}>Discard</button></>
    : <><button type="button" className="btn ghost" onClick={close}>Close</button>
      {!readOnly && <button type="button" className="btn pri" disabled={text === null || base === null || state.busy || (!dirty && !state.error)} onClick={() => void save()}>Save</button>}</>;
  return <Dialog title={documentTitle(name, level)} wide onClose={close} testid="document-editor" footer={footer}>
    {shows(level, "advanced") && <p className="lib-hint">{path}</p>}
    {file.loading && text === null && <p className="lib-hint" role="status">Loading…</p>}
    {file.error && <p className="lib-bad" role="alert">{plainFailure(file.error)}</p>}
    {loaded?.encoding === "base64" && <p className="lib-hint">This file isn’t text, so it can’t be shown here.</p>}
    {readOnly && <p className="lib-hint">{documentTitle(name, level)} · read only</p>}
    {text !== null && <textarea className="inp lib-editor" aria-label={documentTitle(name, level)} autoFocus rows={16} value={text} readOnly={readOnly}
      onChange={event => { typed.current = true; setText(event.target.value); setState(s => (s.busy ? s : { busy: false })); }}
      onKeyDown={event => { if (!readOnly && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } }} />}
    {state.note && <p className="lib-hint" role="status">{state.note}</p>}
    {state.error && <p className="lib-bad" role="alert">{plainFailure(state.error)}</p>}
  </Dialog>;
}

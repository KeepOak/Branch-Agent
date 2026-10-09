// Settings › Instructions & personality, the file editor (DESIGN-SPEC §4.7.5.1): Edit · Preview (· Side by side on wide
// windows), Ctrl+S saves, "· unsaved" in the title, Escape asks before dropping changes, and "Changed on this computer"
// with Reload / Overwrite when the engine refuses a save because the file moved on (agents.files.set expectedHash).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { errorText, record, visible } from "../adapter";
import { fileTitle } from "./instructions-titles";
import { Btn, Seg, useSaved } from "../kit";

/** One editable document as the engine last gave it: its text, its revision (null while missing). */
export type Doc = { content: string; hash: string | null; missing: boolean };
/** An instruction file in a Trunk's folder (agents.files.get). */
export type FileState = Doc & { name: string; path?: string; error?: string };

export function lineCount(t: string): number {
  const s = t.trim();
  return s ? s.split("\n").length : 0;
}
export const linesText = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/** The engine refused the save because the file changed after it was read. */
export function isConflict(error: unknown): boolean {
  const type = record(record(error).details).type;
  return type === "agent_file_conflict" || type === "personal_file_conflict" || /changed since it was read/i.test(errorText(error));
}

export async function readFile(engine: WindowEngine, agentId: string, name: string): Promise<FileState> {
  const f = record(record(await engine.request("agents.files.get", { agentId, name })).file);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return { name, path: str(f.path), content: str(f.content) ?? "", hash: str(f.hash) ?? null, missing: f.missing === true };
}

export function writeFile(engine: WindowEngine, agentId: string, name: string, content: string, on: Doc) {
  if (!on.missing && !on.hash) throw new Error("The engine did not give this file’s revision. Reload before saving.");
  return engine.request("agents.files.set", { agentId, name, content, ...(on.missing ? { expectedMissing: true } : { expectedHash: on.hash }) });
}

type Io = { load: () => Promise<Doc>; save: (text: string, base: Doc) => Promise<unknown> };

/** The draft every editor here shares: dirty state, the ask before discarding, saving, Reload and Overwrite. */
export function useDraft(initial: Doc, io: Io, onSaved: () => void) {
  const report = useSaved();
  const [base, setBase] = useState(initial);
  const [text, setText] = useState(initial.content);
  const [ask, setAsk] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fail = (e: unknown) => { setError(visible(errorText(e))); report.failed(errorText(e)); };
  const write = async (on: Doc) => {
    setBusy(true); setError("");
    try { await io.save(text, on); report.saved(); onSaved(); }
    catch (e) { if (isConflict(e)) setConflict(true); else fail(e); }
    finally { setBusy(false); }
  };
  const fresh = async () => { const d = await io.load(); setBase(d); setConflict(false); return d; };
  const reload = async () => { try { const d = await fresh(); setText(d.content); } catch (e) { fail(e); } };
  const overwrite = async () => { try { await write(await fresh()); } catch (e) { fail(e); } };
  return { base, text, setText, ask, setAsk, conflict, busy, error, dirty: text !== base.content, save: () => write(base), reload, overwrite };
}
export type Draft = ReturnType<typeof useDraft>;

/** Escape and ×: back to editing while asking, ask while there are changes, otherwise close. */
export function closer(d: Draft, close: () => void) {
  return () => { if (d.ask) d.setAsk(false); else if (d.dirty) d.setAsk(true); else close(); };
}
/** Ctrl+S (⌘S) saves when saving is allowed. */
export function saveKeys(d: Draft, can: boolean) {
  return (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (can) void d.save(); }
  };
}

export function ConflictBox({ d }: { d: Draft }) {
  if (!d.conflict) return null;
  return (
    <div className="if-conflict" role="alert">
      <div className="grow"><b>Changed on this computer</b><p>This file changed on this computer after you started editing. Reload to take that version, or Overwrite to replace it with yours.</p></div>
      <span className="if-acts"><Btn sm onClick={() => void d.reload()}>Reload</Btn><button type="button" className="btn bad sm" onClick={() => void d.overwrite()}>Overwrite</button></span>
    </div>
  );
}

export function AskFoot({ d, question, onDiscard }: { d: Draft; question: string; onDiscard: () => void }) {
  return <><span className="if-ask">{question}</span><Btn ghost onClick={() => d.setAsk(false)}>Keep editing</Btn><button type="button" className="btn bad" onClick={onDiscard}>Discard</button></>;
}

/** Puts the caret in the text once the dialog has placed its own focus. */
export function useFocusText() {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return ref;
}

const JOB_HEADING = "\n\n## This Trunk’s job\n\n";
function jobParts(content: string) {
  const at = content.lastIndexOf(JOB_HEADING);
  return at < 0 ? { before: content.trimEnd(), job: "" } : { before: content.slice(0, at), job: content.slice(at + JOB_HEADING.length).replace(/\n$/, "") };
}

type Mode = "edit" | "preview" | "side";
type EditorProps = { engine: WindowEngine; agentId: string; file: FileState; owner: string; onClose: (saved: boolean) => void };

/** The editor for one instruction file in a Trunk's folder. */
export function FileEditor({ engine, agentId, file, owner, onClose }: EditorProps) {
  const d = useDraft(file, { load: () => readFile(engine, agentId, file.name), save: (t, on) => writeFile(engine, agentId, file.name, t, on) }, () => onClose(true));
  const [mode, setMode] = useState<Mode>("edit");
  const [advanced, setAdvanced] = useState(file.name !== "SOUL.md");
  const guided = file.name === "SOUL.md";
  const parts = jobParts(d.text);
  const wide = typeof window !== "undefined" && window.innerWidth > 1180;
  const ref = useFocusText();
  const shown: Mode = mode === "side" && !wide ? "edit" : mode;
  const modes = [{ id: "edit", label: "Edit" }, { id: "preview", label: "Preview" }, ...(wide ? [{ id: "side", label: "Side by side" }] : [])];
  const can = !d.busy && !d.conflict;
  const foot = d.ask
    ? <AskFoot d={d} question="Discard your changes?" onDiscard={() => onClose(false)} />
    : <><Btn ghost onClick={closer(d, () => onClose(false))}>Cancel</Btn><Btn pri disabled={!can} onClick={() => void d.save()}>Save</Btn></>;
  return (
    <Dialog title={`${fileTitle(file.name)} · ${owner}${d.dirty ? " · unsaved" : ""}`} wide onClose={closer(d, () => onClose(false))} footer={foot} testid="instruction-file">
      <div className="if-ed" onKeyDown={saveKeys(d, can)}>
        <ConflictBox d={d} />
        {d.base.missing ? <p className="hint if-made">It’s made when you save.</p> : null}
        {guided ? <label className="if-guided">
          <b>Describe this Trunk’s job</b>
          <p className="hint">What should it help with? Include the tone you prefer and anything it should ask before doing. Saving adds this to its existing instructions.</p>
          <textarea className="inp" rows={5} aria-label="Describe this Trunk’s job" value={parts.job} disabled={d.busy} onChange={(e) => d.setText(`${parts.before}${JOB_HEADING}${e.target.value}\n`)} />
        </label> : null}
        <details open={advanced} onToggle={(e) => setAdvanced(e.currentTarget.open)}>
          <summary>Advanced · edit the full instructions</summary>
        {advanced ? <>
        <Seg label="Edit or preview" value={shown} options={modes} onChange={(m) => setMode(m as Mode)} />
        <div className={`if-panes if-${shown}`}>
          {shown !== "preview" ? <textarea ref={ref} className="inp if-text" rows={14} spellCheck={false} aria-label={file.name} value={d.text} onChange={(e) => d.setText(e.target.value)} /> : null}
          {shown !== "edit" ? <div className="if-prev" aria-label="Preview"><Markdown text={d.text} /></div> : null}
        </div>
        </> : null}
        </details>
        {d.error ? <p className="if-error" role="alert">{d.error}</p> : null}
      </div>
    </Dialog>
  );
}

/** A small Markdown reader for the preview: headings, lists, paragraphs, `code`, **bold** and *italic*. */
export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => { if (items.length) out.push(<ul key={out.length}>{items.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); items = []; };
  for (const line of text.split("\n")) {
    const h = /^(#{1,3})\s+(.*)/.exec(line), li = /^\s*[-*]\s+(.*)/.exec(line);
    if (li) { items.push(li[1]); continue; }
    flush();
    if (h) out.push(h[1].length === 1 ? <h3 key={out.length}>{inline(h[2])}</h3> : h[1].length === 2 ? <h4 key={out.length}>{inline(h[2])}</h4> : <h5 key={out.length}>{inline(h[2])}</h5>);
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>);
  }
  flush();
  return out.length ? <>{out}</> : <p className="hint">Nothing written yet.</p>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 1) return <i key={i}>{part.slice(1, -1)}</i>;
    return part;
  });
}

// The small controls every editor row shares: the quiet "Saved" tick, the one Undo line, and a text field that applies on blur or Enter.
import { createContext, useContext, useEffect, useState } from "react";
import { WRITE_WHY } from "./data";
import type { FieldKey } from "./draft-fields";

export type EditState = { saved: ReadonlySet<FieldKey>; write: boolean };
export const EditContext = createContext<EditState>({ saved: new Set(), write: false });

export function Saved({ field }: { field?: FieldKey }) {
  const { saved } = useContext(EditContext);
  return field && saved.has(field) ? <span className="tk-saved" role="status">✓ Saved</span> : null;
}

export function UndoLine({ label, onUndo }: { label: string; onUndo: () => void }) {
  return <p className="tk-undo" role="status"><span>{label}.</span> <button type="button" className="btn sm" onClick={onUndo}>Undo</button></p>;
}

/** A text field that applies when it loses focus or Enter is pressed, so typing doesn't write every keystroke. */
export function CommitInput({ label, value, onCommit }: { label: string; value: string; onCommit: (text: string) => void }) {
  const { write } = useContext(EditContext);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const next = text.trim();
    if (!next || next === value) { setText(value); return; }
    onCommit(next);
  };
  return <input className="inp" aria-label={label} value={text} disabled={!write} title={write ? undefined : WRITE_WHY} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />;
}

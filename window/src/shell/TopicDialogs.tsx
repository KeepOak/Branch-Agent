// The two dialogs a topic tab opens in R1: "New topic" (the rail's round +) and "Delete…" (the tab's menu).
import { useState } from "react";
import { Dialog } from "./Dialog";
import { ROW_COLOURS } from "./row-look";
import type { NewTopicDraft } from "./topic-create";
import { plainError } from "../shell/plain-error";

const ICONS = ["💬", "🧠", "📌", "🧾", "📅", "🛠️", "✈️", "🏠", "📈", "🎨", "🌱", "🔬"];

/** "New topic": name, icon and colour, who is in it (the Trunk and you), Cancel and Create. */
export function NewTopicSheet({ trunkName, clear, onCancel, onCreate }: {
  trunkName: string; clear?: boolean; onCancel: () => void; onCreate: (draft: NewTopicDraft) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(ICONS[0]!);
  const [colour, setColour] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const value = name.trim();
    if (!value) { setError("Give the topic a name."); return; }
    setBusy(true); setError("");
    try { await onCreate({ name: value, icon, colour }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return <Dialog title="New topic" clear={clear} onClose={onCancel} testid="new-topic"
    footer={<><button className="btn ghost" type="button" onClick={onCancel}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={() => void submit()}>Create</button></>}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="fld"><span>Name</span><input className="inp" autoFocus maxLength={60} placeholder="What is it about?" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="fld"><span>Icon and colour</span>
        <div role="group" aria-label="Icon" className="tpPickGridP17">{ICONS.map((item) => <button key={item} type="button" aria-pressed={item === icon} onClick={() => setIcon(item)}>{item}</button>)}</div>
        <div role="group" aria-label="Colour" className="tpPickGridP17">{ROW_COLOURS.map((item) => <button key={item.id} type="button" className="tpSwatchP17" aria-label={item.name} aria-pressed={colour === item.id} title={item.name} onClick={() => setColour(colour === item.id ? null : item.id)} style={{ ["--c" as string]: item.hue }} />)}</div>
      </div>
      <div className="fld"><span>Who’s in it</span><p className="pp">{trunkName} and you.</p></div>
      {error ? <p className="tpErrorT5" role="alert">{plainError(error)}</p> : null}
    </form>
  </Dialog>;
}

/** "Delete “<title>”?" for one topic. The engine's delete is final, as R1's conversation delete is. */
export function DeleteTopicDialog({ title, clear, onCancel, onDelete }: { title: string; clear?: boolean; onCancel: () => void; onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remove = async () => {
    setBusy(true); setError("");
    try { await onDelete(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  return <Dialog title={`Delete “${title}”?`} clear={clear} onClose={onCancel} testid="delete-topic"
    footer={<><button className="btn ghost" type="button" onClick={onCancel}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={() => void remove()} style={{ background: "var(--bad)" }}>Delete</button></>}>
    <p className="pp">Deleting is final for now.</p>
    {error ? <p className="tpErrorT5" role="alert">{plainError(error)}</p> : null}
  </Dialog>;
}

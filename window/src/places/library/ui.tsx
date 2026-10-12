// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { Icon } from "../../shell/icons";
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { useOperation, useResource, type FileEntry, type Trunk, trunkName } from "./data";
import "./places.css";
export function Tabs({ values, value, onChange, label }: { values: string[]; value: string; onChange: (s: string) => void; label: string }) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === "ArrowRight" ? (index + 1) % values.length : event.key === "ArrowLeft" ? (index - 1 + values.length) % values.length : event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onChange(values[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return <div className="kp-tabs" role="tablist" aria-label={label}>{values.map((v, index) => <button key={v} type="button" role="tab" aria-selected={v === value} tabIndex={v === value ? 0 : -1} onKeyDown={event => move(event, index)} onClick={() => onChange(v)}>{v}</button>)}</div>;
}
export function Status({ loading, error, reload }: { loading: boolean; error: string | null; reload: () => void }) {
  return loading ? <p role="status" className="kp-hint">Loading…</p> : error ? <div role="alert" className="kp-error"><p>{error}</p><button onClick={reload}>Try again</button></div> : null;
}
export function Unavailable({ children }: { children: ReactNode }) { return <div className="kp-empty"><span className="kp-empty-icon"><Icon name="book" /></span><p>{children}</p></div>; }
export function TrunkPicker({ trunks, value, change }: { trunks: Trunk[]; value: string; change: (v: string) => void }) {
  return <label className="kp-picker">Trunk <select aria-label="Trunk" value={value} onChange={e => change(e.target.value)}>{trunks.map(t => <option key={t.id} value={t.id}>{trunkName(t)}</option>)}</select></label>;
}
/** Hash-checked edits follow the upstream file editor, retaining the draft on conflict. */
export function FileEditor({ engine, agentId, name, label = name }: { engine: WindowEngine; agentId: string; name: string; label?: string }) {
  const resource = useResource<{ file: FileEntry }>(engine, "agents.files.get", { agentId, name });
  const op = useOperation(engine);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const file = resource.data?.file;
  const content = draft ?? file?.content ?? "";
  return <section className="kp-detail">
    <h2>{label}</h2><Status {...resource} />
    {file && <><p className="kp-hint">{file.missing ? "Nothing written yet." : "Stored in this Trunk’s workspace."}</p>
      <textarea aria-label={label} value={content} onChange={e => { setDraft(e.target.value); setSaved(false); }} disabled={op.busy} />
      <div className="kp-toolbar"><button disabled={op.busy || (!file.missing && !file.hash) || draft === null || draft === (file.content ?? "")} onClick={() => {
        if (!file.missing && !file.hash) return;
        void op.run<{ ok: boolean }>("agents.files.set", { agentId, name, content, ...(file.hash ? { expectedHash: file.hash } : file.missing ? { expectedMissing: true } : {}) }, () => { setDraft(null); setSaved(true); resource.reload(); });
      }}>{op.busy ? "Saving…" : "Save"}</button><button disabled={op.busy} onClick={resource.reload}>Reload stored version</button></div>
      {saved && <p role="status">Saved.</p>}{op.error && <p role="alert" className="kp-error">{op.error} Your draft is kept. Reload the stored version before trying again.</p>}
      {!file.missing && !file.hash && <p role="alert" className="kp-error">The engine did not provide a document revision. Reload before saving.</p>}
    </>}
  </section>;
}

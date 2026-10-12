// Canopy › Cards dialogs (§4.6.7): New card / Edit card, New board / Edit board, Edit <n> cards and the confirmations.
import { useState, type ReactNode } from "react";
import { Dialog } from "../../shell/Dialog";
import { Segmented } from "../../shell/Popover";
import { str, type Row } from "../automations/runtime";
import { sessionTitle, trunkName } from "./data";
import { PRIOS, STATUSES, SUGGESTIONS, TINTS } from "./cards-model";
import type { Ctx } from "./ui";

export type CardDraft = { title: string; notes: string; status: string; priority: string; agentId: string; sessionKey: string; labels: string; templateId: string };
export const draftOf = (c?: Row, status = "todo"): CardDraft => ({
  title: str(c?.title), notes: str(c?.notes), status: str(c?.status) || status, priority: str(c?.priority) || "normal", agentId: str(c?.agentId),
  sessionKey: str(c?.sessionKey), labels: Array.isArray(c?.labels) ? c.labels.join(", ") : "", templateId: "",
});
const labelsOf = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);

/** Create params (canopy.cards.create) or the update patch (canopy.cards.update) for a draft. */
export function cardPatch(d: CardDraft, base?: Row): Row {
  const patch: Row = { title: d.title.trim(), notes: d.notes, status: d.status, priority: d.priority, labels: labelsOf(d.labels) };
  if (d.agentId || base?.agentId) patch.agentId = d.agentId || null;
  if (d.sessionKey || base?.sessionKey) patch.sessionKey = d.sessionKey || null;
  if (d.templateId && !base) patch.templateId = d.templateId;
  return patch;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="cn-fld"><span>{label}</span>{children}</label>; }

export function CardDialog({ ctx, base, start, save, close }: { ctx: Ctx; base?: Row; start: CardDraft; save: (d: CardDraft) => Promise<boolean>; close: () => void }) {
  const [d, setD] = useState(start), [asking, setAsking] = useState(false), [bad, setBad] = useState(false);
  const dirty = JSON.stringify(d) !== JSON.stringify(start), set = (p: Partial<CardDraft>) => setD({ ...d, ...p });
  const leave = () => dirty && (d.title || d.notes) ? setAsking(true) : close();
  if (asking) return <Dialog title={base ? "Discard changes?" : "Discard this card?"} onClose={() => setAsking(false)}
    footer={<><button className="btn ghost" type="button" onClick={() => setAsking(false)}>Keep editing</button><button className="btn pri" type="button" onClick={close}>Discard</button></>}>
    {base ? <p className="dlg-p">Your changes will be lost.</p> : null}</Dialog>;
  const submit = async () => { if (!d.title.trim()) return setBad(true); if (await save(d)) close(); };
  const suggest = ([, tpl, pre, notes]: (typeof SUGGESTIONS)[number]) => set({ title: d.title.startsWith(pre) ? d.title : pre + d.title, notes: d.notes.includes(notes.split("\n")[0]) ? d.notes : (d.notes ? d.notes + "\n" : "") + notes, templateId: tpl });
  return (
    <Dialog title={base ? "Edit card" : "New card"} onClose={leave} testid="cn-card-dialog"
      footer={<><button className="btn ghost" type="button" onClick={leave}>Cancel</button><button className="btn pri" type="button" disabled={ctx.busy} onClick={() => void submit()}>{base ? "Save" : "Create"}</button></>}>
      {base ? <p className="cn-hint cn-flush">Change the card and who works on it.</p> : null}
      <Field label="Title"><input className="inp" autoFocus value={d.title} aria-invalid={bad} placeholder="Card title" autoComplete="off" onChange={e => { setBad(false); set({ title: e.target.value }); }} /></Field>
      {!base ? <div className="cn-fld"><span>Suggestions</span><span className="cn-sugg">{SUGGESTIONS.map(s => <button key={s[0]} className="btn sm" type="button" onClick={() => suggest(s)}>{s[0]}</button>)}</span></div> : null}
      <Field label="Notes"><textarea className="inp" rows={4} value={d.notes} placeholder="Notes, what done looks like, links" onChange={e => set({ notes: e.target.value })} /></Field>
      <div className="cn-grid2">
        <Field label="Status"><select className="inp" value={d.status} onChange={e => set({ status: e.target.value })}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Trunk"><select className="inp" value={d.agentId} onChange={e => set({ agentId: e.target.value })}><option value="">Default Trunk ({trunkName(ctx.d, ctx.d.defaultTrunk)})</option>{ctx.d.trunks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      </div>
      <div className="cn-fld"><span>Priority</span><Segmented label="Priority" value={d.priority} options={PRIOS.map(([id, name]) => ({ id, name }))} onChange={v => set({ priority: v })} /></div>
      <div className="cn-grid2">
        <Field label="Conversation"><select className="inp" value={d.sessionKey} onChange={e => set({ sessionKey: e.target.value })}><option value="">None</option>{ctx.d.sessions.map(s => <option key={str(s.key)} value={str(s.key)}>{sessionTitle(s)}</option>)}</select></Field>
        <Field label="Labels"><input className="inp" value={d.labels} placeholder="for example ui, docs" onChange={e => set({ labels: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

export type BoardDraft = { id?: string; kind: "cards" | "sessions"; name: string; color: string };

export function BoardDialog({ start, save, close, busy }: { start: BoardDraft; save: (b: BoardDraft, reset?: boolean) => Promise<boolean>; close: () => void; busy: boolean }) {
  const [b, setB] = useState(start), [bad, setBad] = useState(false);
  const submit = async (reset?: boolean) => { if (!b.name.trim()) return setBad(true); if (await save(b, reset)) close(); };
  return (
    <Dialog title={b.id ? "Edit board" : "New board"} onClose={close}
      footer={<><button className="btn ghost" type="button" onClick={close}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={() => void submit()}>{b.id ? "Save" : "Create"}</button></>}>
      {!b.id ? <div className="cn-fld"><span>Kind</span><Segmented label="Kind" value={b.kind} options={[{ id: "cards", name: "Cards" }, { id: "sessions", name: "Conversations" }]} onChange={v => setB({ ...b, kind: v })} /><small className="cn-hint">Can’t be changed later.</small></div> : null}
      <Field label="Name"><input className="inp" autoFocus value={b.name} aria-invalid={bad} autoComplete="off" onChange={e => { setBad(false); setB({ ...b, name: e.target.value }); }} /></Field>
      <div className="cn-fld"><span>Colour</span><span className="cn-tints" role="radiogroup" aria-label="Colour">{TINTS.map(([n, v]) => (
        <button key={n} type="button" role="radio" aria-checked={b.color === v} title={n} aria-label={n} onClick={() => setB({ ...b, color: v })}><i className="cn-dot" style={{ ["--c" as string]: v || "var(--ink-3)" }} /></button>))}</span>
        {b.id ? <button className="link cn-left" type="button" disabled={busy} onClick={() => void submit(true)}>Reset the look</button> : null}</div>
    </Dialog>
  );
}

export function Confirm({ title, body, yes, no, run, close, busy }: { title: string; body: string; yes: string; no: string; run: () => Promise<boolean>; close: () => void; busy: boolean }) {
  return <Dialog title={title} onClose={close} footer={<><button className="btn ghost" type="button" onClick={close}>{no}</button><button className="btn bad" type="button" disabled={busy} onClick={() => void run().then(ok => ok && close())}>{yes}</button></>}><p className="dlg-p">{body}</p></Dialog>;
}

export type BulkDraft = { status: string; priority: string; agentId: string; lab: "keep" | "add" | "replace" | "remove"; labels: string };

export function BulkDialog({ ctx, n, apply, close }: { ctx: Ctx; n: number; apply: (b: BulkDraft) => Promise<boolean>; close: () => void }) {
  const [b, setB] = useState<BulkDraft>({ status: "", priority: "", agentId: "", lab: "keep", labels: "" }), [going, setGoing] = useState(false);
  const keep = <option value="">Keep as it is</option>;
  const go = async () => { setGoing(true); const ok = await apply(b); setGoing(false); if (ok) close(); };
  return (
    <Dialog title={`Edit ${n} cards`} onClose={close} footer={<><button className="btn ghost" type="button" onClick={close}>Cancel</button><button className="btn pri" type="button" disabled={going} onClick={() => void go()}>{going ? "Applying…" : "Apply changes"}</button></>}>
      <p className="cn-hint cn-flush">Changes apply to every selected card.</p>
      <div className="cn-grid2">
        <Field label="Status"><select className="inp" value={b.status} onChange={e => setB({ ...b, status: e.target.value })}>{keep}{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Priority"><select className="inp" value={b.priority} onChange={e => setB({ ...b, priority: e.target.value })}>{keep}{PRIOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <Field label="Trunk"><select className="inp" value={b.agentId} onChange={e => setB({ ...b, agentId: e.target.value })}>{keep}{ctx.d.trunks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <div className="cn-fld"><span>Labels</span><Segmented label="Labels" value={b.lab} onChange={v => setB({ ...b, lab: v })}
        options={[{ id: "keep", name: "Keep as they are" }, { id: "add", name: "Add labels" }, { id: "replace", name: "Replace labels" }, { id: "remove", name: "Remove labels" }]} />
        {b.lab !== "keep" ? <input className="inp" value={b.labels} placeholder="Labels, separated by commas" aria-label="Labels, separated by commas" onChange={e => setB({ ...b, labels: e.target.value })} /> : null}</div>
    </Dialog>
  );
}
export { labelsOf };

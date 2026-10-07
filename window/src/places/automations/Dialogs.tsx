// The schedule row menu's dialogs (§4.6.3.1): Remove…, Change where it sends… and When it fails….
// Each sends one cron.remove / cron.update with only its own field.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { Segmented } from "../../shell/Popover";
import { shows, type Level } from "../../places-nav/level";
import { draftFromJob, failureParams, failurePolicy, sendsToParams, type Draft, type FailurePolicy } from "./draft";
import { jobName } from "./model";
import { Field, SendsToFields, type Trunk } from "./Proposal";
import { errorText, str, type Row } from "./runtime";

type Act = (method: string, params: Row, message: string) => Promise<boolean>;

export function RemoveDialog({ job, act, onClose, busy }: { job: Row; act: Act; onClose: () => void; busy: boolean }) {
  const name = jobName(job);
  return <Dialog title={`Remove “${name}”?`} onClose={onClose} footer={<><button type="button" className="btn ghost sm" onClick={onClose}>Keep it</button><button type="button" className="btn bad sm" disabled={busy} onClick={() => void act("cron.remove", { id: str(job.id) }, `Removed ${name}.`).then(ok => ok && onClose())}>Remove</button></>}>
    <p>It stops every future run and can’t be brought back. Its past runs stay in History.</p>
  </Dialog>;
}

export function SendsDialog({ job, act, onClose, busy, level, trunks, engine }: { job: Row; act: Act; onClose: () => void; busy: boolean; level: Level; trunks: Trunk[]; engine?: WindowEngine }) {
  const [d, setD] = useState<Draft>(() => draftFromJob(job, "copy")), [error, setError] = useState("");
  const trunk = trunks.find(t => t.id === str(job.agentId))?.name || trunks[0]?.name || "the Trunk";
  const save = () => { try { setError(""); void act("cron.update", sendsToParams(job, d), "Saved where it sends.").then(ok => ok && onClose()); } catch (e) { setError(errorText(e)); } };
  return <Dialog title={`Where ${jobName(job)} sends`} onClose={onClose} footer={<><button type="button" className="btn ghost sm" onClick={onClose}>Cancel</button><button type="button" className="btn pri sm" disabled={busy} onClick={save}>Save</button></>}>
    <SendsToFields draft={d} change={p => setD(old => ({ ...old, ...p }))} level={level} trunk={trunk} engine={engine} />
    {d.sendsTo === "conversation" && <p className="au-hint">Other people in that chat will see each result.</p>}
    {error && <p className="au-error" role="alert">{error}</p>}
  </Dialog>;
}

export function FailDialog({ job, act, onClose, busy, level }: { job: Row; act: Act; onClose: () => void; busy: boolean; level: Level }) {
  const [p, setP] = useState<FailurePolicy>(() => failurePolicy(job)), [error, setError] = useState("");
  const set = (x: Partial<FailurePolicy>) => setP(old => ({ ...old, ...x }));
  const save = () => { try { setError(""); void act("cron.update", failureParams(job, p), "Saved what happens when it fails.").then(ok => ok && onClose()); } catch (e) { setError(errorText(e)); } };
  return <Dialog title={`When ${jobName(job)} fails`} onClose={onClose} footer={<><button type="button" className="btn ghost sm" onClick={onClose}>Cancel</button><button type="button" className="btn pri sm" disabled={busy} onClick={save}>Save</button></>}>
    <Segmented label="When it fails" value={p.use} options={[{ id: "usual", name: "Use the usual setting" }, { id: "off", name: "Don’t alert" }, { id: "own", name: "Its own" }]} onChange={use => set({ use })} />
    {p.use === "own" && <>
      <Field label="Alert after"><span className="au-inline"><input className="inp au-num" type="number" min="1" aria-label="Alert after" value={p.after} onChange={e => set({ after: e.target.value })} /><span>failures in a row</span></span></Field>
      <Field label="Wait at least"><span className="au-inline"><input className="inp au-num" type="number" min="0" aria-label="Wait at least" value={p.cooldown} onChange={e => set({ cooldown: e.target.value })} /><span>minutes between alerts</span></span></Field>
      <Field label="How"><Segmented label="How" value={p.how} options={[{ id: "announce", name: "As a message" }, { id: "webhook", name: "To a web address" }]} onChange={how => set({ how })} /></Field>
      {(p.how === "webhook" || shows(level, "technical")) && <Field label={p.how === "webhook" ? "Web address" : "Recipient"}><input className="inp au-mono" aria-label={p.how === "webhook" ? "Web address" : "Recipient"} value={p.to} onChange={e => set({ to: e.target.value })} /></Field>}
    </>}
    {p.use === "off" && <p className="au-hint">It still sends the one notice when it turns itself off.</p>}
    {error && <p className="au-error" role="alert">{error}</p>}
  </Dialog>;
}

/** Closing a changed Change… card (preview p35-prop ppno17d): "Keep editing" stays, "Leave" drops the edits. */
export function LeaveDialog({ onKeep, onLeave }: { onKeep: () => void; onLeave: () => void }) {
  return <Dialog title="Leave without saving?" onClose={onKeep} testid="au-leave" footer={<><button type="button" className="btn ghost" onClick={onKeep}>Keep editing</button><button type="button" className="btn pri" onClick={onLeave}>Leave</button></>}>
    <p className="au-p">Your changes to this schedule aren’t saved.</p>
  </Dialog>;
}

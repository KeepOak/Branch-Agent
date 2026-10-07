// The thread's dialogs (DESIGN-SPEC §4.2.6): Edit and send again, Branch from here, Look inside; and the
// reaction chips under a message.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Reaction } from "./actions";
import { copyText, useThread } from "./context";
import { Dialog } from "./Dialog";
import { formatDuration, modelName } from "./format";
import type { MessageMeta } from "./model";
import { formatMoney } from "../format/money";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function EditDialog({ text, onClose, onSend }: { text: string; onClose: () => void; onSend: (words: string) => Promise<void> }) {
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    setBusy(true);
    onSend(value.trim()).then(onClose, (e: unknown) => {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    });
  };
  const footer = (
    <>
      <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary" data-action="send-edit" disabled={busy || !value.trim()} onClick={send}>Send</button>
    </>
  );
  return (
    <Dialog title="Edit and send again" onClose={onClose} footer={footer} testid="edit-dialog">
      <textarea className="inp area" aria-label="Your message" value={value} onChange={(e) => setValue(e.target.value)} rows={4} />
      <div className="field">
        <span className="field-label">Go back to just before this message</span>
        <div className="seg" role="radiogroup">
          <button type="button" role="radio" aria-checked="false" disabled title="Not available in this engine yet: putting files back (sessions.rewind restores the conversation only).">Conversation and files</button>
          <button type="button" role="radio" aria-checked="true" className="on">Conversation only</button>
          <button type="button" role="radio" aria-checked="false" disabled title="Not available in this engine yet: putting files back (sessions.rewind restores the conversation only).">Files only</button>
        </div>
      </div>
      <p className="hint">“Undo that” puts everything back the way it was.</p>
      {error ? <p className="field-error">{error}</p> : null}
    </Dialog>
  );
}

function useModels(engine?: WindowEngine): string[] {
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    if (!engine) return;
    engine.request("models.list", {}).then(
      (r) => setModels((Array.isArray(rec(r).models) ? (rec(r).models as unknown[]) : []).map((m) => `${str(rec(m).provider)}/${str(rec(m).id)}`)),
      () => setModels([]),
    );
  }, [engine]);
  return models;
}

export function BranchDialog({ onClose, onBranch }: { onClose: () => void; onBranch: (o: { label: string; model: string }) => Promise<void> }) {
  const { engine } = useThread();
  const models = useModels(engine);
  const [label, setLabel] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setBusy(true);
    onBranch({ label, model }).then(onClose, (e: unknown) => {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    });
  };
  const footer = (
    <>
      <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary" data-action="branch" disabled={busy} onClick={go}>Branch from here</button>
    </>
  );
  return (
    <Dialog title="Branch from here" onClose={onClose} footer={footer} testid="branch-dialog">
      <label className="field">
        <span className="field-label">Name</span>
        <input className="inp" value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Model</span>
        <select className="inp" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">The same model</option>
          {models.map((m) => <option key={m} value={m}>{modelName(m)}</option>)}
        </select>
      </label>
      {error ? <p className="field-error">{error}</p> : null}
    </Dialog>
  );
}

type Inspect = { meta?: MessageMeta; durationMs?: number; steps: number };

/** "Look inside": what went into the Trunk's reply, all read from the engine. */
export function LookInside({ inspect, onClose }: { inspect: Inspect; onClose: () => void }) {
  const { engine, name, toast } = useThread();
  const [context, setContext] = useState<number | null>(null);
  const [tools, setTools] = useState<string[] | null>(null);
  useEffect(() => {
    if (!engine?.sessionKey) return;
    engine.request("sessions.describe", { key: engine.sessionKey }).then((r) => setContext(Number(rec(rec(r).session).contextTokens) || null), () => setContext(null));
    engine.request("tools.effective", { sessionKey: engine.sessionKey }).then(
      (r) => setTools((Array.isArray(rec(r).groups) ? (rec(r).groups as unknown[]) : []).flatMap((g) => (Array.isArray(rec(g).tools) ? (rec(g).tools as unknown[]) : []).map((t) => str(rec(t).label) || str(rec(t).id)))),
      () => setTools(null),
    );
  }, [engine]);
  const u = inspect.meta?.usage;
  const words = u?.total ? (context ? `${u.total.toLocaleString()} of ${context.toLocaleString()} (${Math.round((u.total / context) * 100)}%)` : u.total.toLocaleString()) : "";
  const rows: [string, string][] = [
    ["Model", modelName(inspect.meta?.model)],
    ["Context tokens", words],
    ["Tools offered", tools ? tools.join(", ") : ""],
    ["Time", formatDuration(inspect.durationMs)],
    ["Cost", u ? formatMoney(u.cost ?? 0) : ""],
    ["Steps", `${inspect.steps} in this task · model calls, tools and approvals`],
  ];
  const record = JSON.stringify({ ...inspect, contextTokens: context, tools }, null, 2);
  const footer = <button type="button" className="btn" onClick={() => void copyText(record, toast)}>Copy the record</button>;
  return (
    <Dialog title="Look inside" onClose={onClose} footer={footer} testid="look-inside">
      <p className="lede">What went into {name}’s last reply.</p>
      <dl className="kv">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="kv-row"><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Dialog>
  );
}

/** Reaction chips under a message (§4.2.6 Parity adds "React"); a chip adds or removes yours. */
export function ReactionChips({ list, onToggle }: { list: Reaction[]; onToggle: (emoji: string, remove: boolean) => void }) {
  if (!list.length) return null;
  return (
    <div className="reactions" data-testid="reactions">
      {list.map((r) => (
        <button key={r.emoji} type="button" className={r.mine ? "chip-r on" : "chip-r"} aria-pressed={r.mine}
          title={`${r.names.join(", ")} reacted with ${r.emoji}`} onClick={() => onToggle(r.emoji, r.mine)}>
          <span>{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}
    </div>
  );
}

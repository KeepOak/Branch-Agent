// "Have Branch make a Trunk" (preview 30-trunks mk-new): the words go to Branch's own assistant through branch.chat
// with its "new-agent" welcome (engine/src/gateway/server-methods/system-agent.ts). It proposes; nothing is made until
// you say yes, which the engine checks itself. Its replies, choices and yes/no show here. A reply that waits for yes is the
// preview's "A new Trunk, proposed" card (mk10).
import { Fragment, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { Dialog } from "../../shell/Dialog";
import { ConnectModelNotice } from "../../composer/ConnectModelNotice";
import { CONNECT_MODEL_ANSWERS, inferenceProblem } from "../../composer/connect-model";
import { canWrite, WRITE_WHY } from "./data";
import { rec, str } from "./model";
import { Layer } from "./layer";
import "./trunk.css";

type Turn = { who: "you" | "branch"; text: string };

/** The greyed "Change it first" control: the editor cannot open on a Trunk that is not made yet. */
const CHANGE_WHY = "Change it first comes in a later update.";

/** The staged create-agent request, as the engine reports it. Only fields it holds are present. */
type Proposal = { name?: string; job?: string };

/** The card rows, in the preview's order. A row the engine holds no data for stays Coming on that row only. */
const PROPOSAL_ROWS = ["Name", "Job", "Tools", "Computer", "May", "Talks to"] as const;

function readProposal(value: unknown): Proposal | null {
  const p = rec(value);
  if (str(p.kind) !== "create-agent" || !str(p.agentId)) return null;
  return { name: str(p.name) || undefined, job: str(p.job) || undefined };
}

/** The proposal card. Without a structured proposal the card shows the reply text alone (the fallback). */
function ProposedCard({ text, proposal, busy, onMake, onNo }: { text: string; proposal: Proposal | null; busy: boolean; onMake: () => void; onNo: () => void }) {
  const values: Record<string, string | undefined> = { Name: proposal?.name, Job: proposal?.job };
  return <div className="tk-card" data-testid="trunk-proposed">
    <div className="tk-card-h"><b>A new Trunk, proposed</b><span className="pill"><i />Waiting for you</span></div>
    {proposal ? <dl className="kv">{PROPOSAL_ROWS.map((label) => <Fragment key={label}><dt>{label}</dt><dd>{values[label] ?? <small className="tk-why">{`${label} comes in a later update.`}</small>}</dd></Fragment>)}</dl> : null}
    {!proposal && <div className="tk-say">{text}</div>}
    <div className="tk-opts">
      <button type="button" className="btn pri sm" disabled={busy} onClick={onMake}>{proposal?.name ? `Make ${proposal.name}` : "Make it"}</button>
      <Coming need="agents.create" unwired reason={CHANGE_WHY}><button type="button" className="btn sm" disabled>Change it first</button></Coming>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={onNo}>No thanks</button>
    </div>
    <small className="tk-why">{CHANGE_WHY}</small>
  </div>;
}
type Reply = { text: string; options: { label: string; reply: string }[]; approval: boolean; openAgent: string; proposal: Proposal | null };

function readReply(result: unknown): Reply {
  const r = rec(result), q = rec(r.question);
  const options = (Array.isArray(q.options) ? q.options : []).map(rec).map((o) => ({ label: str(o.label), reply: str(o.reply) || str(o.label) })).filter((o) => o.label);
  return {
    text: [str(r.reply), str(q.question)].filter(Boolean).join("\n\n"),
    options,
    approval: r.needsApproval === true,
    openAgent: str(r.action) === "open-agent" ? str(r.agentId) : "",
    proposal: readProposal(r.proposal),
  };
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `studio-${Date.now().toString(36)}`);

export type TrunkStudioProps = { engine: WindowEngine; onClose: () => void; onMade?: () => void; openTrunk?: (agentId: string) => void };

export function TrunkStudio({ engine, onClose, onMade, openTrunk }: TrunkStudioProps) {
  const session = useRef(newId());
  const [what, setWhat] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [last, setLast] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** quiet: the answer goes to Branch without a bubble in the chat (the preview's Make sends nothing visible). */
  const send = async (text: string, quiet = false) => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null); if (!quiet) setTurns((t) => [...t, { who: "you", text }]); setWhat("");
    try {
      const reply = readReply(await engine.request("branch.chat", { sessionId: session.current, welcomeVariant: "new-agent", message: text }));
      setTurns((t) => [...t, { who: "branch", text: reply.text }]); setLast(reply); onMade?.();
    } catch (e) { setError(inferenceProblem(e) ?? "Couldn’t make a Trunk just now. Try again."); }
    finally { setBusy(false); }
  };
  const first = !turns.length;
  const footer = <>
    <button type="button" className="btn ghost" onClick={onClose}>{first ? "Cancel" : "Close"}</button>
    {last?.openAgent && openTrunk && <button type="button" className="btn" onClick={() => { openTrunk(last.openAgent); onClose(); }}>Open it</button>}
    <button type="button" className="btn pri" disabled={!what.trim() || busy || !canWrite(engine)} title={canWrite(engine) ? undefined : WRITE_WHY} onClick={() => void send(first ? `Make me a Trunk: ${what.trim()}` : what.trim())}>{busy ? "Asking…" : first ? "Propose it" : "Send"}</button>
  </>;
  return (
    <Layer><Dialog title="Have Branch make a Trunk" onClose={onClose} footer={footer} testid="trunk-studio">
      <div className="tk-studio">
        {turns.map((t, i) => t.who === "you" ? <p key={i} className="tk-hint">{t.text}</p> : last?.approval && !busy && i === turns.length - 1
          ? <ProposedCard key={i} text={t.text} proposal={last.proposal} busy={busy} onMake={() => void send("Yes, make it.", true)} onNo={() => void send("No thanks.")} />
          : <div key={i} className="tk-say">{t.text}</div>)}
        {last && !busy && last.options.length > 0 && <div className="tk-opts">
          {last.options.map((o) => <button key={o.label} type="button" className="btn sm" onClick={() => void send(o.reply)}>{o.label}</button>)}
        </div>}
        <label className="tk-field"><span className="tk-h">{first ? "What should it take on?" : "Your answer"}</span>
          <textarea className="inp" rows={3} value={what} placeholder={first ? "Watch my subscriptions and tell me before anything renews." : ""} onChange={(e) => setWhat(e.target.value)} /></label>
        {first && <p className="tk-hint tk-studio-hint">Branch proposes a name, a face, the tools it needs, a computer and a schedule. Nothing is made until you say so.</p>}
        {error === CONNECT_MODEL_ANSWERS ? <ConnectModelNotice /> : error ? <p className="tk-error" role="alert">{error}</p> : null}
      </div>
    </Dialog></Layer>
  );
}

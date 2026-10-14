// "Have Branch make a Trunk" (preview 30-trunks mk-new): the words go to Branch's own assistant through branch.chat
// with its "new-agent" welcome (engine/src/gateway/server-methods/system-agent.ts). It proposes; nothing is made until
// you say yes, which the engine checks itself. Its replies, choices and yes/no show here. A reply that waits for yes is the
// preview's "A new Trunk, proposed" card (mk10).
import { useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { Dialog } from "../../shell/Dialog";
import { canWrite, WRITE_WHY } from "./data";
import { errorText, rec, str } from "./model";
import { Layer } from "./layer";
import "./trunk.css";

type Turn = { who: "you" | "branch"; text: string };

/** Why "Change it first" is greyed: the editor cannot open on a Trunk that is not made yet. */
const CHANGE_WHY = "Changing a Trunk before it is made comes in a later update.";

/** The proposal card. The engine returns the proposal as the reply text, so the card shows that text; the Tools, Computer, May
 * and Talks-to rows wait for the engine to return the staged proposal. */
function ProposedCard({ text, busy, onMake, onNo }: { text: string; busy: boolean; onMake: () => void; onNo: () => void }) {
  return <div className="tk-card" data-testid="trunk-proposed">
    <div className="tk-card-h"><b>A new Trunk, proposed</b><span className="pill"><i />Waiting for you</span></div>
    <div className="tk-say">{text}</div>
    <div className="tk-opts">
      <button type="button" className="btn pri sm" disabled={busy} onClick={onMake}>Make it</button>
      <Coming need="agents.create" unwired reason={CHANGE_WHY}><button type="button" className="btn sm" disabled>Change it first</button></Coming>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={onNo}>No thanks</button>
    </div>
    <small className="tk-why">{CHANGE_WHY}</small>
  </div>;
}
type Reply = { text: string; options: { label: string; reply: string }[]; approval: boolean; openAgent: string };

function readReply(result: unknown): Reply {
  const r = rec(result), q = rec(r.question);
  const options = (Array.isArray(q.options) ? q.options : []).map(rec).map((o) => ({ label: str(o.label), reply: str(o.reply) || str(o.label) })).filter((o) => o.label);
  return {
    text: [str(r.reply), str(q.question)].filter(Boolean).join("\n\n"),
    options,
    approval: r.needsApproval === true,
    openAgent: str(r.action) === "open-agent" ? str(r.agentId) : "",
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
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null); setTurns((t) => [...t, { who: "you", text }]); setWhat("");
    try {
      const reply = readReply(await engine.request("branch.chat", { sessionId: session.current, welcomeVariant: "new-agent", message: text }));
      setTurns((t) => [...t, { who: "branch", text: reply.text }]); setLast(reply); onMade?.();
    } catch (e) { setError(errorText(e)); }
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
          ? <ProposedCard key={i} text={t.text} busy={busy} onMake={() => void send("Yes, make it.")} onNo={() => void send("No thanks.")} />
          : <div key={i} className="tk-say">{t.text}</div>)}
        {last && !busy && last.options.length > 0 && <div className="tk-opts">
          {last.options.map((o) => <button key={o.label} type="button" className="btn sm" onClick={() => void send(o.reply)}>{o.label}</button>)}
        </div>}
        <label className="tk-field"><span className="tk-h">{first ? "What should it take on?" : "Your answer"}</span>
          <textarea className="inp" rows={3} value={what} placeholder={first ? "Watch my subscriptions and tell me before anything renews." : ""} onChange={(e) => setWhat(e.target.value)} /></label>
        {first && <p className="tk-hint tk-studio-hint">Branch proposes a name, a face, the tools it needs, a computer and a schedule. Nothing is made until you say so.</p>}
        {error && <p className="tk-error" role="alert">{error}</p>}
      </div>
    </Dialog></Layer>
  );
}

import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { Face } from "../face/Face";
import { approvals, canApprove, rec, resolveApproval, str, usePlaceData } from "../places/inbox/data";
import { approvalTitle } from "../places/inbox/NeedsYou";
import "./v23-layout.css";

type Props = {
  engine: WindowEngine;
  rows: Conversation[];
  needsCount: number;
  trunkName: (id?: string) => string;
  onOpen: (key: string) => void;
  onInbox: () => void;
  onClose: () => void;
};

/** Live Control tower. The preview's sample approvals and jobs are never shown as real data. */
export function ControlTower({ engine, rows, needsCount, trunkName, onOpen, onInbox, onClose }: Props) {
  const queue = usePlaceData(engine, approvals);
  const pending = queue.data?.items ?? [];
  const working = rows.filter((row) => row.working && !row.archived && !row.helper && !row.system);
  const recent = rows.filter((row) => row.done && !row.archived && !row.helper && !row.system).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  const decide = (item: Record<string, unknown>, decision: "allow-once" | "deny") => void queue.act(() => resolveApproval(engine, item, decision), decision === "deny" ? "Said no." : "Allowed once.");
  return <aside className="v23-tower" aria-label="Control tower">
    <header><b>Control tower</b><button type="button" className="ib" aria-label="Hide the control tower" onClick={onClose}>×</button></header>
    <div className="v23-tower-health"><i />Connected to this computer.</div>
    <section><h3>Needs you {needsCount ? <span>{needsCount}</span> : null}</h3>
      {queue.error ? <p role="alert">{queue.error}</p> : null}
      {!pending.length && !needsCount ? <p>Nothing is waiting for you.</p> : null}
      {pending.slice(0, 5).map((item) => {
        const request = rec(item.request), decisions = Array.isArray(request.allowedDecisions) ? request.allowedDecisions : ["allow-once", "deny"];
        const expired = typeof item.expiresAtMs === "number" && item.expiresAtMs <= Date.now();
        const key = str(request.sessionKey), who = trunkName(str(request.agentId));
        return <div className="v23-tower-row" key={`${str(item.kind)}:${str(item.id)}`}>
          <Face size={26} label={who} /><button type="button" className="v23-tower-row-text" disabled={!key} onClick={() => onOpen(key)}><b>{approvalTitle(item)}</b><small>{who} · {str(request.description) || str(item.kind)}</small></button>
          <button type="button" className="v23-allow" disabled={!canApprove(engine) || queue.busy || expired || !decisions.includes("allow-once")} onClick={() => decide(item, "allow-once")}>Allow</button>
          <button type="button" className="v23-deny" aria-label={`Don't allow ${approvalTitle(item)}`} disabled={!canApprove(engine) || queue.busy || expired || !decisions.includes("deny")} onClick={() => decide(item, "deny")}>×</button>
        </div>;
      })}
      {needsCount > pending.slice(0, 5).length ? <button type="button" className="v23-link" onClick={onInbox}>{needsCount - pending.slice(0, 5).length} more in the Inbox</button> : null}
    </section>
    <section><h3>Working now <span>{working.length}</span></h3>
      {working.length ? working.map((row) => <button type="button" className="v23-tower-row" key={row.key} onClick={() => onOpen(row.key)}><Face size={26} label={trunkName(row.agentId)} /><span className="v23-tower-row-text"><b>{row.title || trunkName(row.agentId)}</b><small>{row.headline || row.preview || "Working"}</small></span></button>) : <p>No Trunk is working right now.</p>}
    </section>
    <section><h3>Team chatter</h3><p>No team messages yet.</p></section>
    <section><h3>Just finished</h3>{recent.length ? recent.map((row) => <button type="button" className="v23-tower-row" key={row.key} onClick={() => onOpen(row.key)}><Face size={26} label={trunkName(row.agentId)} /><span className="v23-tower-row-text"><b>{row.title || trunkName(row.agentId)}</b><small>{row.preview}</small></span></button>) : <p>Nothing finished yet.</p>}</section>
  </aside>;
}

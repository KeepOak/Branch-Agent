// People › Usage (§4.6.5.7): how much each person's conversations used this month, from the engine's usage
// totals grouped by who started each conversation (sessions.usage aggregates.byCreator), then what each model
// account has left as its service reports it (usage.status).
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "../library/data";
import { firstName, num, rec, recs, str } from "./data";
import { Empty, Status } from "./ui";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The month so far, in the engine's own time zone. */
export function monthToDate(now = new Date()) {
  return { agentScope: "all", startDate: iso(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: iso(now), mode: "gateway" };
}
const money = (n: number) => n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;

export function UsageTab({ engine }: { engine: WindowEngine }) {
  const usage = useResource<unknown>(engine, "sessions.usage", monthToDate());
  const people = recs(rec(rec(usage.data).aggregates).byCreator).map(c => {
    const actor = rec(c.actor), totals = rec(c.totals);
    return { key: str(c.key), name: str(actor.label) || (str(actor.type) === "human" ? str(actor.id) : "") || "Not signed in", cost: num(totals.totalCost) ?? 0, tokens: num(totals.totalTokens) ?? 0 };
  }).filter(p => p.cost > 0 || p.tokens > 0).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
  const top = Math.max(...people.map(p => p.cost), 0);
  return <>
    <p className="pp-hint" style={{ margin: "0 0 10px" }}>Each person’s own model accounts stay theirs. This is how much the conversations each person started used this month.</p>
    <Status {...usage} />
    {usage.data != null && !people.length && <Empty>Nobody has used a model this month.</Empty>}
    {people.length > 0 && <div className="pp-bars">{people.map(p => <div key={p.key} className="pp-brow">
      <span title={p.name}>{firstName(p.name)}</span>
      <span className="track" role="img" aria-label={`${p.name}: ${money(p.cost)}`}><u style={{ width: `${top ? Math.max(2, Math.round(p.cost / top * 100)) : 0}%` }} /></span>
      <span className="v">{money(p.cost)}</span></div>)}</div>}
    <Limits engine={engine} />
  </>;
}

const resetWords = (ms: number | undefined) => ms ? `resets ${new Date(ms).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : "";
/** The model accounts' limit rows, as each service reports them (usage.status providers and their windows). */
function Limits({ engine }: { engine: WindowEngine }) {
  const status = useResource<unknown>(engine, "usage.status");
  const providers = recs(rec(status.data).providers);
  if (status.loading || (!status.error && !providers.length)) return null;
  return <div className="pp-lims">
    <Status {...status} />
    {providers.map(p => { const windows = recs(p.windows), acct = [str(p.plan), str(p.accountEmail)].filter(Boolean).join(" · ");
      return <div key={str(p.provider) + acct} className="pp-lim"><span className="pp-tile" aria-hidden="true">{(str(p.displayName) || str(p.provider)).slice(0, 1).toUpperCase()}</span><div>
        <div className="pp-lim-h"><b>{str(p.displayName) || str(p.provider)}</b>{acct && <span className="muted">{acct}</span>}{windows.length > 0 && <span className="pill ok">Measured</span>}</div>
        {windows.map((w, i) => { const left = Math.max(0, Math.min(100, Math.round(100 - (num(w.usedPercent) ?? 0))));
          return <div key={i} className="pp-lim-w"><span>{str(w.label)}</span><span className="pp-lim-bar"><i className={left < 15 ? "low" : undefined} style={{ width: `${left}%` }} /></span><span>{[`${left}% left`, resetWords(num(w.resetAt))].filter(Boolean).join(" · ")}</span></div>; })}
        {str(p.error) ? <small>{str(p.error)}</small> : !windows.length ? <small>This service does not say what it allows.</small> : str(p.summary) ? <small>{str(p.summary)}</small> : null}
      </div></div>; })}
  </div>;
}

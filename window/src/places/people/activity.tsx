// People › Activity (§4.6.5.6): Reports (team-reports.*) above the engine's audit log (audit.activity.list),
// filtered by Trunk, kind, status, chat app and dates; from Advanced a run's "Explain" (audit.run.inspect).
import { useEffect, useState } from "react";
import { Dialog } from "../../shell/Dialog";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { errorText, useResource } from "../library/data";
import { num, rec, recs, rows, str, trunkNames, type Rec } from "./data";
import { Empty, Glyph, Status } from "./ui";
import { Reports } from "./reports";

const STATUS: Record<string, string> = { started: "Started", succeeded: "Done", failed: "Failed", cancelled: "Stopped", timed_out: "Timed out", blocked: "Blocked", unknown: "Unknown" };
const KINDS = [{ id: "agent_run", name: "Runs" }, { id: "tool_action", name: "Tool steps" }, { id: "message", name: "Messages" }];
const KIND_WORD: Record<string, string> = { agent_run: "Run", tool_action: "Tool step" };
export const CHAT_APP_OFF = "Pick Kind › Messages first: chat apps only apply to messages.";
type Filters = { agentId: string; kind: string; status: string; channel: string; from: string; to: string };
const NONE: Filters = { agentId: "", kind: "", status: "", channel: "", from: "", to: "" };

/** The engine's query for a set of filters; a chat app only goes with Kind › Messages. */
export function activityParams(f: Filters, cursor?: string): Rec {
  const day = (d: string, end: boolean) => d ? new Date(`${d}T${end ? "23:59:59.999" : "00:00:00"}`).getTime() : undefined;
  return Object.fromEntries(Object.entries({
    limit: 100, cursor, agentId: f.agentId || undefined, kind: f.kind || undefined, status: f.status || undefined,
    channel: f.kind === "message" && f.channel ? f.channel : undefined, after: day(f.from, false), before: day(f.to, true),
  }).filter(([, v]) => v !== undefined));
}

export function when(ms: number, now = new Date()): string {
  const d = new Date(ms), time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return days === 0 ? time : days === 1 ? `Yesterday ${time}` : `${d.toLocaleDateString()} ${time}`;
}

function useActivity(engine: WindowEngine, f: Filters) {
  const [state, setState] = useState<{ events: Rec[]; next?: string; loading: boolean; error: string | null }>({ events: [], loading: true, error: null });
  const [rev, setRev] = useState(0);
  const key = JSON.stringify(f);
  useEffect(() => {
    let live = true;
    setState({ events: [], loading: true, error: null });
    engine.request<unknown>("audit.activity.list", activityParams(JSON.parse(key) as Filters)).then(r => { if (live) setState({ events: recs(rec(r).events), next: str(rec(r).nextCursor) || undefined, loading: false, error: null }); },
      e => { if (live) setState({ events: [], loading: false, error: errorText(e) }); });
    return () => { live = false; };
  }, [engine, key, rev]);
  const more = () => { if (!state.next) return; const cursor = state.next;
    setState(s => ({ ...s, loading: true }));
    engine.request<unknown>("audit.activity.list", activityParams(JSON.parse(key) as Filters, cursor)).then(r => setState(s => ({ events: [...s.events, ...recs(rec(r).events)], next: str(rec(r).nextCursor) || undefined, loading: false, error: null })),
      e => setState(s => ({ ...s, loading: false, error: errorText(e) }))); };
  return { ...state, more, reload: () => setRev(n => n + 1) };
}

export function ActivityTab({ engine, level }: { engine: WindowEngine; level: Level }) {
  const [f, setF] = useState<Filters>(NONE);
  const log = useActivity(engine, f);
  const agents = useResource<unknown>(engine, "agents.list");
  const titles = useResource<unknown>(engine, "sessions.list", { includeDerivedTitles: true });
  const [explain, setExplain] = useState<string | null>(null);
  const names = trunkNames(agents.data);
  const title = new Map(rows(titles.data).map(r => [r.key, r.title]));
  const any = Object.values(f).some(Boolean);
  const set = (k: keyof Filters) => (v: string) => setF(x => ({ ...x, [k]: v, ...(k === "kind" && v !== "message" ? { channel: "" } : {}) }));
  return <>
    <Reports engine={engine} level={level} />
    <div className="pp-fbar" role="toolbar" aria-label="Filters">
      <Pick label="Trunk" value={f.agentId} onChange={set("agentId")} options={[...names].map(([id, name]) => ({ id, name }))} />
      <Pick label="Kind" value={f.kind} onChange={set("kind")} options={KINDS} />
      <Pick label="Status" value={f.status} onChange={set("status")} options={Object.entries(STATUS).map(([id, name]) => ({ id, name }))} />
      <label title={f.kind === "message" ? undefined : CHAT_APP_OFF}>Chat app<input aria-label="Chat app" value={f.channel} disabled={f.kind !== "message"} placeholder="telegram" onChange={e => set("channel")(e.target.value.trim())} /></label>
      <label>From<input type="date" aria-label="From" value={f.from} onChange={e => set("from")(e.target.value)} /></label>
      <label>To<input type="date" aria-label="To" value={f.to} onChange={e => set("to")(e.target.value)} /></label>
      {any && <button type="button" className="btn ghost sm" onClick={() => setF(NONE)}>Clear</button>}
    </div>
    {!log.loading && !log.error && !log.events.length && <Empty>{any ? "No records match these filters." : "Nothing has happened in the team yet."}</Empty>}
    <ol className="pp-tl">{log.events.map(e => <Event key={str(e.eventId)} e={e} names={names} title={title} explain={shows(level, "advanced") ? setExplain : undefined} />)}</ol>
    <Status loading={log.loading} error={log.error} reload={log.reload} />
    {log.next && !log.loading && <div className="pp-acts" style={{ marginTop: 12 }}><button type="button" className="btn sm" onClick={log.more}>Load more</button></div>}
    <p className="pp-hint" style={{ marginTop: 10 }}>Records are kept 30 days.</p>
    {explain && <ExplainDialog engine={engine} runId={explain} onClose={() => setExplain(null)} />}
  </>;
}

function Pick({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (v: string) => void }) {
  return <select aria-label={label} value={value} onChange={e => onChange(e.target.value)}><option value="">{label}</option>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>;
}

function Event({ e, names, title, explain }: { e: Rec; names: Map<string, string>; title: Map<string, string>; explain?: (runId: string) => void }) {
  const type = str(e.eventType), status = STATUS[str(e.status)] ?? str(e.status), agent = str(e.agentId);
  const trunk = names.get(agent) || agent;
  const at = num(e.occurredAt);
  if (type === "agent_run" || type === "tool_action") {
    const run = type === "agent_run", what = run ? title.get(str(e.sessionKey)) : str(e.toolName);
    return <li><Glyph name={run ? "play" : "tool"} /><span><b>{trunk}</b> · {KIND_WORD[type]} · {status}{what ? <>: {run ? what : <code>{what}</code>}</> : null}</span>
      <span className="pp-acts">{at !== undefined && <time>{when(at)}</time>}{run && explain && str(e.runId) && <button type="button" className="btn ghost sm" onClick={() => explain(str(e.runId))}>Explain</button>}</span></li>;
  }
  const inbound = str(e.direction) === "inbound";
  return <li><Glyph name="chat" /><span>{inbound ? "Message in" : "Message out"} · {status}{trunk ? <> · <b>{trunk}</b></> : null}<small>From {str(e.channel)}</small></span>{at !== undefined && <time>{when(at)}</time>}</li>;
}

const OUTCOME: Record<string, string> = { allowed: "Allowed", denied: "Denied", "not-applicable": "Not applicable", unknown: "Unknown" };
const COVERAGE: Record<string, string> = { enforced: "Checked and enforced", "attribution-only": "Recorded, not enforced", unattributed: "Not attributed", unknown: "Unknown", unsupported: "Not supported" };
function ExplainDialog({ engine, runId, onClose }: { engine: WindowEngine; runId: string; onClose: () => void }) {
  const run = useResource<unknown>(engine, "audit.run.inspect", { runId });
  const data = rec(run.data), coverage = str(rec(data.coverage).state), identity = str(rec(data.identity).state);
  const decisions = recs(data.decisionDisplays);
  return <Dialog wide title="What happened in this run" onClose={onClose} footer={<button type="button" className="btn pri" onClick={onClose}>Done</button>}>
    <Status {...run} />
    {run.data != null && <div className="ppl-dlg" style={{ display: "grid", gap: 12 }}>
      <p style={{ margin: 0 }}>{coverage && <span className="pill idle">{COVERAGE[coverage] ?? coverage}</span>} Who it ran as: {identity || "unknown"}.</p>
      {decisions.length ? <ol className="pp-tl">{decisions.map((d, i) => { const action = rec(d.action), dec = rec(d.decision);
        return <li key={i}><Glyph name="info" /><span>{str(action.summary) || `${str(action.family)} · ${str(action.operation)}`}<small>{OUTCOME[str(dec.outcome)] ?? str(dec.outcome)} · {str(dec.reasonCode)}</small></span>{num(d.occurredAt) !== undefined && <time>{when(num(d.occurredAt)!)}</time>}</li>; })}</ol>
        : <p className="pp-hint" style={{ margin: 0 }}>No checks were recorded for this run.</p>}
      <p className="pp-hint" style={{ margin: 0 }}>Only what the engine recorded: actions and the checks on them, never message text.</p>
    </div>}
  </Dialog>;
}

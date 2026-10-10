// Inbox › History: everyone's conversations by day, time and person filters, search, Pulse, folded automation runs,
// recaps, and "Look inside this run" at the Technical level.
import { useState, type ReactNode } from "react";
import { isWorkingNow } from "../../shell/working-now";
import type { WindowEngine } from "../../connect/engine";
import { Face } from "../../face/Face";
import { Icon } from "../../shell/icons";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import { shows, type Level } from "../../places-nav/level";
import { agentName, agents, conversationTitle, runMs, runs, sessions, type Agent, type Run, type Session } from "../overview/engine";
import { clock, dayWord, money, plural, runLength } from "../overview/format";
import { errorText, paged, rec, rows, str, type Row } from "./data";
import { Every } from "./Every";
import { G } from "./glyphs";
import { Inspect } from "./Inspect";


export type HistoryData = { sessions: Session[]; runs: Run[]; profiles: Row[]; self: string; agents: { defaultId: string; list: Agent[] }; errors: string[] };

/** Runs come from the versioned activity record; older engines answer only audit.list. */
async function readRuns(engine: WindowEngine): Promise<unknown> {
  try { return await engine.request("audit.activity.list", { kind: "agent_run", limit: 500 }); }
  catch (first) {
    try { return await engine.request("audit.list", { kind: "agent_run", limit: 500 }); }
    catch { throw first; }
  }
}
export async function loadHistory(engine: WindowEngine): Promise<HistoryData> {
  const [list, audit, users, self, trunks] = await Promise.allSettled([
    paged(engine, "sessions.list", "sessions", { includeGlobal: true, includeUnknown: true, includeActivitySummary: true, archived: "all" }),
    readRuns(engine), engine.request("users.list", {}), engine.request("users.self", {}), engine.request("agents.list", {}),
  ]);
  const errors = [list.status === "rejected" ? `Conversations: ${errorText(list.reason)}` : "", audit.status === "rejected" ? `Run record: ${errorText(audit.reason)}` : ""].filter(Boolean);
  return {
    sessions: sessions({ sessions: list.status === "fulfilled" ? list.value : [] }),
    runs: audit.status === "fulfilled" ? runs(audit.value) : [],
    profiles: users.status === "fulfilled" ? rows(rec(users.value).profiles) : [],
    self: self.status === "fulfilled" ? str(rec(rec(self.value).profile).id) : "",
    agents: agents(trunks.status === "fulfilled" ? trunks.value : {}), errors,
  };
}

type Win = "24h" | "7d" | "30d" | "all";
const WINDOWS: Record<Win, [string, number]> = { "24h": ["Last 24 hours", 864e5], "7d": ["Last 7 days", 7 * 864e5], "30d": ["Last 30 days", 30 * 864e5], all: ["All time", Infinity] };
export type Item = { s: Session; at: Date; run?: Run; who: string };

export function items(data: HistoryData): Item[] {
  return data.sessions.filter(s => !s.helper).map(s => {
    const run = data.runs.find(r => r.sessionKey === s.key);
    const at = run?.startedAt ?? run?.finishedAt ?? s.updatedAt ?? 0;
    return { s, run, at: new Date(at), who: s.human ? s.ownerId : "unmatched" };
  }).filter(i => i.at.getTime() > 0).sort((a, b) => b.at.getTime() - a.at.getTime());
}
const personName = (data: HistoryData, id: string) => id === "unmatched" ? "Someone we couldn’t match" : str(data.profiles.find(p => str(p.id) === id)?.displayName) || id;

export function hourBins(now: Date): [Date, Date, string][] {
  const startOfHour = now.getTime() - now.getMinutes() * 6e4 - now.getSeconds() * 1000 - now.getMilliseconds();
  return Array.from({ length: 24 }, (_, i) => {
    const start = new Date(startOfHour - (23 - i) * 36e5);
    return [start, new Date(start.getTime() + 36e5), clock(start)];
  });
}

export function calendarBins(now: Date, count: number): [Date, Date, string][] {
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - count + 1 + i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return [start, end, dayWord(start, now)];
  });
}

function Pulse({ list, win, now, working }: { list: Item[]; win: Win; now: Date; working: number }) {
  const bins: [Date, Date, string][] = win === "24h"
    ? hourBins(now)
    : win === "all" ? Array.from({ length: 12 }, (_, i): [Date, Date, string] => { const s = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1); return [s, new Date(s.getFullYear(), s.getMonth() + 1, 1), s.toLocaleString("en-US", { month: "short", year: "numeric" })]; })
    : calendarBins(now, win === "7d" ? 7 : 30);
  const counts = bins.map(([a, b]) => list.filter(i => i.at >= a && i.at < b).length), top = Math.max(1, ...counts);
  const started = list.filter(i => (i.s.createdAt ?? 0) >= now.getTime() - WINDOWS[win][1]).length;
  const people = new Set(list.map(i => i.who)).size;
  return <section className="ib-tile-box ib-pulse"><b>Pulse</b>
    <p className="ib-mono">{plural(list.length, "conversation")}{win === "all" ? "" : ` · ${started} started`} · {plural(people, "person", "people")} · {working} working now</p>
    <div className="ib-pl-bars" role="group" aria-label="Conversations over time">{counts.map((n, i) => <span key={i} className="ib-pl-b" tabIndex={0} title={`${bins[i][2]} · ${plural(n, "conversation")}`} aria-label={`${bins[i][2]} · ${plural(n, "conversation")}`}><u style={{ height: `${n / top * 100}%` }} /></span>)}</div>
  </section>;
}

function Recap({ s }: { s: Session }) {
  if (s.recapState === "updating") return <span className="ib-recap ib-dim">Updating the recap…</span>;
  if (!s.recap) return <span className="ib-recap ib-dim">No recap yet</span>;
  return <><span className="ib-recap">{s.recap}</span>{s.recapState === "stale" ? <span className="ib-recap-n">New activity since this recap</span> : null}</>;
}

function HRow({ item, data, level, child, inspect, open }: { item: Item; data: HistoryData; level: Level; child?: boolean; inspect: (item: Item, at: MenuAnchor) => void; open: (key: string) => void }) {
  const { s, run, at, who } = item, trunk = agentName(data.agents.list, s.agentId), title = conversationTitle(s, trunk);
  const person = s.human && who !== data.self && who !== "unmatched" ? personName(data, who).split(" ")[0] : "";
  const length = s.working ? (run?.startedAt !== undefined ? `${Math.max(1, Math.round((Date.now() - run.startedAt) / 6e4))} min so far` : "working") : run && runMs(run) !== undefined ? runLength(runMs(run)!) : "";
  const cost = s.cost !== undefined ? money(s.cost) : "";
  const runId = run?.runId ?? s.runId ?? s.lastRunId;
  return <div className={child ? "ib-row ib-hrow ib-hchild" : "ib-row ib-hrow"}>
    <Face size={34} state={s.working ? "work" : "idle"} label={trunk} />
    <span className="ib-grow"><b><button type="button" className="ib-title-btn" onClick={() => open(s.key)}>{title}</button>{s.automation ? <span className="ib-tag">Automation</span> : null}{s.archived ? <span className="ib-tag">Archived</span> : null}</b>
      <small>{[trunk, person, s.working ? "working now" : clock(at)].filter(Boolean).join(" · ")}</small><Recap s={s} /></span>
    <span className="ib-meta">{length}{length && cost ? " · " : ""}{cost ? <span title="Conversation so far">{cost}</span> : null}</span>
    {shows(level, "technical") && runId ? <button type="button" className="ib-ib" aria-haspopup="menu" aria-label={`More for ${title}`} title={`More for ${title}`} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); inspect({ ...item, run: run ?? { runId, agentId: s.agentId, sessionKey: s.key, status: "" } }, { x: r.right - 220, y: r.bottom + 4 }); }}><Icon name="more" /></button> : null}
  </div>;
}

function Days({ list, data, level, folds, toggle, inspect, open }: { list: Item[]; data: HistoryData; level: Level; folds: string[]; toggle: (k: string) => void; inspect: (item: Item, at: MenuAnchor) => void; open: (key: string) => void }) {
  const groups: [string, Item[]][] = [];
  for (const i of list) { const d = dayWord(i.at); const g = groups.find(x => x[0] === d); if (g) g[1].push(i); else groups.push([d, [i]]); }
  return <>{groups.map(([day, rs]) => {
    const autos = rs.filter(i => i.s.automation), rest = rs.filter(i => !i.s.automation), k = `a:${day}`, isOpen = folds.includes(k);
    const row = (i: Item, child?: boolean) => <HRow key={i.s.key} item={i} data={data} level={level} child={child} inspect={inspect} open={open} />;
    return <div key={day}><h3 className="ib-day">{day}</h3><div className="ib-list ib-flat">{rest.map(i => row(i))}
      {autos.length > 1 ? <><div className="ib-row ib-fold"><span className="ib-tile"><G name="clock" /></span><span className="ib-grow"><b>{plural(autos.length, "automation run")}</b></span><button type="button" className="ib-ib" aria-expanded={isOpen} aria-label={isOpen ? "Fold" : "Show them"} title={isOpen ? "Fold" : "Show them"} onClick={() => toggle(k)}><Icon name={isOpen ? "down" : "chev"} /></button></div>{isOpen ? autos.map(i => row(i, true)) : null}</> : autos.map(i => row(i))}
    </div></div>;
  })}</>;
}

function PickMenu({ at, items: list, close, label }: { at: MenuAnchor | null; items: MenuItem[]; close: () => void; label: string }) {
  return at ? <Menu at={at} items={list} onClose={close} label={label} /> : null;
}

export function History({ engine, data, level, people: initialPeople, open, children }: { engine: WindowEngine; data: HistoryData; level: Level; people?: string[]; open: (key: string) => void; children?: ReactNode }) {
  const [win, setWin] = useState<Win>("7d");
  const [who, setWho] = useState<string[]>(initialPeople ?? []);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(10);
  const [folds, setFolds] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ kind: "win" | "who"; at: MenuAnchor } | null>(null);
  const [inspectAt, setInspectAt] = useState<{ item: Item; at: MenuAnchor } | null>(null);
  const [inspecting, setInspecting] = useState<Item | null>(null);
  const now = new Date(), all = items(data), span = WINDOWS[win][1];
  const inWindow = all.filter(i => (span === Infinity || now.getTime() - i.at.getTime() <= span) && (!who.length || who.includes(i.who)));
  const needle = q.trim().toLowerCase();
  const titleOf = (i: Item) => conversationTitle(i.s, agentName(data.agents.list, i.s.agentId));
  const list = inWindow.filter(i => !needle || [titleOf(i), agentName(data.agents.list, i.s.agentId)].some(t => t.toLowerCase().includes(needle)));
  const persons = [...new Set(all.map(i => i.who))].filter(w => w !== "unmatched");
  const label = !who.length ? "Everyone" : who.length === 1 ? (who[0] === "unmatched" ? "People we couldn’t match" : personName(data, who[0]).split(" ")[0]) : `${who.length} people`;
  const anchor = (e: React.MouseEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };
  const toggleWho = (w: string) => { setWho(who.includes(w) ? who.filter(x => x !== w) : [...who, w]); setShown(10); };
  const whoItems: MenuItem[] = [{ label: "Everyone", run: () => { setWho([]); setShown(10); } }, ...persons.map(w => ({ label: `${who.includes(w) ? "✓ " : ""}${personName(data, w)}`, run: () => toggleWho(w) })), { label: `${who.includes("unmatched") ? "✓ " : ""}People we couldn’t match`, run: () => toggleWho("unmatched") }];
  return <>
    <Pulse list={inWindow} win={win} now={now} working={all.filter(i => isWorkingNow(i.s)).length} />
    <div className="ib-nl"><input className="ib-inp" value={q} placeholder="Search conversations and people" aria-label="Search history" onChange={e => { setQ(e.target.value); setShown(10); }} /></div>
    <div className="ib-filt"><button type="button" className="btn sm" aria-haspopup="menu" onClick={e => setMenu({ kind: "win", at: anchor(e) })}>{WINDOWS[win][0]}<Icon name="down" small /></button>
      {persons.length > 1 || who.length ? <button type="button" className="btn sm" aria-haspopup="menu" onClick={e => setMenu({ kind: "who", at: anchor(e) })}>{label}<Icon name="down" small /></button> : null}
      {who.length ? <button type="button" className="btn ghost sm" onClick={() => setWho([])}>Clear</button> : null}</div>
    {list.length ? <Days list={list.slice(0, shown)} data={data} level={level} folds={folds} toggle={k => setFolds(folds.includes(k) ? folds.filter(x => x !== k) : [...folds, k])} inspect={(item, at) => setInspectAt({ item, at })} open={open} />
      : <p className="ib-empty">{all.length ? "Nothing matches." : "Nothing has run yet."}</p>}
    {list.length ? <div className="ib-show"><small>Showing {Math.min(shown, list.length)} of {list.length}</small>{list.length > shown ? <button type="button" className="btn ghost sm" onClick={() => setShown(shown + 10)}>Show more</button> : null}</div> : null}
    {shows(level, "advanced") ? <Every engine={engine} data={data} level={level} open={open} /> : null}
    {children}
    <PickMenu at={menu?.kind === "win" ? menu.at : null} label="When" close={() => setMenu(null)} items={(Object.keys(WINDOWS) as Win[]).map(w => ({ label: `${w === win ? "✓ " : ""}${WINDOWS[w][0]}`, run: () => { setWin(w); setShown(10); } }))} />
    <PickMenu at={menu?.kind === "who" ? menu.at : null} label="Person" close={() => setMenu(null)} items={whoItems} />
    <PickMenu at={inspectAt?.at ?? null} label="Run" close={() => setInspectAt(null)} items={inspectAt ? [{ label: "Look inside this run", run: () => setInspecting(inspectAt.item) }] : []} />
    {inspecting ? <Inspect engine={engine} title={titleOf(inspecting)} at={inspecting.at} runId={inspecting.run?.runId ?? ""} close={() => setInspecting(null)} /> : null}
  </>;
}

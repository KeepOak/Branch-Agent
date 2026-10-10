// Overview (DESIGN-SPEC §4.6.1; preview renderOverview + 40-places + 41-placesap p10-overview).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import { useLockdown } from "../../shell/use-lockdown";
import { LOCKDOWN_EXPLANATION } from "../../shell/ConfirmLockdown";
import { notify } from "../../shell/notify";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import { Face } from "../../face/Face";
import { isEngineMode, modeName } from "../../composer/mode";
import { OverviewData, agentName, agents, number, people, personFrom, record, records, runMs, runs, sessions, sharedConnections, text, type Agent, type Resource, type Run, type Session } from "./engine";
import { money, runLength, whenWord } from "./format";
import { PersonRow, type PersonLine } from "./People";
import { FinishSetup } from "./Setup";
import "./overview.css";

export const PAUSE_ALL_GAP = "Needs the engine's pause-all method.";
export const MILESTONES_GAP = "Needs the engine's milestones method.";

function ResourceStatus({ resource, label, retry }: { resource: Resource; label: string; retry: () => void }) {
  if (resource.error) return <div className="ov-error" role="alert"><p>Couldn't load {label}. {resource.error}</p><button type="button" className="btn sm" onClick={retry}>Try again</button></div>;
  return resource.loading && resource.value === undefined ? <p className="ov-hint" role="status">Loading…</p> : null;
}
function Tile({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="ov-tile"><div className="ov-tile-h"><h2>{title}</h2>{action}</div>{children}</section>;
}
function HealthRow({ label, value, dot }: { label: string; value: string; dot?: "good" | "warn" | "bad" | "next" }) {
  return <div className="ov-line"><span className={dot ? `ov-dot ${dot}` : "ov-dot"} /><span>{label}</span><span className="ov-end">{value}</span></div>;
}

function backupRow(value: unknown): { value: string; dot?: "good" | "warn" | "bad" } | null {
  const v = record(value), targets = records(v.targets), schedules = records(v.schedules);
  const latest = targets.map(t => record(t.latest)).sort((a, b) => (number(b.createdAt) ?? 0) - (number(a.createdAt) ?? 0))[0];
  if (latest) {
    const at = number(latest.createdAt);
    return latest.status === "failed" ? { value: `Failed${at !== undefined ? ` · ${whenWord(at)}` : ""}`, dot: "bad" } : { value: at !== undefined ? whenWord(at) : "Done", dot: "good" };
  }
  const next = schedules.filter(s => s.enabled === true).flatMap(s => number(s.nextRunAtMs) ?? []).sort()[0];
  return next !== undefined ? { value: `First at ${whenWord(next)}` } : value === undefined ? null : { value: "Not set up", dot: "warn" };
}
function updateRow(value: unknown): { value: string; dot?: "good" | "warn" | "bad" | "next" } | null {
  if (value === undefined) return null;
  const v = record(value), available = record(v.updateAvailable), active = record(v.activeRun), last = record(v.lastRun);
  if (Object.keys(active).length) return { value: "Updating", dot: "next" };
  if (text(available.latestVersion)) return { value: "Branch update ready", dot: "next" };
  if (last.status === "failed" || last.status === "error") return { value: "Last update failed", dot: "bad" };
  return { value: "No update waiting", dot: "good" };
}

function Health({ tiles }: { tiles: Record<string, Resource> }) {
  const snapshot = record(tiles.health.value), backup = backupRow(tiles.backup.value), update = updateRow(tiles.update.value);
  return <>
    {tiles.health.value !== undefined ? <HealthRow label="This computer" value={snapshot.ok === true ? "Online" : "Not responding"} dot={snapshot.ok === true ? "good" : "bad"} /> : null}
    {Object.entries(record(snapshot.channels)).map(([id, raw]) => {
      const channel = record(raw), connected = channel.connected === true;
      const word = connected ? "Connected" : channel.running === true ? "Running" : channel.configured === false ? "Not set up" : channel.connected === false ? "Not connected" : "Status not reported";
      return <HealthRow key={id} label={text(channel.name) || text(channel.label) || id} value={word} dot={connected ? "good" : channel.connected === false ? "warn" : undefined} />;
    })}
    {backup ? <HealthRow label="Backup" value={backup.value} dot={backup.dot} /> : null}
    {update ? <HealthRow label="Update" value={update.value} dot={update.dot} /> : null}
  </>;
}

function Spending({ resource, trunks }: { resource: Resource; trunks: Agent[] }) {
  if (resource.value === undefined) return null;
  const value = record(resource.value), amount = number(record(value.totals).totalCost);
  const rows = records(record(value.aggregates).byAgent).map(row => ({ id: text(row.agentId), cost: number(record(row.totals).totalCost) ?? 0 })).filter(row => row.id && row.cost > 0);
  const highest = Math.max(0, ...rows.map(row => row.cost));
  return <>
    {amount === undefined ? <p className="ov-hint">Not reported</p> : <div className="ov-big">{money(amount)}</div>}
    {rows.length ? <div className="ov-bars">{rows.map(row => <div className="ov-brow" key={row.id}><span>{agentName(trunks, row.id)}</span><span className="ov-track"><u style={{ width: `${highest > 0 ? row.cost / highest * 100 : 0}%` }} /></span><span className="ov-v">{money(row.cost)}</span></div>)}</div> : null}
  </>;
}

/** The last four finished runs, newest first, one per conversation, with how long each took (preview: history rows). */
function recentActivity(rows: Session[], list: Run[]): { row: Session; length: string }[] {
  const seen = new Set<string>(), out: { row: Session; length: string }[] = [];
  for (const run of [...list].filter(r => r.finishedAt !== undefined).sort((a, b) => b.finishedAt! - a.finishedAt!)) {
    const row = rows.find(r => r.key === run.sessionKey);
    if (!row || seen.has(row.key)) continue;
    seen.add(row.key);
    const ms = runMs(run);
    out.push({ row, length: ms === undefined ? "" : runLength(ms) });
    if (out.length === 4) break;
  }
  return out.length ? out : rows.filter(r => !r.working).slice(0, 4).map(row => ({ row, length: "" }));
}

export function OverviewPlace({ engine, facts, openConversation, openPlace, openSettings }: PlaceProps) {
  const lockdown = useLockdown(engine, true);
  const toggleLockdown = () => void lockdown.toggle().catch((error: unknown) => notify(`Couldn't change Lockdown: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }));
  const data = useMemo(() => new OverviewData(engine), [engine]);
  useEffect(() => { data.start(); return () => data.stop(); }, [data]);
  const { tiles } = useSyncExternalStore(data.subscribe, data.getSnapshot);
  const rows = sessions(tiles.sessions.value), running = rows.filter(row => row.working && !row.helper);
  const trunks = agents(tiles.agents.value), runList = runs(tiles.runs.value);
  const def = trunks.list.find(a => a.id === trunks.defaultId) ?? trunks.list[0];
  const mode = def && isEngineMode(def.mode) ? modeName(def.mode) : "";
  const lines: PersonLine[] = people(tiles.people.value, tiles.presence.value);
  const shared = sharedConnections(tiles.presence.value);
  if (shared.length) lines.push({ ...personFrom("shared", "Shared owner", "", shared), shared: true });
  const status = (key: keyof typeof tiles, label: string) => <ResourceStatus resource={tiles[key]} label={label} retry={() => void data.refresh([key])} />;
  const recent = recentActivity(rows, runList);
  return <PlaceFrame title="Overview" lede="What’s happening across your Trunks, at a glance." wide="overview" top={<FinishSetup engine={engine} openSettings={openSettings} />} before={<button type="button" className="btn sm" onClick={() => openPlace("office")}>Grove</button>}>
    <div className="ov-grid">
      <Tile title="Now" action={<button type="button" className="ov-link" onClick={() => openPlace("canopy")}>Open Canopy</button>}>
        {status("sessions", "running conversations")}
        {running.map(row => <button key={row.key} type="button" className="ov-now" onClick={() => openConversation(row.key)}><Face size={34} state="work" label={agentName(trunks.list, row.agentId)} /><span className="ov-grow"><b>{agentName(trunks.list, row.agentId)}</b><small>{row.preview || row.title}</small></span></button>)}
        {tiles.sessions.value !== undefined && !running.length ? <p>Nothing is running right now.</p> : null}
        <div className="ov-acts">{facts.waiting > 0 ? <button type="button" className="btn pri sm" onClick={() => openPlace("inbox")}>Answer {facts.waiting} waiting</button> : <span className="ov-pill"><i />Nothing waiting</span>}</div>
      </Tile>
      <Tile title="Health">{status("health", "gateway health")}<Health tiles={tiles} /></Tile>
      <Tile title="Spend this week">{status("spend", "spending")}<Spending resource={tiles.spend} trunks={trunks.list} /></Tile>
      <Tile title="Recent activity">
        {status("sessions", "recent activity")}
        {recent.map(({ row, length }) => <button key={row.key} type="button" className="ov-recent" onClick={() => openConversation(row.key)}><Face size={20} label={agentName(trunks.list, row.agentId)} /><span className="ov-recent-t">{row.title}</span><span className="ov-mono">{length}</span></button>)}
        {tiles.sessions.value !== undefined && !rows.length ? <p>Nothing has run yet.</p> : null}
        <div className="ov-acts"><button type="button" className="btn sm" onClick={() => { openPlace("inbox"); setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "inbox", tab: "History" } })), 0); }}>All history</button></div>
      </Tile>
      <Tile title="Controls">
        <p>Mode: <b>{lockdown.on ? "Lockdown" : mode || "As each Trunk is set"}</b> · <button type="button" className="ov-link ov-inline" disabled={!openSettings || lockdown.on} onClick={() => openSettings?.("permissions")}>change</button></p>
        <div className="ov-acts"><button type="button" className="btn sm" aria-describedby="overview-lockdown-help" disabled={!lockdown.loaded || !lockdown.supported} title={lockdown.supported ? undefined : "This engine has no Lockdown switch yet."} onClick={toggleLockdown}>{lockdown.on ? "Turn Lockdown off" : "Lockdown"}</button><button type="button" className="btn sm" disabled title={shownWhy(PAUSE_ALL_GAP)}>Pause all Trunks</button></div>
        <p className="ov-hint" id="overview-lockdown-help">{LOCKDOWN_EXPLANATION}.</p>
      </Tile>
      <Tile title="Who is using Branch">
        {status("people", "people")}{status("presence", "live presence")}
        <div className="ov-preslist">{lines.map(person => <PersonRow key={person.id} person={person} rows={rows} agents={trunks.list} open={openConversation} openPlace={openPlace} />)}</div>
        {tiles.people.value !== undefined && !lines.length ? <p>No one has signed in yet.</p> : null}
        <div className="ov-acts"><button type="button" className="btn sm" onClick={() => openPlace("people")}>Invite someone</button></div>
      </Tile>
      <Tile title="Milestones"><div className="ov-badges" data-reason={MILESTONES_GAP} />{shownWhy(MILESTONES_GAP) && <p className="ov-hint">{shownWhy(MILESTONES_GAP)}</p>}</Tile>
    </div>
    {lockdown.confirmation}
  </PlaceFrame>;
}

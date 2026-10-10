// Schedule rows (§4.6.3.1, preview p30-sched): the Trunk's face, the name (opens its sheet), "Turned itself off",
// the schedule words, the health readout from cron.runs, the switch, and the row menu on right-click / Shift+F10.
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Face } from "../../face/Face";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import { Segmented } from "../../shell/Popover";
import { shows, type Level } from "../../places-nav/level";
import { Glyph } from "./glyphs";
import { autoDisabledWords, failing, failureDetails, health, jobName, scheduleWords, when } from "./model";
import type { Trunk } from "./Proposal";
import { rec, str, type Row } from "./runtime";

export type RowActions = { open: (job: Row) => void; toggle: (job: Row) => void; menu: (job: Row, at: MenuAnchor) => void };
type RowProps = { job: Row; trunk: string; runs: Row[]; total?: number; level: Level; canWrite: boolean; busy: boolean; actions: RowActions; checkReadout?: boolean };

/** "Checked <n> times · last <time> · fired <time>" for a trigger with a check first (§4.6.3.3). */
export function checkReadout(job: Row): string {
  const s = rec(job.state), n = Number(s.triggerEvalCount) || 0;
  if (!n) return "not checked yet";
  const last = typeof s.lastTriggerEvalAtMs === "number" ? new Date(s.lastTriggerEvalAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return `Checked ${n} time${n === 1 ? "" : "s"}${last ? ` · last ${last}` : ""} · fired ${typeof s.lastTriggerFireAtMs === "number" ? when(s.lastTriggerFireAtMs) : "never"}`;
}

function Readout({ job, runs, total, trigger }: { job: Row; runs: Row[]; total?: number; trigger?: boolean }) {
  if (trigger && job.trigger) return <span className="au-health"><small>{checkReadout(job)}</small></span>;
  const h = health(runs, total);
  if (!h) return null;
  return <span className={h.warn ? "au-health warn" : "au-health"}>{h.points && <svg className="au-spark" viewBox="0 0 64 18" aria-hidden="true"><polyline points={h.points} /></svg>}<small>{h.text}</small></span>;
}

export function JobRow({ job, trunk, runs, total, level, canWrite, busy, actions, checkReadout: trigger }: RowProps) {
  const auto = autoDisabledWords(job), name = jobName(job), model = str(rec(job.payload).model);
  const failure = failureDetails(job, runs);
  const running = typeof rec(job.state).runningAtMs === "number";
  const onContext = (e: MouseEvent) => { e.preventDefault(); actions.menu(job, { x: e.clientX, y: e.clientY }); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.shiftKey && e.key === "F10") || e.key === "ContextMenu") { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); actions.menu(job, { x: r.left + 40, y: r.bottom - 8 }); }
  };
  return <div className={failing(job) ? "au-row warn" : "au-row"} aria-haspopup="menu" tabIndex={-1} onContextMenu={onContext} onKeyDown={onKey} data-testid="au-row">
    <Face size={34} label={trunk} state={running ? "work" : "idle"} />
    <span className="au-grow">
      <b><button type="button" className="au-name" aria-haspopup="dialog" onClick={() => actions.open(job)}>{name}</button>{auto && <span className="au-pill warn" title="It stopped trying so it wouldn’t keep failing. Fix the cause, then switch it back on." tabIndex={0}><i />{auto}</span>}</b>
      <small>{scheduleWords(rec(job.schedule))} · {trunk}{shows(level, "advanced") && model ? ` · ${model}` : ""}</small>
      {failure && <small className="au-bad">Failing since {when(failure.since)}{failure.error ? ` · ${failure.error}` : ""} · <button type="button" className="au-name" onClick={() => actions.open(job)}>See why</button></small>}
    </span>
    <Readout job={job} runs={runs} total={total} trigger={trigger} />
    <button type="button" role="switch" className="switch" aria-checked={job.enabled === true} aria-label={`${name} on or off`} title={canWrite ? undefined : "Needs an owner"} disabled={!canWrite || busy} onClick={() => actions.toggle(job)} />
    <button type="button" className="au-more" aria-label={`More for ${name}`} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); actions.menu(job, { x: r.right - 180, y: r.bottom + 4 }); }}><Glyph name="more" /></button>
  </div>;
}

type MenuHandlers = { runNow: (j: Row, mode: "force" | "due") => void; change: (j: Row) => void; sends: (j: Row) => void; duplicate: (j: Row) => void; fails: (j: Row) => void; remove: (j: Row) => void };
export function rowMenuItems(job: Row, level: Level, canWrite: boolean, h: MenuHandlers): MenuItem[] {
  const why = canWrite ? undefined : "Needs an owner";
  const adv = shows(level, "advanced");
  return [
    { label: "Run now", run: () => h.runNow(job, "force"), disabled: why, testid: "au-m-run" },
    ...(adv ? [{ label: "Run if it’s due", run: () => h.runNow(job, "due"), disabled: why } as MenuItem] : []),
    { label: "Change…", run: () => h.change(job), disabled: why },
    { label: "Change where it sends…", run: () => h.sends(job), disabled: why },
    { label: "Duplicate", run: () => h.duplicate(job), disabled: why },
    ...(adv ? [{ label: "When it fails…", run: () => h.fails(job), disabled: why } as MenuItem] : []),
    { kind: "sep" },
    { label: "Remove…", run: () => h.remove(job), danger: true, disabled: why },
  ];
}

export type Find = { on: "all" | "on" | "off"; query: string; kind: "all" | "conditional" | "plain"; sort: "next" | "last" | "changed" | "name"; dir: "asc" | "desc" };
export const FIND0: Find = { on: "all", query: "", kind: "all", sort: "next", dir: "asc" };

export function findJobs(jobs: Row[], f: Find): Row[] {
  const q = f.query.trim().toLowerCase();
  const key = (j: Row): number | string => f.sort === "name" ? jobName(j).toLowerCase() : f.sort === "last" ? Number(rec(j.state).lastRunAtMs) || 0 : f.sort === "changed" ? Number(j.updatedAtMs) || 0 : Number(rec(j.state).nextRunAtMs) || Number.MAX_SAFE_INTEGER;
  return jobs
    .filter(j => f.on === "all" || (f.on === "on") === (j.enabled === true))
    .filter(j => f.kind === "all" || (f.kind === "conditional") === Boolean(j.trigger))
    .filter(j => !q || `${jobName(j)} ${str(j.description)} ${str(rec(j.payload).message)}`.toLowerCase().includes(q))
    .sort((a, b) => { const x = key(a), y = key(b); const c = x < y ? -1 : x > y ? 1 : 0; return f.dir === "asc" ? c : -c; });
}

export function FindBar({ find, set }: { find: Find; set: (f: Find) => void }) {
  const [at, setAt] = useState<MenuAnchor | null>(null);
  const tick = (on: boolean) => (on ? "✓" : " ");
  const items = useMemo<MenuItem[]>(() => [
    { kind: "head", label: "Kind" },
    ...(["all", "conditional", "plain"] as const).map(k => ({ label: k === "all" ? "All" : k === "conditional" ? "With a check first" : "Plain", hint: tick(find.kind === k), run: () => set({ ...find, kind: k }) })),
    { kind: "head", label: "Sort by" },
    ...(["next", "last", "changed", "name"] as const).map(s => ({ label: { next: "Next run", last: "Last run", changed: "Recently changed", name: "Name" }[s], hint: tick(find.sort === s), run: () => set({ ...find, sort: s }) })),
    { kind: "head", label: "Order" },
    ...(["asc", "desc"] as const).map(d => ({ label: d === "asc" ? "Ascending" : "Descending", hint: tick(find.dir === d), run: () => set({ ...find, dir: d }) })),
    { kind: "sep" },
    { label: "Reset", run: () => set(FIND0) },
  ], [find, set]);
  return <div className="au-find">
    <Segmented label="Which automations" value={find.on} options={[{ id: "all", name: "All" }, { id: "on", name: "On" }, { id: "off", name: "Off" }]} onChange={on => set({ ...find, on })} />
    <input className="inp" aria-label="Search automations" placeholder="Search automations" value={find.query} onChange={e => set({ ...find, query: e.target.value })} />
    <button type="button" className="btn sm" aria-haspopup="menu" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.right - 200, y: r.bottom + 4 }); }}>Filters <Glyph name="down" size={14} /></button>
    {at && <Menu at={at} label="Filters" items={items} onClose={() => setAt(null)} />}
  </div>;
}

export function summaryLine(jobs: Row[]): { count: number; failing: number; next: string } {
  const next = Math.min(...jobs.filter(j => j.enabled === true).map(j => Number(rec(j.state).nextRunAtMs)).filter(n => n > 0));
  return { count: jobs.length, failing: jobs.filter(failing).length, next: Number.isFinite(next) ? when(next) : "" };
}

export function trunkNameOf(trunks: Trunk[], id: unknown, fallback: string): string {
  return trunks.find(t => t.id === str(id))?.name || trunks.find(t => t.id === fallback)?.name || str(id) || "Default Trunk";
}

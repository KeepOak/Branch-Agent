// Canopy › Cards header (§4.6.7 Boards, Start Trunks, View, More filters): board picker and menu, the linked
// automation chip, Start Trunks, New card, View, the search and Filters menu and the chips of set filters.
import { useState } from "react";
import { shows } from "../../places-nav/level";
import { Icon } from "../../shell/icons";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import { Popover } from "../../shell/Popover";
import { rec, str, type Row } from "../automations/runtime";
import { scheduleWords } from "../automations/model";
import { trunkName } from "./data";
import { ago, boardName, PRIOS, STATUSES, statusName, type CardFilters } from "./cards-model";
import { anchorOf, ChoiceMenu, clock, type Ctx } from "./ui";

export type View = { mode: "columns" | "list"; density: "comfortable" | "compact"; empty: "show" | "collapse" | "hide"; collapsed: Record<string, boolean> };

export function BoardPicker({ ctx, board, setBoard, newBoard, editBoard, archiveBoard, deleteBoard }: {
  ctx: Ctx; board: string; setBoard: (id: string) => void; newBoard: () => void; editBoard: (b: Row) => void; archiveBoard: (b: Row) => void; deleteBoard: (b: Row) => void;
}) {
  const [pick, setPick] = useState<MenuAnchor | null>(null), [more, setMore] = useState<MenuAnchor | null>(null);
  const b = ctx.d.boards.find(x => str(x.id) === board), live = ctx.d.boards.filter(x => !x.archivedAt), gone = ctx.d.boards.filter(x => x.archivedAt);
  const count = (x: Row) => x.kind === "sessions" ? "Conversations" : `${Number(x.active) || 0} active · ${Number(x.total) || 0} total`;
  const row = (x: Row) => ({ id: str(x.id), checked: board === str(x.id), label: <><i className="cn-dot" style={{ ["--c" as string]: str(x.color) || "var(--ink-3)" }} /> {boardName(x)}<span className="cn-mi-r">{count(x)}</span></> });
  const delOff = !b ? "" : str(b.id) === "default" ? "The default board can’t be deleted." : Number(b.total) > 0 ? "Move or delete its cards first; the engine keeps a board that still has cards." : "";
  return <>
    <button className="btn sm cn-pick" type="button" aria-haspopup="menu" onClick={e => setPick(pick ? null : anchorOf(e.currentTarget))}>
      {b && str(b.color) ? <i className="cn-dot" style={{ ["--c" as string]: str(b.color) }} /> : null}{b ? boardName(b) : "All boards"}<Icon name="down" /></button>
    {b ? <button className="ib sm" type="button" aria-haspopup="menu" aria-label="Board menu" title="Board menu" onClick={e => setMore(anchorOf(e.currentTarget))}><Icon name="more" /></button> : null}
    {pick ? <ChoiceMenu at={pick} label="Boards" radio onClose={() => setPick(null)} onPick={id => { setPick(null); setBoard(id); }}
      options={[{ id: "all", checked: board === "all", label: "All boards" }, ...live.map(row), ...gone.map(row)]}
      foot={<><hr className="msep" /><button type="button" role="menuitem" className="mi" disabled={!ctx.write} onClick={() => { setPick(null); newBoard(); }}><span className="cn-mi-t"><Icon name="plus" /> New board</span></button></>} /> : null}
    {more && b ? <Menu at={more} label="Board menu" onClose={() => setMore(null)} items={[
      { label: "Edit board", disabled: ctx.write ? undefined : "Needs permission to change boards.", run: () => editBoard(b) },
      { label: b.archivedAt ? "Restore board" : "Archive board", disabled: ctx.write ? undefined : "Needs permission to change boards.", run: () => archiveBoard(b) },
      { label: "Delete board…", danger: true, disabled: delOff || (ctx.write ? undefined : "Needs permission to change boards."), run: () => deleteBoard(b) },
    ]} /> : null}
  </>;
}

/** [A] "Sorted by <automation>" when the board has a linked automation (board.automationJobId). */
export function AutomationChip({ ctx, b }: { ctx: Ctx; b?: Row }) {
  const jobId = str(b?.automationJobId);
  if (!jobId || !shows(ctx.level, "advanced")) return null;
  const job = ctx.d.jobs.find(j => str(j.id) === jobId);
  if (!job) return <span className="cn-auto">Automation not available. Refresh the board to try again.</span>;
  const next = Number(rec(job.state).nextRunAtMs), changed = Number(job.updatedAtMs) || Number(job.createdAtMs);
  return <span className="cn-auto"><Icon name="clock" />Sorted by {str(job.name)} · {job.enabled ? "On" : "Paused"} · {scheduleWords(rec(job.schedule)) || str(rec(job.schedule).kind)} · {!job.enabled ? "Not scheduled" : next > ctx.now ? `Next run ${clock(next)}` : "Next run due now"}{changed ? ` · Updated ${ago(ctx.now - changed)} ago` : ""} <button className="link" type="button" onClick={() => ctx.openPlace("automations")}>Open</button></span>;
}

export function ViewMenu({ v, setV }: { v: View; setV: (v: View) => void }) {
  const [at, setAt] = useState<MenuAnchor | null>(null);
  const group = <K extends "mode" | "density" | "empty">(k: K, head: string, opts: [View[K], string][]) => <><div className="ph">{head}</div>{opts.map(([id, l]) => (
    <button key={id} type="button" role="menuitemradio" className="mi" aria-checked={v[k] === id} onClick={() => setV({ ...v, [k]: id })}><span className="cn-mi-t">{l}</span><span className="cn-tick">{v[k] === id ? <Icon name="check" /> : null}</span></button>))}</>;
  return <>
    <button className="btn sm" type="button" aria-haspopup="menu" onClick={e => setAt(at ? null : anchorOf(e.currentTarget, true))}>View<Icon name="down" /></button>
    {at ? <Popover at={at} label="View" onClose={() => setAt(null)}><div className="cn-menu" role="menu" aria-label="View">
      {group("mode", "View", [["columns", "Columns"], ["list", "List"]])}{group("density", "Density", [["comfortable", "Comfortable"], ["compact", "Compact"]])}{group("empty", "Empty columns", [["show", "Show"], ["collapse", "Collapse"], ["hide", "Hide"]])}
    </div></Popover> : null}
  </>;
}

export function CardFilterRow({ ctx, F, setF, trunks, setTrunks }: { ctx: Ctx; F: CardFilters; setF: (f: CardFilters) => void; trunks: string[]; setTrunks: (t: string[]) => void }) {
  const [search, setSearch] = useState(false), [at, setAt] = useState<MenuAnchor | null>(null);
  const flip = (k: "needs" | "quiet" | "noproof" | "arch") => setF({ ...F, [k]: !F[k] });
  const list = (k: "prio" | "status", id: string) => setF({ ...F, [k]: F[k].includes(id) ? F[k].filter(x => x !== id) : [...F[k], id] });
  const item = (on: boolean, label: string, run: () => void, sub?: string, radio?: boolean) => <button key={label} type="button" role={radio ? "menuitemradio" : "menuitemcheckbox"} className="mi" aria-checked={on} onClick={run}><span className="cn-mi-t">{label}{sub ? <small>{sub}</small> : null}</span><span className="cn-tick">{on ? <Icon name="check" /> : null}</span></button>;
  const chips: [string, () => void][] = [
    ...trunks.map((t): [string, () => void] => [`Trunk: ${trunkName(ctx.d, t)}`, () => setTrunks(trunks.filter(x => x !== t))]),
    ...(F.q ? [[`Search: “${F.q}”`, () => { setF({ ...F, q: "" }); setSearch(false); }] as [string, () => void]] : []),
    ...(F.arch ? [["Show archived", () => flip("arch")] as [string, () => void]] : []), ...(F.needs ? [["Needs a look", () => flip("needs")] as [string, () => void]] : []),
    ...(F.quiet ? [["No recent activity", () => flip("quiet")] as [string, () => void]] : []), ...(F.noproof ? [["Done without proof", () => flip("noproof")] as [string, () => void]] : []),
    ...(F.done === "week" ? [["Done cards: Last 7 days", () => setF({ ...F, done: "all" })] as [string, () => void]] : []),
    ...F.prio.map((p): [string, () => void] => [`Priority: ${PRIOS.find(x => x[0] === p)?.[1] ?? p}`, () => list("prio", p)]),
    ...F.status.map((s): [string, () => void] => [`Status: ${statusName(s)}`, () => list("status", s)]),
  ];
  return <>
    <div className="cn-cfilt">
      {search || F.q ? <input className="inp cn-q" autoFocus value={F.q} placeholder="Search cards" aria-label="Search cards" onChange={e => setF({ ...F, q: e.target.value })} onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setF({ ...F, q: "" }); setSearch(false); } }} />
        : <button className="btn sm" type="button" onClick={() => setSearch(true)}><Icon name="search" />Search cards</button>}
      <button className="btn sm" type="button" aria-haspopup="menu" onClick={e => setAt(at ? null : anchorOf(e.currentTarget))}>Filters<Icon name="down" /></button>
    </div>
    {at ? <Popover at={at} label="Filters" onClose={() => setAt(null)}><div className="cn-menu" role="menu" aria-label="Filters">
      {item(F.needs, "Needs a look", () => flip("needs"))}{item(F.quiet, "No recent activity", () => flip("quiet"), "Cards marked stale or tied to a quiet conversation")}
      {item(F.noproof, "Done without proof", () => flip("noproof"), "Finished cards with no proof, results or attachments")}
      <div className="ph">Done cards</div>{item(F.done === "all", "All time", () => setF({ ...F, done: "all" }), undefined, true)}{item(F.done === "week", "Last 7 days", () => setF({ ...F, done: "week" }), undefined, true)}
      <div className="ph">Priority</div>{PRIOS.map(([k, l]) => item(F.prio.includes(k), l, () => list("prio", k)))}
      <div className="ph">Status</div>{STATUSES.map(([k, l]) => item(F.status.includes(k), l, () => list("status", k)))}
      <hr className="msep" />{item(F.arch, "Show archived", () => flip("arch"))}
    </div></Popover> : null}
    {chips.length ? <div className="cn-chips">{chips.map(([l, x]) => <span key={l} className="cn-chipx">{l}<button type="button" className="ib sm" aria-label={`Remove ${l}`} title={`Remove ${l}`} onClick={x}><Icon name="x" /></button></span>)}
      <button className="btn ghost sm" type="button" onClick={() => { setF({ q: "", needs: false, quiet: false, noproof: false, done: "all", prio: [], status: [], arch: false }); setTrunks([]); setSearch(false); }}>Clear filters</button></div> : null}
  </>;
}

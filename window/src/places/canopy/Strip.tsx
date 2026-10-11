// The computers strip and the Trunk / Person / Computer filters (§4.6.7), shown on both tabs.
import { useState } from "react";
import { Icon } from "../../shell/icons";
import type { MenuAnchor } from "../../shell/Menu";
import { Popover } from "../../shell/Popover";
import { shows } from "../../places-nav/level";
import { rec, str } from "../automations/runtime";
import { computerOf, isHelper, isRunning, people, sessionTitle, type Computer, type Run } from "./data";
import type { Filters } from "./runs";
import { anchorOf, ChoiceMenu, TrunkFace, type Ctx } from "./ui";

const WORD: Record<Computer["state"], string> = { ok: "Online", sleep: "Asleep · wakes when asked", off: "Offline" };

/** A chip names a run count only when runs are tied to it: Canopy sees only this Gateway's runs, so "0 running" isn't a fact. */
const runningOn = (live: Run[], c: Computer) => c.counted === false ? 0 : live.filter(r => r.comp === c.id).length;

export function Strip({ ctx, runs, f, setF }: { ctx: Ctx; runs: Run[]; f: Filters; setF: (f: Filters) => void }) {
  const [menu, setMenu] = useState<{ id: string; at: MenuAnchor } | null>(null);
  const live = runs.filter(r => r.col === "working" || r.col === "waiting");
  const pick = (id: string) => setF({ ...f, comp: f.comp.length === 1 && f.comp[0] === id ? [] : [id] });
  const more = (id: string, el: HTMLElement) => { if (shows(ctx.level, "advanced")) setMenu({ id, at: anchorOf(el) }); };
  return (
    <div className="cn-strip" role="group" aria-label="Computers">
      {ctx.comps.map(c => (
        <button key={c.id} type="button" className="cn-chip" aria-pressed={f.comp.length === 1 && f.comp[0] === c.id} title={WORD[c.state]}
          onClick={() => pick(c.id)}
          onContextMenu={e => { if (!shows(ctx.level, "advanced")) return; e.preventDefault(); more(c.id, e.currentTarget); }}
          onKeyDown={e => { if (e.key === "F10" && e.shiftKey) { e.preventDefault(); more(c.id, e.currentTarget); } }}>
          <Icon name="monitor" /><b>{c.name}</b><span className={`cn-cdot ${c.state}`} role="img" aria-label={WORD[c.state]} />{runningOn(live, c) ? <small>{runningOn(live, c)} running</small> : null}
        </button>
      ))}
      {menu ? <OnComputer ctx={ctx} id={menu.id} at={menu.at} close={() => setMenu(null)} /> : null}
    </div>
  );
}

/** [A] Conversations on a computer: the conversations tied to it, grouped by how they are tied. */
function OnComputer({ ctx, id, at, close }: { ctx: Ctx; id: string; at: MenuAnchor; close: () => void }) {
  const comp = ctx.comps.find(c => c.id === id), all = ctx.d.sessions.filter(s => !isHelper(s));
  const tied = all.filter(s => computerOf(s, ctx.d.nodes) === id);
  const groups: [string, typeof all][] = [
    ["Placed here", tied.filter(s => str(rec(s.placement).providerId))],
    ["Running here", tied.filter(isRunning)],
    ["Runs commands here", all.filter(s => str(s.execNode) === id)],
    ["On the Gateway’s computer", id === "this" ? tied.filter(s => !isRunning(s)) : []],
  ];
  const shown = groups.filter(g => g[1].length);
  return (
    <Popover at={at} label={`On ${comp?.name ?? ""}`} onClose={close}>
      <div className="cn-menu" role="menu" aria-label={`On ${comp?.name ?? ""}`}>
        <div className="ph">On {comp?.name}</div>
        {shown.length ? shown.map(([label, list]) => <div key={label}><div className="ph">{label}</div>{list.slice(0, 12).map(s => (
          <button key={str(s.key)} type="button" role="menuitem" className="mi" onClick={() => { close(); ctx.openConversation(str(s.key)); }}>
            <span className="cn-mi-t"><TrunkFace name={ctx.d.trunks.find(t => t.id === s.agentId)?.name || str(s.agentId)} size={20} /> {sessionTitle(s)}</span>
            <span className="mi-hint">{isRunning(s) ? "working" : "idle"}</span>
          </button>))}</div>) : <p className="cn-hint cn-pad">No conversations tied to this computer.</p>}
        <p className="cn-hint cn-pad">A tie doesn’t prove a step ran here.</p>
      </div>
    </Popover>
  );
}

type Key = keyof Filters;
const TITLES: Record<Key, string> = { trunk: "Trunk", person: "Person", comp: "Computer" };

export function FilterRow({ ctx, f, setF }: { ctx: Ctx; f: Filters; setF: (f: Filters) => void }) {
  const [open, setOpen] = useState<{ k: Key; at: MenuAnchor } | null>(null);
  const opts = (k: Key) => k === "trunk" ? ctx.d.trunks.map(t => ({ id: t.id, label: t.name }))
    : k === "person" ? people(ctx.d).map(p => ({ id: p.id, label: p.id === ctx.d.viewer ? `${p.name} (you)` : p.name })) : ctx.comps.map(c => ({ id: c.id, label: c.name }));
  const toggle = (k: Key, id: string) => setF({ ...f, [k]: f[k].includes(id) ? f[k].filter(x => x !== id) : [...f[k], id] });
  const any = f.trunk.length || f.person.length || f.comp.length;
  return (
    <div className="cn-filt" role="toolbar" aria-label="Filters">
      {(["trunk", "person", "comp"] as Key[]).map(k => (
        <button key={k} type="button" className="btn sm" aria-haspopup="menu" aria-expanded={open?.k === k} onClick={e => setOpen(open?.k === k ? null : { k, at: anchorOf(e.currentTarget) })}>
          {TITLES[k]}{f[k].length ? <span className="cn-n">{f[k].length}</span> : null}<Icon name="down" />
        </button>
      ))}
      {any ? <button type="button" className="btn ghost sm" onClick={() => setF({ trunk: [], person: [], comp: [] })}>Clear</button> : null}
      {open ? <ChoiceMenu at={open.at} label={TITLES[open.k]} head={TITLES[open.k]} onClose={() => setOpen(null)} onPick={id => toggle(open.k, id)}
        options={opts(open.k).map(o => ({ ...o, checked: f[open.k].includes(o.id) }))}
        foot={!opts(open.k).length ? <p className="cn-hint cn-pad">{open.k === "person" ? "Nobody else has started anything here." : "None yet."}</p> : null} /> : null}
    </div>
  );
}

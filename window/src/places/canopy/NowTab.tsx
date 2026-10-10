// Canopy › Now (§4.6.7): five state columns; at phone width one column at a time, picked from a menu.
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows } from "../../places-nav/level";
import { COLS, type Col, type Run } from "./data";
import { Glyph } from "./glyphs";
import { RunCard } from "./RunCard";
import { BackgroundTasks, EveryStep } from "./Live";
import type { Ctx } from "./ui";

/** `filtered` is true while a Trunk, Person or Computer filter is on; `clear` turns them all off. */
export function NowTab({ ctx, all, list, filtered, clear }: { ctx: Ctx; all: Run[]; list: Run[]; filtered: boolean; clear: () => void }) {
  const [col, setCol] = useState<Col>("working");
  const [steer, setSteer] = useState<string | null>(null);
  const extra = shows(ctx.level, "advanced") ? <><EveryStep ctx={ctx} /><BackgroundTasks ctx={ctx} /></> : null;
  if (!list.some(r => r.col !== "done")) {
    const hidden = filtered && all.some(r => r.col !== "done");
    return <>
      <EmptyLine icon={<span className="cn-empty-i"><Glyph name="eye" /></span>}>{hidden ? "Nothing running matches these filters." : "Nothing is running right now."}</EmptyLine>
      <div className="cn-center">{hidden
        ? <button className="btn ghost sm" type="button" onClick={clear}>Clear filters</button>
        : <button className="btn ghost sm" type="button" onClick={() => ctx.openPlace("overview")}>Open Overview</button>}</div>
      {extra}
    </>;
  }
  const count = (k: Col) => list.filter(r => r.col === k).length;
  return <>
    <label className="cn-colpick">
      <select className="inp" aria-label="Which column" value={col} onChange={e => setCol(e.target.value as Col)}>
        {COLS.map(([k, l]) => <option key={k} value={k}>{l} · {count(k)}</option>)}
      </select>
    </label>
    <div className="cn-board">
      {COLS.map(([k, l]) => (
        <section key={k} className={col === k ? "cn-col on" : "cn-col"} aria-label={l}>
          <h3>{l}<span>{count(k)}</span></h3>
          <div role="list" className="cn-list">
            {list.filter(r => r.col === k).map(r => <RunCard key={r.key} r={r} ctx={ctx} steering={steer === r.key} setSteering={setSteer} />)}
            {!count(k) ? <p className="cn-empty">Nothing here</p> : null}
          </div>
          {k === "done" ? <button className="btn ghost sm" type="button" onClick={() => { ctx.openPlace("inbox"); setTimeout(() => dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "inbox", tab: "History" } })), 0); }}>All history</button> : null}
        </section>
      ))}
    </div>
    {extra}
  </>;
}

// Canopy (DESIGN-SPEC §4.6.7; preview patches 40-places, 41-placesap, 96-appopsp): every run, helper, computer and
// card, seen from above and steered. Data: engine sessions, approvals, cron, node/computer status and the canopy add-on.
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { PlaceScroll, type PlaceProps } from "../../places-nav/PlaceFrame";
import { canApprove, canWrite, usePlaceData } from "../automations/runtime";
import { computers, loadCanopy } from "./data";
import { buildRuns, filterRuns, NO_FILTERS, type Filters } from "./runs";
import { NowTab } from "./NowTab";
import { CardsTab } from "./CardsTab";
import { CardsOff, isCardsOff } from "./CardsOff";
import { CardSheet } from "./CardSheet";
import { CardDialog, cardPatch, draftOf } from "./CardDialogs";
import { FilterRow, Strip } from "./Strip";
import type { Ctx } from "./ui";
import type { Row } from "../automations/runtime";
import "./canopy.css";

const TABS = [["now", "Now"], ["cards", "Cards"]] as const;
type Tab = (typeof TABS)[number][0];

function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number, select: (tab: Tab) => void) {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
    : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
    : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
  const target = TABS[next];
  if (!target) return;
  event.preventDefault();
  select(target[0]);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
}

export function CanopyPlace({ engine, openConversation, openPlace, level }: PlaceProps) {
  const state = usePlaceData(engine, loadCanopy);
  const [tab, setTab] = useState<Tab>("now"), [f, setF] = useState<Filters>(NO_FILTERS);
  const [sheet, setSheet] = useState(""), [editing, setEditing] = useState<Row | null>(null);
  // The frame asks for a tab after routing here (window "branch:place-tab" {place, tab}).
  useEffect(() => {
    const onTab = (e: Event) => { const t = (e as CustomEvent<{ place?: string; tab?: string }>).detail; if (t?.place === "canopy" && /^(now|cards)$/i.test(t.tab ?? "")) setTab(t.tab!.toLowerCase() as "now" | "cards"); };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
  const act = useCallback(async (op: () => Promise<unknown>, message: string) => {
    const ok = await state.act(op, message);
    if (!ok) void state.refresh();
    return ok;
  }, [state]);
  const d = state.data, now = Date.now();
  const comps = useMemo(() => d ? computers(d) : [], [d]);
  const all = useMemo(() => d ? buildRuns(d, now) : [], [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const ctx: Ctx | null = d ? {
    engine, d, level, comps, now, write: canWrite(engine), approve: canApprove(engine), busy: state.busy, act, openConversation, openPlace,
    openCard: id => { setTab("cards"); setSheet(id); },
  } : null;
  const n = all.filter(r => r.col === "working" || r.col === "waiting").length;
  return (
    <PlaceScroll>
      <div className="place wide-tools cn-place">
        <h1>Canopy</h1>
        <button className="btn sm cn-office-btn" type="button" onClick={() => openPlace("office")}>Office view</button>
        <p className="lede">Everything your Trunks and their helpers are doing, on every computer, seen from above.</p>
        <div className="cn-tabs" role="tablist" aria-label="Canopy">{TABS.map(([id, name], index) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={event => moveTab(event, index, setTab)} onClick={() => setTab(id)}>{name}{id === "now" && n ? <span className="cn-tabn">{n}</span> : null}</button>))}</div>
        {state.loading && !d ? <p role="status" className="cn-hint">Reading live work…</p> : null}
        {state.error ? <p role="alert" className="cn-err">{state.error}</p> : null}
        {d?.errors.map(e => <p role="alert" className="cn-err" key={e}>{e}</p>)}
        {state.notice ? <p role="status" className="cn-notice">{state.notice}</p> : null}
        {ctx ? <>
          <Strip ctx={ctx} runs={all} f={f} setF={setF} /><FilterRow ctx={ctx} f={f} setF={setF} />
          {tab === "now" ? <NowTab ctx={ctx} all={all} list={filterRuns(all, f)} />
            : d && isCardsOff(d.cardsError) ? <CardsOff ctx={ctx} refresh={() => void state.refresh()} />
            : d?.cardsError ? <p role="alert" className="cn-err">Cards: {d.cardsError}</p>
            : <CardsTab ctx={ctx} trunks={f.trunk} setTrunks={t => setF({ ...f, trunk: t })} sheet={c => setSheet(String(c.id))} />}
          {sheet && !editing ? <CardSheet ctx={ctx} id={sheet} close={() => setSheet("")} edit={c => setEditing(c)} /> : null}
          {editing ? <CardDialog ctx={ctx} base={editing} start={draftOf(editing)} close={() => setEditing(null)}
            save={x => act(() => engine.request("canopy.cards.update", { id: editing.id, expectedUpdatedAt: editing.updatedAt, patch: cardPatch(x, editing) }), "Saved.")} /> : null}
        </> : null}
      </div>
    </PlaceScroll>
  );
}

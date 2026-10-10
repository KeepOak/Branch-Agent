// Canopy (DESIGN-SPEC §4.6.7; preview patches 40-places, 41-placesap, 96-appopsp): every run, helper, computer and
// card, seen from above and steered. Data: engine sessions, approvals, cron, node/computer status and the canopy add-on.
// Cards live on Automations › Board; a card a run names opens there.
import { useEffect, useState } from "react";
import { PlaceScroll, type PlaceProps } from "../../places-nav/PlaceFrame";
import { openBoard } from "../automations/board-route";
import { filterRuns, NO_FILTERS, type Filters } from "./runs";
import { NowTab } from "./NowTab";
import { FilterRow, Strip } from "./Strip";
import { useCanopy } from "./useCanopy";
import "./canopy.css";

export function CanopyPlace({ engine, openConversation, openPlace, level }: PlaceProps) {
  const { state, d, ctx, all } = useCanopy(engine, level, openConversation, openPlace);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  // A request for the old Cards tab goes to the Board, where the cards are now.
  useEffect(() => {
    const onTab = (e: Event) => { const t = (e as CustomEvent<{ place?: string; tab?: string }>).detail; if (t?.place === "canopy" && /^cards$/i.test(t.tab ?? "")) openBoard(); };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
  return (
    <PlaceScroll>
      <div className="place wide-tools cn-place">
        <h1>Canopy</h1>
        <button className="btn sm cn-office-btn" type="button" onClick={() => openPlace("office")}>Office view</button>
        <p className="lede">Everything your Trunks and their helpers are doing, on every computer, seen from above.</p>
        {state.loading && !d ? <p role="status" className="cn-hint">Reading live work…</p> : null}
        {state.error ? <p role="alert" className="cn-err">{state.error}</p> : null}
        {d?.errors.map(e => <p role="alert" className="cn-err" key={e}>{e}</p>)}
        {state.notice ? <p role="status" className="cn-notice">{state.notice}</p> : null}
        {ctx ? <>
          <Strip ctx={ctx} runs={all} f={f} setF={setF} /><FilterRow ctx={ctx} f={f} setF={setF} />
          <NowTab ctx={ctx} all={all} list={filterRuns(all, f)} />
        </> : null}
      </div>
    </PlaceScroll>
  );
}

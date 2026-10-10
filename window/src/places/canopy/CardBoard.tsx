// The card board (Canopy's nine statuses, boards, drag and Start Trunks), read through canopy.cards.list like Canopy.
// Automations › Board renders it under its Today, Running or All header. Running also lists background tasks.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import type { PlaceId } from "../../places-nav/routes";
import type { BoardScope } from "../automations/board-route";
import type { Row } from "../automations/runtime";
import { BackgroundTasks } from "./Live";
import { CardsTab } from "./CardsTab";
import { CardSheet } from "./CardSheet";
import { CardDialog, cardPatch, draftOf } from "./CardDialogs";
import { useCanopy } from "./useCanopy";

export type CardBoardProps = {
  engine: WindowEngine; level: Level; openConversation: (key: string) => void; openPlace: (place: PlaceId) => void;
  scope: BoardScope; onShowAll: () => void;
  /** A card whose sheet opens, from a link elsewhere. A new object each time, so the same card can open again. */
  openCard: { id: string } | null;
};

export function CardBoard({ engine, level, openConversation, openPlace, scope, onShowAll, openCard }: CardBoardProps) {
  const { state, d, ctx, act } = useCanopy(engine, level, openConversation, openPlace);
  const [trunks, setTrunks] = useState<string[]>([]), [sheet, setSheet] = useState(""), [editing, setEditing] = useState<Row | null>(null);
  // A new request for a card opens its sheet; the same request object does not reopen a sheet that was closed.
  const [seen, setSeen] = useState<{ id: string } | null>(null);
  if (openCard !== seen) { setSeen(openCard); if (openCard) setSheet(openCard.id); }
  if (d?.cardsError) {
    return <div className="cn-center">
      <p role="alert" className="cn-err">The Board can’t load its cards right now.</p>
      <button className="btn sm" type="button" onClick={() => void state.refresh()}>Try again</button>
    </div>;
  }
  if (!ctx) return state.error ? <p role="alert" className="cn-err">{state.error}</p> : <p role="status" className="cn-hint">Reading the Board…</p>;
  return <>
    {state.notice ? <p role="status" className="cn-notice">{state.notice}</p> : null}
    <CardsTab ctx={ctx} trunks={trunks} setTrunks={setTrunks} sheet={c => setSheet(String(c.id))} scope={scope} onShowAll={onShowAll} />
    {scope === "running" ? <BackgroundTasks ctx={ctx} /> : null}
    {sheet && !editing ? <CardSheet ctx={ctx} id={sheet} close={() => setSheet("")} edit={c => setEditing(c)} /> : null}
    {editing ? <CardDialog ctx={ctx} base={editing} start={draftOf(editing)} close={() => setEditing(null)}
      save={x => act(() => engine.request("canopy.cards.update", { id: editing.id, expectedUpdatedAt: editing.updatedAt, patch: cardPatch(x, editing) }), "Saved.")} /> : null}
  </>;
}

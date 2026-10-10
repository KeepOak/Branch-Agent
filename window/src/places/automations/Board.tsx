// Automations › Board: the one board for Trunk work. It shows Canopy's cards, the same ones Canopy's Now tab reads.
// Today is the default view: the cards a Trunk is on now, and anything that changed since midnight. All shows every card.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import type { PlaceId } from "../../places-nav/routes";
import { Segmented } from "../../shell/Popover";
import { CardBoard } from "../canopy/CardBoard";
import { BOARD_CARD_EVENT, peekBoardCard, takeBoardRequest } from "./board-route";

export type BoardProps = { engine: WindowEngine; level: Level; openConversation: (key: string) => void; openPlace: (place: PlaceId) => void };

export function BoardTab({ engine, level, openConversation, openPlace }: BoardProps) {
  const [today, setToday] = useState(true);
  const [openCard, setOpenCard] = useState(peekBoardCard);
  useEffect(() => {
    takeBoardRequest();
    const onCard = (e: Event) => {
      const id = String((e as CustomEvent<{ id?: string }>).detail?.id ?? "");
      if (!id) return;
      takeBoardRequest();
      setOpenCard({ id });
    };
    window.addEventListener(BOARD_CARD_EVENT, onCard);
    return () => window.removeEventListener(BOARD_CARD_EVENT, onCard);
  }, []);
  return <div className="au-tab">
    <div className="au-board-h">
      <p className="au-hint">Today shows what your Trunks are on now, and what changed since midnight. Drag a card to move it yourself.</p>
      <Segmented label="Show" value={today ? "today" : "all"} options={[{ id: "today", name: "Today" }, { id: "all", name: "All cards" }]} onChange={v => setToday(v === "today")} />
    </div>
    <div className="au-board">
      <CardBoard engine={engine} level={level} openConversation={openConversation} openPlace={openPlace} today={today} onShowAll={() => setToday(false)} openCard={openCard} />
    </div>
  </div>;
}

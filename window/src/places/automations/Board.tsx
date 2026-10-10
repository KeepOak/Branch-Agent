// Automations › Board: the one board for Trunk work. It shows Canopy's cards, the same ones the Overview's running count reads.
// Today is the default view: the cards a Trunk is on now, and anything that changed since midnight. Running and All cards are one click away.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import type { PlaceId } from "../../places-nav/routes";
import { Segmented } from "../../shell/Popover";
import { CardBoard } from "../canopy/CardBoard";
import { BOARD_REQUEST_EVENT, peekBoardRequest, takeBoardRequest, type BoardRequest, type BoardScope } from "./board-route";

export type BoardProps = { engine: WindowEngine; level: Level; openConversation: (key: string) => void; openPlace: (place: PlaceId) => void };

export function BoardTab({ engine, level, openConversation, openPlace }: BoardProps) {
  const [first] = useState(peekBoardRequest);
  const [scope, setScope] = useState<BoardScope>(first?.scope ?? "today");
  const [openCard, setOpenCard] = useState<{ id: string } | null>(first?.card ? { id: first.card } : null);
  useEffect(() => {
    takeBoardRequest();
    const onRequest = (e: Event) => {
      const req = (e as CustomEvent<BoardRequest>).detail ?? {};
      if (req.scope) setScope(req.scope);
      if (req.card) setOpenCard({ id: req.card });
      takeBoardRequest();
    };
    window.addEventListener(BOARD_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(BOARD_REQUEST_EVENT, onRequest);
  }, []);
  return <div className="au-tab">
    <div className="au-board-h">
      <p className="au-hint">Today shows what your Trunks are on now, and what changed since midnight. Drag a card to move it yourself.</p>
      <Segmented label="Show" value={scope} options={[{ id: "today", name: "Today" }, { id: "running", name: "Running" }, { id: "all", name: "All cards" }]} onChange={setScope} />
    </div>
    <div className="au-board">
      <CardBoard engine={engine} level={level} openConversation={openConversation} openPlace={openPlace} scope={scope} onShowAll={() => setScope("all")} openCard={openCard} />
    </div>
  </div>;
}

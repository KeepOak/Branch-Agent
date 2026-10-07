// Automations › Board (§4.6.3.5, preview p40-auto-other): six columns showing Canopy's cards.
import { useState } from "react";
import type { PlaceId } from "../../places-nav/routes";
import { shownWhy } from "../../shell/shown-why";
import { Icon } from "../../shell/icons";
import type { MenuAnchor } from "../../shell/Menu";
import type { Row } from "../automations/runtime";
import { str } from "../automations/runtime";
import { statusToColumn, columnToStatus, moveDisabledReason, type BoardCol } from "./board-mapping";
import { TrunkFace, Nobody, anchorOf, ChoiceMenu } from "../canopy/ui";
import { trunkName, type CanopyData } from "../canopy/data";
import { statusName } from "../canopy/cards-model";
import type { WindowEngine } from "../../connect/engine";
import { Glyph } from "./glyphs";

export const ORCHARD_COLUMNS: [BoardCol, string][] = [
  ["sort", "To sort"], ["todo", "To do"], ["doing", "Doing"], ["check", "To check"], ["done", "Done"], ["stuck", "Stuck"]
];
export const ORCHARD_NEEDS = "Needs the engine's Orchard board store.";

/** Opens Canopy on its Cards tab (places listen for "branch:place-tab"). */
export function openCanopyCards(openPlace: (place: PlaceId) => void) {
  openPlace("canopy");
  setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Cards" } })), 0);
}

type CardsByCol = Record<BoardCol, Row[]>;

export function BoardTab({ 
  openPlace, 
  data, 
  engine, 
  openCard,
  write,
  busy,
  act
}: { 
  openPlace: (place: PlaceId) => void;
  data: CanopyData | null;
  engine: WindowEngine | null;
  openCard: (id: string) => void;
  write: boolean;
  busy: boolean;
  act: (op: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const [menu, setMenu] = useState<{ cardId: string; at: MenuAnchor } | null>(null);

  if (!data || !engine) {
    return <div className="au-tab">
      <div className="au-board-h"><button type="button" className="btn sm" disabled title={shownWhy(ORCHARD_NEEDS)}>Bring in issues</button><p className="au-hint">Work that takes more than one sitting. Trunks move their own cards; drag one to move it yourself.</p></div>
      <div className="au-banner" role="status"><Glyph name="board" /><span className="au-grow"><small>Cards your Trunks work on today are in Canopy.</small></span><button type="button" className="btn sm" onClick={() => openCanopyCards(openPlace)}>Open Canopy</button></div>
      <div className="au-board">{ORCHARD_COLUMNS.map(([k, c]) => <section className={k === "stuck" ? "au-col stuck" : "au-col"} key={k} aria-label={c}><h3>{c}<span>0</span></h3></section>)}</div>
    </div>;
  }

  // Group cards by column
  const cardsByCol: CardsByCol = {
    sort: [], todo: [], doing: [], check: [], done: [], stuck: []
  };

  data.cards.forEach(card => {
    const status = str(card.status);
    if (status) {
      const col = statusToColumn(status as any);
      cardsByCol[col].push(card);
    }
  });

  const hasCards = data.cards.length > 0;

  const moveCard = (cardId: string, toCol: BoardCol) => {
    const newStatus = columnToStatus(toCol);
    if (!newStatus) return;
    
    const card = data.cards.find(c => str(c.id) === cardId);
    if (!card) return;

    setMenu(null);
    void act(
      () => engine.request("canopy.cards.move", { 
        id: cardId, 
        status: newStatus, 
        expectedUpdatedAt: card.updatedAt 
      }),
      `Moved to ${ORCHARD_COLUMNS.find(([k]) => k === toCol)?.[1]}.`
    );
  };

  return <div className="au-tab">
    <div className="au-board-h">
      <button type="button" className="btn sm" disabled title={shownWhy("Issue intake is being added in a separate change.")}>Bring in issues</button>
      <p className="au-hint">Work that takes more than one sitting. Trunks move their own cards; drag one to move it yourself.</p>
    </div>
    
    {!hasCards && (
      <div className="au-banner" role="status">
        <Glyph name="board" />
        <span className="au-grow">
          <small>No cards yet. Cards are made from conversations, scheduled work, or by hand in Canopy.</small>
        </span>
        <button type="button" className="btn sm" onClick={() => openCanopyCards(openPlace)}>Open Canopy</button>
      </div>
    )}

    <div className="au-board">
      {ORCHARD_COLUMNS.map(([colKey, colLabel]) => {
        const cards = cardsByCol[colKey];
        return (
          <section 
            className={colKey === "stuck" ? "au-col stuck" : "au-col"} 
            key={colKey} 
            aria-label={colLabel}
          >
            <h3>{colLabel}<span>{cards.length}</span></h3>
            {cards.length === 0 ? (
              <p className="au-col-empty">Nothing here</p>
            ) : (
              cards.map(card => {
                const cardId = str(card.id);
                const title = str(card.title);
                const agentId = str(card.agentId);
                const agent = agentId ? trunkName(data, agentId) : "";
                const status = str(card.status);
                
                return (
                  <div 
                    key={cardId} 
                    className="au-card"
                    role="listitem"
                    onClick={() => openCard(cardId)}
                  >
                    <b>{title}</b>
                    <span className="au-card-foot">
                      {agent ? <TrunkFace name={agent} size={18} /> : <Nobody size={18} />}
                      <small>{statusName(status)}</small>
                    </span>
                    <button 
                      type="button" 
                      className="au-card-more" 
                      aria-label={`Move "${title}"`}
                      aria-haspopup="menu"
                      disabled={!write}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ cardId, at: anchorOf(e.currentTarget, true) });
                      }}
                    >
                      <Icon name="more" />
                    </button>
                  </div>
                );
              })
            )}
          </section>
        );
      })}
    </div>

    {menu && (
      <ChoiceMenu
        at={menu.at}
        label="Move to"
        radio
        onClose={() => setMenu(null)}
        options={ORCHARD_COLUMNS.map(([colKey, colLabel]) => {
          const card = data.cards.find(c => str(c.id) === menu.cardId);
          const currentCol = card ? statusToColumn(str(card.status) as any) : null;
          const disabled = moveDisabledReason(colKey);
          
          return {
            id: colKey,
            label: colLabel,
            checked: currentCol === colKey,
            disabled: disabled || undefined
          };
        })}
        onPick={(colKey) => moveCard(menu.cardId, colKey as BoardCol)}
      />
    )}
  </div>;
}

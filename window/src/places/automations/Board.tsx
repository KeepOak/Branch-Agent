// Automations › Board (§4.6.3.5, preview orchard D18): six columns of Canopy cards.
import { useState, type DragEvent } from "react";
import type { PlaceId } from "../../places-nav/routes";
import { shownWhy } from "../../shell/shown-why";
import { Icon } from "../../shell/icons";
import type { MenuAnchor } from "../../shell/Menu";
import { str, type Row } from "./runtime";
import { BOARD_COLUMNS, colName, columnToStatus, statusToColumn, type BoardCol } from "./board-mapping";
import { BLOCK, isArchived, trunkName, whyOf, type CanopyData } from "../canopy/data";
import { statusName } from "../canopy/cards-model";
import { ChoiceMenu, Nobody, Pill, TrunkFace, anchorOf } from "../canopy/ui";
import type { WindowEngine } from "../../connect/engine";

export const ORCHARD_COLUMNS = BOARD_COLUMNS.map(([, name]) => name);
export const ORCHARD_NEEDS = "Needs the engine’s issue intake method.";
const INTAKE = "Needs the engine’s issue intake method.";
const SPLIT_WHY = "Open the card in Canopy to split it into smaller cards.";
const STUCK_WHY = "Open the card to write why it’s stuck.";

/** Opens Canopy on its Cards tab (places listen for "branch:place-tab"). */
export function openCanopyCards(openPlace: (place: PlaceId) => void) {
  openPlace("canopy");
  setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Cards" } })), 0);
}

const tidyTitle = (title: string) => {
  const s = title.replace(/[?!.]+$/g, "").replace(/\bthing\b/i, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : title;
};

const liveCards = (cards: Row[]) => cards.filter(c => !isArchived(c) && statusToColumn(str(c.status)));

export function BoardTab({
  openPlace, data, engine, openCard, write, act,
}: {
  openPlace: (place: PlaceId) => void;
  data: CanopyData | null;
  engine: WindowEngine | null;
  openCard: (id: string) => void;
  write: boolean;
  act: (op: () => Promise<unknown>, message: string) => Promise<boolean>;
}) {
  const [menu, setMenu] = useState<{ cardId: string; at: MenuAnchor } | null>(null);
  const [asking, setAsking] = useState("");
  const [ask, setAsk] = useState("");
  const [over, setOver] = useState<BoardCol | null>(null);

  if (!engine || !data) {
    return <div className="au-tab">
      <div className="au-board-h"><button type="button" className="btn sm" disabled title={shownWhy(INTAKE)}>Bring in issues</button>
        <p className="au-hint">Work that takes more than one sitting. Trunks move their own cards; drag one to move it yourself.</p></div>
      <p className="au-hint" role="status">Reading cards…</p>
      <div className="au-board" role="list">{BOARD_COLUMNS.map(([k, name]) => <section className={k === "stuck" ? "au-col stuck" : "au-col"} key={k} aria-label={name}><h3>{name}<span>0</span></h3></section>)}</div>
    </div>;
  }

  const cards = liveCards(data.cards);
  const byCol = (col: BoardCol) => cards.filter(c => statusToColumn(str(c.status)) === col);
  const find = (id: string) => data.cards.find(c => str(c.id) === id);

  const move = (card: Row, col: BoardCol, message?: string) => {
    setMenu(null);
    void act(() => engine.request("canopy.cards.move", { id: card.id, status: columnToStatus(col), expectedUpdatedAt: card.updatedAt }), message ?? `Moved to ${colName(col)}.`);
  };
  const specify = (card: Row) => {
    setMenu(null);
    void act(() => engine.request("canopy.cards.specify", { id: card.id, title: tidyTitle(str(card.title)), summary: "Made clear from the board." }), "Made clear and moved to To do.");
  };
  const sendBack = (card: Row) => {
    const note = ask.trim();
    if (!note) return;
    setAsking(""); setAsk("");
    void act(async () => {
      await engine.request("canopy.cards.comment", { id: card.id, body: note });
      await engine.request("canopy.cards.move", { id: card.id, status: "running", expectedUpdatedAt: card.updatedAt });
    }, "Sent back with your note.");
  };

  const onDrop = (e: DragEvent<HTMLElement>, col: BoardCol) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const card = find(id);
    if (card && statusToColumn(str(card.status)) !== col) move(card, col);
  };

  return <div className="au-tab">
    <div className="au-board-h">
      <button type="button" className="btn sm" disabled title={shownWhy(INTAKE)}>Bring in issues</button>
      <p className="au-hint">Work that takes more than one sitting. Trunks move their own cards; drag one to move it yourself.</p>
    </div>
    {!cards.length ? <div className="au-banner" role="status"><span className="au-grow"><small>No cards yet. Cards are made from conversations, scheduled work, or by hand in Canopy.</small></span>
      <button type="button" className="btn sm" onClick={() => openCanopyCards(openPlace)}>Open Canopy</button></div> : null}
    <div className="au-board" role="list">
      {BOARD_COLUMNS.map(([col, name]) => {
        const list = byCol(col);
        return <section className={`au-col${col === "stuck" ? " stuck" : ""}${over === col ? " over" : ""}`} key={col} aria-label={name}
          onDragOver={e => { e.preventDefault(); setOver(col); }} onDragLeave={() => setOver(cur => cur === col ? null : cur)} onDrop={e => onDrop(e, col)}>
          <h3>{name}<span>{list.length}</span></h3>
          {list.length ? list.map(card => {
            const id = str(card.id), title = str(card.title), agent = str(card.agentId);
            const stuck = col === "stuck" ? whyOf(card, data.cards) : null;
            const note = str(card.notes).split("\n")[0];
            return <div key={id} className="au-bcard" role="listitem" tabIndex={0} draggable={write} data-card={id}
              aria-label={title}
              onClick={() => openCard(id)}
              onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(id); } }}
              onDragStart={e => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; (e.currentTarget as HTMLElement).classList.add("dragging"); }}
              onDragEnd={e => { (e.currentTarget as HTMLElement).classList.remove("dragging"); setOver(null); }}>
              <b>{title}</b>
              {stuck ? <Pill tone={BLOCK[stuck.why][0]} tip={stuck.detail || undefined}>{BLOCK[stuck.why][1]}</Pill> : null}
              {col === "sort" ? <span className="au-blane"><button type="button" className="btn sm" disabled={!write} onClick={e => { e.stopPropagation(); specify(card); }}>Make it clear</button></span> : null}
              {col === "check" ? (asking === id
                ? <form className="au-bask" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); sendBack(card); }}>
                    <input className="inp" value={ask} autoFocus placeholder="What should change?" aria-label="What should change?" autoComplete="off" onChange={e => setAsk(e.target.value)} />
                    <button className="btn pri sm" type="submit" disabled={!write}>Send back</button>
                  </form>
                : <span className="au-blane">
                    <button type="button" className="btn pri sm" disabled={!write} onClick={e => { e.stopPropagation(); move(card, "done", "Done."); }}>Looks good</button>
                    <button type="button" className="btn sm" disabled={!write} onClick={e => { e.stopPropagation(); setAsking(id); setAsk(""); }}>Ask for changes</button>
                  </span>) : null}
              <span className="au-bfoot">{agent ? <TrunkFace name={trunkName(data, agent)} size={18} /> : <Nobody size={18} />}
                <small>{note || statusName(str(card.status))}</small></span>
              <button type="button" className="au-bmore" aria-label={`More for “${title}”`} aria-haspopup="menu" aria-expanded={menu?.cardId === id}
                disabled={!write} onClick={e => { e.stopPropagation(); setMenu({ cardId: id, at: anchorOf(e.currentTarget, true) }); }}>
                <Icon name="more" />
              </button>
            </div>;
          }) : <p className="au-col-empty">Nothing here</p>}
        </section>;
      })}
    </div>
    {menu ? (() => {
      const card = find(menu.cardId);
      const current = card ? statusToColumn(str(card.status)) : null;
      return <ChoiceMenu at={menu.at} label="Move to" head="Move to" radio onClose={() => setMenu(null)}
        options={BOARD_COLUMNS.map(([col, name]) => ({ id: col, label: name, checked: current === col }))}
        onPick={id => { if (card) move(card, id as BoardCol); }}
        foot={<>
          {current === "sort" && card ? <button type="button" className="mi" onClick={() => specify(card)}><span className="cn-mi-t">Make it clear</span></button> : null}
          <button type="button" className="mi" disabled title={shownWhy(SPLIT_WHY)}><span className="cn-mi-t">Split into smaller cards…</span></button>
          {current === "stuck" ? <button type="button" className="mi" disabled title={shownWhy(STUCK_WHY)}><span className="cn-mi-t">Why it’s stuck…</span></button> : null}
        </>} />;
    })() : null}
  </div>;
}

// Overview cards for teammates made from a starter template (board card #463, first-run contract on #820):
// what each one does, when it runs next, and Start / Open / Stop. Start is the owner's tap that turns the
// paused routines on; nothing runs before it. Reads trunks.template.cards; an engine without it shows nothing.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Face } from "../../face/Face";
import { notify } from "../../shell/notify";
import { errorMessage, record, records, text } from "./engine";
import { cardStatus, teammateCard, type TeammateCard } from "./teammates";

export function NewTeammates({ engine, mainKey, openConversation }: { engine: WindowEngine; mainKey: string; openConversation: (key: string) => void }) {
  const [cards, setCards] = useState<TeammateCard[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let live = true;
    engine.request("trunks.template.cards", {}).then(
      value => { if (live) setCards(records(record(value).cards).map(teammateCard).filter(card => card.agentId)); },
      () => { if (live) setCards([]); },
    );
    return () => { live = false; };
  }, [engine]);
  const act = async (card: TeammateCard, start: boolean) => {
    setBusy(card.agentId);
    try {
      const value = record(await engine.request(start ? "trunks.template.start" : "trunks.template.stop", { agentId: card.agentId }));
      const next = teammateCard(value.card);
      setCards(list => list.map(row => row.agentId === card.agentId ? { ...row, ...next, name: row.name } : row));
      for (const warning of Array.isArray(value.warnings) ? value.warnings : []) notify(text(warning), { tone: "bad" });
    } catch (error) {
      notify((start ? "Couldn't start " : "Couldn't stop ") + card.name + ": " + errorMessage(error), { tone: "bad" });
    } finally {
      setBusy("");
    }
  };
  if (!cards.length) return null;
  return <section className="ov-tile ov-teammates" aria-label="New teammates">
    <div className="ov-tile-h"><h2>New teammates</h2></div>
    {cards.map(card => <div key={card.agentId} className="ov-mate">
      <Face size={34} label={card.name} />
      <span className="ov-grow"><b>{card.name}</b><small>{card.summary}</small><small className={card.started ? "ov-mate-on" : "ov-mate-off"}>{cardStatus(card)}</small></span>
      <span className="ov-acts">
        {card.started ? null : <button type="button" className="btn pri sm" disabled={busy === card.agentId} onClick={() => void act(card, true)}>Start</button>}
        <button type="button" className="btn sm" onClick={() => openConversation("agent:" + card.agentId + ":" + mainKey)}>Open</button>
        {card.started ? <button type="button" className="btn ghost sm" disabled={busy === card.agentId} onClick={() => void act(card, false)}>Stop</button> : null}
      </span>
    </div>)}
  </section>;
}

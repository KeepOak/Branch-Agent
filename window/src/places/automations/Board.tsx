// Automations › Board, the Orchard (§4.6.3.5, preview p40-auto-other): six columns. The engine has no Orchard
// store yet, so the columns are drawn empty and the controls are greyed with that reason; Canopy's own cards
// (the canopy plugin's nine statuses) live in Canopy.
import type { PlaceId } from "../../places-nav/routes";
import { Glyph } from "./glyphs";

export const ORCHARD_COLUMNS = ["To sort", "To do", "Doing", "To check", "Done", "Stuck"];
export const ORCHARD_NEEDS = "Needs the engine’s Orchard board store.";

/** Opens Canopy on its Cards tab (places listen for "branch:place-tab"). */
export function openCanopyCards(openPlace: (place: PlaceId) => void) {
  openPlace("canopy");
  setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Cards" } })), 0);
}

export function BoardTab({ openPlace }: { openPlace: (place: PlaceId) => void }) {
  return <div className="au-tab">
    <div className="au-board-h"><button type="button" className="btn sm" disabled title={ORCHARD_NEEDS}>Bring in issues</button><p className="au-hint">Work that takes more than one sitting. Trunks move their own cards; drag one to move it yourself.</p></div>
    <div className="au-banner" role="status"><Glyph name="board" /><span className="au-grow"><small>{ORCHARD_NEEDS} Cards your Trunks work on today are in Canopy.</small></span><button type="button" className="btn sm" onClick={() => openCanopyCards(openPlace)}>Open Canopy</button></div>
    <div className="au-board">{ORCHARD_COLUMNS.map(c => <section className={c === "Stuck" ? "au-col stuck" : "au-col"} key={c} aria-label={c}><h3>{c}<span>0</span></h3></section>)}</div>
  </div>;
}

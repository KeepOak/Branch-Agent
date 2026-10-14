// Settings › Appearance: What's shown's status symbols, the bug-report row, and the Make it yours card, as the preview draws
// them (preview.html "Share your look" 45339, "Pictures around Branch" 46124, "Status symbols" 40998, "Seeing more" 32594).
// Rows that open somewhere else are local; the ones Branch can't do yet are Coming in place, each naming what it waits for
// (#1049).
import { Coming } from "../../../glass/coming";
import type { SlotControlProps } from "../slots";

/** The six symbols in the bar at the bottom, with their words (preview glyphSheetT5). */
export const STATUS_SYMBOLS: readonly (readonly [string, string])[] = [
  ["This computer", "The computer Branch runs on. The dot is green when connected, amber while reconnecting, red when down."],
  ["Gateway", "The connection your apps and phone use. The link pulses while it’s connected."],
  ["Room left", "How much room this conversation has left, with the number beside it."],
  ["Running", "Jobs running now, with the count beside it. The ring turns while they run."],
  ["Usage", "How much of your plan is used. Hover to show the line, click for every account."],
  ["Branch version", "Branch’s own version. Updates apply in place."],
];

export function StatusSymbols() {
  return <div className="r1s-symbols" role="list" aria-label="Status symbols">
    <small className="g-label" data-lines>Branch’s own symbols in the bar at the bottom.</small>
    {STATUS_SYMBOLS.map(([name, what]) => <div key={name} role="listitem" className="r1s-symbol"><b className="g-label">{name}</b><small className="g-label" data-lines>{what}</small></div>)}
  </div>;
}

/** Buttons for something Branch can't do yet: greyed in place, with one plain reason and the call it waits for. */
function Later({ labels, need, reason, where }: { labels: string[]; need: string; reason: string; where: string }) {
  return <span className="r1s-own-ctl">{labels.map((label) => (
    <Coming key={label} need={need} unwired reason={reason} where={where + " › " + label}><button type="button" className="r1s-btn">{label}</button></Coming>
  ))}</span>;
}

export const YOURS_COMING = {
  report: "Making a report comes in a later update.",
  pet: "Sharing your pet as a seed comes in a later update.",
  theme: "Sharing your theme as a seed comes in a later update.",
  overview: "Changing the Overview background comes in a later update.",
  ownPet: "A pet of your own comes in a later update.",
} as const;

export const ReportBug = () => <Later labels={["Make a report"]} need="diagnostics.export" reason={YOURS_COMING.report} where="Report for a bug" />;
export const YourPet = () => <Later labels={["Copy seed", "Download"]} need="window: a pet seed with its sprite and frames" reason={YOURS_COMING.pet} where="Your pet" />;
export const YourTheme = () => <Later labels={["Copy seed", "Download"]} need="window: a theme and background seed" reason={YOURS_COMING.theme} where="This theme and background" />;
export const OverviewBackground = () => <Later labels={["Change…"]} need="window: a picture picker for Overview" reason={YOURS_COMING.overview} where="Overview background" />;
export const OwnPet = () => <Later labels={["Make one with an agent…", "Upload a sprite…"]} need="window: a pet sprite of your own" reason={YOURS_COMING.ownPet} where="A pet of your own" />;

/** Got a seed? Seedbank's own Paste a seed. */
export function PasteSeed({ onPage }: SlotControlProps) {
  return <button type="button" className="r1s-btn" data-local="" onClick={() => onPage?.("seedbank")}>Paste a seed</button>;
}
/** Your picture is chosen on Your card. */
export function YourPicture({ onPage }: SlotControlProps) {
  return <button type="button" className="r1s-btn" data-local="" onClick={() => onPage?.("card")}>Choose…</button>;
}
/** Chat background is Behind the glass, in the Background card on this page. */
export function ChatBackground() {
  return <button type="button" className="r1s-btn" data-local="" onClick={() => {
    const row = document.getElementById("row-appearance.background.behind");
    row?.scrollIntoView?.({ block: "center" });
    row?.querySelector<HTMLElement>("button, select")?.focus();
  }}>Change…</button>;
}
/** Trunk, group and topic pictures are changed on each Trunk. */
export function TrunkPictures({ onPage }: SlotControlProps) {
  return <button type="button" className="r1s-btn" data-local="" onClick={() => onPage?.("trunks")}>Trunks…</button>;
}

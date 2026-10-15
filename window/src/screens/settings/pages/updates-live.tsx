// Settings › Updates & about: Classic Updates' sections inside the R1 cards (spec-rows ClassicBlock), the achievements
// badges, and the preview's Shortcuts, guide & apps buttons, each doing what the same entry does elsewhere in the window.
import { useState } from "react";
import { AchievementsBlock } from "../../../places/settings/set2/achievements";
import { UpdatesBlock } from "../../../places/settings/set2/updates";
import { ShortcutsDialog } from "../../../shell/ShortcutsDialog";
import { QUICK_ASK_EVENT } from "../../quickask/QuickAskHost";
import { FIND_ANYTHING_EVENT } from "../../find/find-event";
import { Coming } from "../../../glass/coming";
import type { SlotControlProps } from "../slots";
import { ClassicBlock } from "./spec-rows";

type Part = Parameters<typeof UpdatesBlock>[0]["part"];
const part = (p: Part) => (props: SlotControlProps) => <ClassicBlock {...props} draw={(c) => <UpdatesBlock {...c.props} part={p} />} />;
export const Updating = part("updating");
export const Devices = part("devices");
export const Before = part("before");
export const Reports = part("reports");
export const Editors = part("editors");
export const About = part("about");
export const Privacy = part("privacy");
export const Remove = part("remove");
export const Badges = (props: SlotControlProps) => <ClassicBlock {...props} draw={() => <AchievementsBlock />} />;

/** The R1 window opens the welcome tour on this event (R1Window). */
export const TOUR_EVENT = "branch:welcome-tour";

/** Keyboard shortcuts, Guide, Show the welcome tour, Get the apps, Find anything, Collapse the list to faces, Quick ask. */
export function ShortcutButtons({ engine }: SlotControlProps) {
  const [keys, setKeys] = useState(false);
  // A jump button scrolls its section into view; the marker tells the crawl that the scroll is the result.
  const btn = (label: string, run: () => void, kbd?: string, jump = false) => (
    <button type="button" className="r1s-btn" onClick={run} data-jump-to={jump ? "" : undefined}>{label}{kbd ? <kbd className="g-label"> {kbd}</kbd> : null}</button>
  );
  return <span className="r1s-own-ctl r1s-acts" data-local="">
    {btn("Keyboard shortcuts", () => setKeys(true), "?")}
    <Coming engine={engine} need="window: the guide to why each thing is here" unwired reason="Guide: why each thing is here comes in a later update." where="Guide: why each thing is here">
      <button type="button" className="r1s-btn" disabled>Guide: why each thing is here</button>
    </Coming>
    {btn("Show the welcome tour", () => window.dispatchEvent(new CustomEvent(TOUR_EVENT)))}
    {btn("Get the apps", () => document.getElementById("sec-updates-Branch on your other devices")?.scrollIntoView({ block: "start" }), undefined, true)}
    {btn("Find anything", () => window.dispatchEvent(new CustomEvent(FIND_ANYTHING_EVENT)), "Ctrl K")}
    {btn("Collapse the list to faces", () => document.querySelector<HTMLButtonElement>(".r1-side-top button")?.click(), "Ctrl B")}
    {btn("Quick ask", () => window.dispatchEvent(new CustomEvent(QUICK_ASK_EVENT)))}
    {keys ? <ShortcutsDialog onClose={() => setKeys(false)} /> : null}
  </span>;
}

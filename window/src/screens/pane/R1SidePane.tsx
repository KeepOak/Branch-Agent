import type { WindowEngine } from "../../connect/engine";
import { availability } from "../../connect/capabilities";
import type { Block } from "../../thread/model";
import { useProgressCard } from "../../thread/PlanCard";
import { SidePane, type PaneTab } from "../../stage/SidePane";
import { Coming } from "../../glass/coming";
import "./r1-side-pane.css";

/**
 * The engine call each side panel tab reads first (R1-10). Timeline draws the conversation this window already has,
 * so it needs nothing more. A tab whose call this engine doesn't offer shows a Coming row instead of its view.
 */
export const PANE_TAB_NEEDS: Readonly<Record<PaneTab, readonly string[]>> = {
  Activity: ["sessions.list"],
  Dashboard: ["board.get"],
  Preview: ["portal.list"],
  Timeline: [],
  Branches: ["sessions.branches.list"],
  Plan: ["progressCard.get"],
  Files: ["sessions.files.list"],
  Memory: ["memory.search"],
  Terminal: ["terminal.open"],
  "Side chat": ["sessions.companion.ask"],
  Changes: ["sessions.diff"],
  Conversations: ["sessions.list"],
};

/**
 * The side panel's fixed tabs in R1, in the preview's order (preview.html §4.5.8, PT_PC18 and paneTabsPC18): Activity, Dashboard,
 * Preview (only with a preview server), Timeline, Branches (only with two or more paths), Plan, Files, Memory, Terminal. The "+"
 * adds Side chat and Changes (Advanced and up) and the Coming tabs, and an added tab stays in the conversation's row.
 * Computer and Browser open full size from the header, not as tabs.
 */
export const R1_PANE_TABS: readonly PaneTab[] = ["Activity", "Dashboard", "Preview", "Timeline", "Branches", "Plan", "Files", "Memory", "Terminal"];

/** The one-line reason a tab shows when this engine can't fill it. */
export const paneComingReason = (tab: PaneTab) => `This engine can’t show ${tab === "Side chat" ? "a side chat" : tab}.`;

/** True when this engine is known to lack a call the tab needs; before the first hello every tab draws as it is. */
export function paneTabComing(engine: Pick<WindowEngine, "features">, tab: PaneTab): boolean {
  return PANE_TAB_NEEDS[tab].some(method => availability(engine, method) === "no");
}

type Props = { engine: WindowEngine; name: string; title: string; blocks: Block[]; running: boolean; tab: PaneTab; onTab: (tab: PaneTab) => void; onClose: () => void; toast: (message: string) => void; onReload: () => void };

/**
 * The Classic side panel and every one of its tabs, re-hosted unchanged inside the R1 frame (parity row 2). Only this
 * wrapper is R1: a clear glass column beside the conversation (README item 48), whose controls sit on frosted pills.
 */
export function R1SidePane({ engine, name, title, blocks, running, tab, onTab, onClose, toast, onReload }: Props) {
  const progress = useProgressCard(engine);
  const gate = (shown: PaneTab) => paneTabComing(engine, shown) ? <div className="r1-pane-coming" data-tab={shown}>
    <Coming engine={engine} need={PANE_TAB_NEEDS[shown]} reason={paneComingReason(shown)} where={`Side panel · ${shown}`}>
      <button type="button" aria-label={`${shown} · Coming`}>{shown}</button>
    </Coming>
    <p className="g-label">{paneComingReason(shown)}</p>
  </div> : null;
  return <div className="r1-pane g-clear" data-tab={tab} data-need={PANE_TAB_NEEDS.Activity.join(" ")}>
    <SidePane engine={engine} name={name} title={title} blocks={blocks} running={running} card={progress.card} cardError={progress.error} tab={tab}
      onTab={onTab} onClose={onClose} toast={toast} onReload={onReload} gate={gate} fixed={R1_PANE_TABS} />
  </div>;
}

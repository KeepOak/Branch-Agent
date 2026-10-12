import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import type { ProgressCard } from "../thread/PlanCard";
import { ThreadContext } from "../thread/context";
import { Menu, type MenuAnchor, type MenuItem } from "../shell/Menu";
import { readLevel } from "../places-nav/SettingsFrame";
import { planSteps } from "./computers";
import { SIcon } from "./stage-icons";
import { ActivityTab } from "./pane/ActivityTab";
import { BranchesTab, PlanTab, TimelineTab, usePaths } from "./pane/TimelineTab";
import { FilesTab } from "./pane/FilesTab";
import { MemoryTab, TerminalTab } from "./pane/MemoryTerminal";
import { SideChatTab } from "./pane/SideChatTab";
import { DashboardTab } from "./pane/DashboardTab";
import { fitTabs, MORE_TAB_WIDTH } from "./pane/tab-fit";
import { PreviewTab, usePortals } from "./pane/PreviewTab";
import { ChangesTab } from "./coding/ChangesTab";
import { ContactTopicsPane } from "../shell/ContactTopicsPane";
import type { TopicListItem } from "../shell/contact-topics";
import "./stage.css";
import "./pane/pane.css";

/** Preview §4.5.8 / paneTabsPC18 order, then Conversations only when that tab is open. */
export const PANE_TABS = ["Activity", "Dashboard", "Preview", "Timeline", "Branches", "Plan", "Files", "Memory", "Terminal", "Side chat", "Changes", "Conversations"] as const;
export type PaneTab = (typeof PANE_TABS)[number];
/** Preview S.paneW, --pane-w and double-click reset (design/spec-v23). */
export const DEFAULT_PANE_WIDTH = 352;
/** Later preview drag floor (Math.max(240, ...)); the layout dialog's 280 is stricter. */
export const MIN_PANE_WIDTH = 240;
/** Preview Ctrl+Shift+K and the Activity header button open this tab. */
export const DEFAULT_PANE_TAB: PaneTab = "Activity";
const ADDABLE: PaneTab[] = ["Side chat", "Changes"];
const NOT_HERE = "This window can't show it yet.";
const LATER_TABS = ["Review", "Reader", "Discussion", "Clearing"];

type Placement = "right" | "left" | "below";
type Prefs = { width: number; placement: Placement; swap: boolean; min: boolean };
const PREFS_KEY = "branch.sidePane";
const DEFAULT_PREFS: Prefs = { width: DEFAULT_PANE_WIDTH, placement: "right", swap: false, min: false };

function readPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    const next = { ...DEFAULT_PREFS, ...(v && typeof v === "object" ? v : {}) };
    const width = typeof next.width === "number" && Number.isFinite(next.width) ? Math.max(MIN_PANE_WIDTH, next.width) : DEFAULT_PANE_WIDTH;
    return { ...next, width };
  } catch {
    return DEFAULT_PREFS; // storage blocked: the usual size and place
  }
}
function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // storage blocked: the layout lasts for this window only
  }
}

/** The pane's left edge: drag to resize (240 px to most of the window), double-click for the usual size. */
function PaneResizer({ width, below, onWidth }: { width: number; below: boolean; onWidth: (w: number) => void }) {
  const start = useRef<{ x: number; y: number; w: number } | null>(null);
  return (
    <div
      className="resizer pane-resizer-pn"
      role="separator"
      aria-orientation={below ? "horizontal" : "vertical"}
      aria-label="Drag to resize · double-click to reset"
      title="Drag to resize · double-click to reset"
      style={{ cursor: below ? "row-resize" : "col-resize" }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, w: width };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const delta = below ? s.y - e.clientY : s.x - e.clientX;
        onWidth(Math.round(Math.max(below ? 160 : MIN_PANE_WIDTH, Math.min(s.w + delta, (below ? innerHeight : innerWidth) * 0.7))));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onDoubleClick={() => onWidth(below ? 300 : DEFAULT_PREFS.width)}
    >
      <i className="grip" aria-hidden="true" />
    </div>
  );
}

type Props = {
  engine: WindowEngine;
  name: string;
  blocks: Block[];
  running: boolean;
  card: ProgressCard | null;
  cardError: string;
  tab: PaneTab;
  focusHelpers?: number;
  onTab: (tab: PaneTab) => void;
  onClose: () => void;
  toast: (message: string) => void;
  /** The conversation's title, for the Timeline header. */
  title?: string;
  /** Reads the conversation again after switching paths. */
  onReload?: () => void;
  contactTopics?: { items: TopicListItem[]; name: string; onOpen: (key: string) => void };
};

/** The side panel: its tabs, + Add a tab, Focus, Minimize, Layout and a resizer, over each tab's engine data. */
export function SidePane({ engine, name, blocks, running, card, cardError, tab, focusHelpers, onTab, onClose, toast, title, onReload, contactTopics }: Props) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [focus, setFocus] = useState(false);
  const [menu, setMenu] = useState<{ at: MenuAnchor; items: MenuItem[]; label: string } | null>(null);
  // The tab row: its width, each tab's measured width, and a re-render when a width changes (see tab-fit.ts).
  const [rowWidth, setRowWidth] = useState(0);
  const [, measured] = useReducer((n: number) => n + 1, 0);
  const tabWidths = useRef<Record<string, number>>({});
  const tabRow = useRef<HTMLDivElement>(null);
  const [added, setAdded] = useState<PaneTab[]>(tab === "Side chat" ? ["Side chat"] : []);
  const [error, setError] = useState("");
  const [pathTick, setPathTick] = useState(0);
  const paths = usePaths(engine, pathTick + blocks.length);
  const previews = usePortals(engine);
  const level = readLevel();
  const set = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  useEffect(() => {
    if (ADDABLE.includes(tab) && !added.includes(tab)) setAdded((a) => [...a, tab]);
  }, [tab, added]);
  const head = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    // Watch the tab row's width; the tabs that no longer fit move into More.
    const row = tabRow.current;
    if (!row) return;
    const read = () => setRowWidth(row.clientWidth);
    read();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(read);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    // Measure every tab that is on the row now; a tab that moved to More keeps its last width.
    let changed = false;
    tabRow.current?.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => {
      const name = el.dataset.tab ?? "";
      if (el.offsetWidth && tabWidths.current[name] !== el.offsetWidth) {
        tabWidths.current[name] = el.offsetWidth;
        changed = true;
      }
    });
    if (changed) measured();
  });
  useEffect(() => {
    // The tab row scrolls sideways; keep the open tab in view.
    head.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tab]);
  const tabs = PANE_TABS.filter((t) =>
    t === "Conversations" ? Boolean(contactTopics) && tab === "Conversations" : t === "Branches" ? paths.length >= 2 || tab === "Branches" : t === "Preview" ? previews.portals.length > 0 || tab === "Preview" : ADDABLE.includes(t) ? added.includes(t) : true,
  );
  const current = tabs.includes(tab) ? tab : DEFAULT_PANE_TAB;
  const fit = fitTabs(tabs, tabWidths.current, rowWidth, current);
  const fail = (m: string) => {
    setError(m);
    toast(m);
  };
  const addMenu = (at: MenuAnchor) =>
    setMenu({
      at,
      label: "Add a tab",
      items: [
        { kind: "head", label: "Add a tab" },
        ...ADDABLE.filter((t) => !added.includes(t) && (t !== "Changes" || level !== "regular")).map((t): MenuItem => ({ label: t, run: () => { setAdded((a) => [...a, t]); onTab(t); } })),
        ...LATER_TABS.map((t): MenuItem => ({ label: t, run: () => undefined, disabled: NOT_HERE })),
      ],
    });
  const layoutMenu = (at: MenuAnchor) =>
    setMenu({
      at,
      label: "Layout",
      items: [
        { kind: "head", label: "Layout" },
        ...(["right", "left", "below"] as const).map((p): MenuItem => ({ label: `${prefs.placement === p ? "✓ " : ""}${p[0]!.toUpperCase()}${p.slice(1)}`, run: () => set({ placement: p, swap: false }) })),
        { kind: "sep" },
        { label: prefs.swap ? "Put the conversation back" : "Swap with the conversation", run: () => set({ swap: !prefs.swap }) },
      ],
    });
  const below = prefs.placement === "below";
  const cls = ["conversation-pane", "pane-pn", `at-${prefs.placement}`, prefs.swap ? "swap" : "", focus ? "focus" : "", prefs.min ? "min" : ""].filter(Boolean).join(" ");
  const style = (below
    ? { "--pane-h": `${prefs.width < 160 ? 300 : Math.min(prefs.width, 600)}px` }
    : { "--pane-w": `${prefs.width}px`, minWidth: prefs.width }) as unknown as CSSProperties;
  const steps = planSteps(card);
  const at = (e: React.MouseEvent<HTMLElement>, right = false): MenuAnchor => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: right ? r.right - 220 : r.left, y: r.bottom + 6 };
  };
  return (
    <ThreadContext.Provider value={{ engine, sessionKey: engine.sessionKey, name, toast, running }}>
      <aside className={cls} style={style} aria-label="Side panel">
        {!focus && !prefs.min ? <PaneResizer width={prefs.width} below={below} onWidth={(w) => set({ width: w })} /> : null}
        <header className="pane-head pane-h-pn" ref={head}>
          <div className="pane-tabs" role="tablist" aria-label="Side panel views" ref={tabRow}>
            {fit.visible.map((t) => (
              <span key={t} className="ptab-wrap-pn" data-tab={t}>
                <button
                  role="tab"
                  type="button"
                  className="ptab-pn"
                  aria-selected={t === current}
                  tabIndex={t === current ? 0 : -1}
                  onClick={() => {
                    onTab(t);
                    if (prefs.min) set({ min: false });
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    const row = fit.visible;
                    const next = row[(row.indexOf(current) + (e.key === "ArrowRight" ? 1 : row.length - 1)) % row.length]!;
                    onTab(next);
                    (e.currentTarget.closest("[role=tablist]")?.querySelectorAll<HTMLElement>("[role=tab]")[row.indexOf(next)])?.focus();
                  }}
                >
                  {t}
                </button>
                {ADDABLE.includes(t) ? (
                  <button type="button" className="ptab-x-pn" aria-label={`Close the ${t} tab`} onClick={() => { setAdded((a) => a.filter((x) => x !== t)); if (t === current) onTab(DEFAULT_PANE_TAB); }}>
                    <SIcon name="x" small />
                  </button>
                ) : null}
              </span>
            ))}
            {fit.overflow.length ? (
              <span className="ptab-wrap-pn">
                <button
                  type="button"
                  className="ptab-pn ptab-more-pn"
                  aria-haspopup="menu"
                  aria-label="More tabs"
                  title="More tabs"
                  style={{ minWidth: MORE_TAB_WIDTH }}
                  onClick={(e) => setMenu({ at: at(e), label: "More tabs", items: fit.overflow.map((t): MenuItem => ({ label: t, run: () => onTab(t) })) })}
                >
                  More
                </button>
              </span>
            ) : null}
          </div>
          <button type="button" className="ib" aria-haspopup="menu" aria-label="Add a tab" title="Add a tab" onClick={(e) => addMenu(at(e, true))}>
            <SIcon name="plus" small />
          </button>
          <button type="button" className="ib" aria-pressed={focus} aria-label="Focus" title="Focus" onClick={() => setFocus((v) => !v)}>
            <SIcon name="expand" small />
          </button>
          <button type="button" className="ib" aria-pressed={prefs.min} aria-label="Minimize" title="Minimize" onClick={() => set({ min: !prefs.min })}>
            <SIcon name="minimize" small />
          </button>
          <button type="button" className="ib" aria-haspopup="menu" aria-label="Panel layout" title="Panel layout" onClick={(e) => layoutMenu(at(e, true))}>
            <SIcon name="layout" small />
          </button>
          <button type="button" className="ib" aria-label="Close the side panel" title="Close · Ctrl Shift K" onClick={onClose}>
            <SIcon name="x" small />
          </button>
        </header>
        {(
          <div className="pane-body pane-b-pn" role="tabpanel" aria-label={current}>
            {error ? (
              <p className="err-st" role="alert">
                {error}
              </p>
            ) : null}
            {current === "Activity" ? <ActivityTab engine={engine} name={name} blocks={blocks} running={running} level={level} focusHelpers={focusHelpers} onError={fail} /> : null}
            {current === "Conversations" && contactTopics ? <ContactTopicsPane {...contactTopics} /> : null}
            {current === "Dashboard" ? <DashboardTab engine={engine} name={name} level={level} /> : null}
            {current === "Preview" ? <PreviewTab engine={engine} name={name} portals={previews.portals} error={previews.error} onError={fail} toast={toast} /> : null}
            {current === "Timeline" ? <TimelineTab name={name} title={title || name} blocks={blocks} running={running} level={level} /> : null}
            {current === "Branches" ? <BranchesTab engine={engine} paths={paths} onSwitched={() => { setPathTick((t) => t + 1); onReload?.(); }} onError={fail} /> : null}
            {current === "Plan" ? <PlanTab steps={steps} error={cardError} /> : null}
            {current === "Files" ? <FilesTab key={engine.sessionKey} engine={engine} /> : null}
            {current === "Memory" ? <MemoryTab engine={engine} blocks={blocks} name={name} /> : null}
            {current === "Side chat" ? <SideChatTab engine={engine} name={name} /> : null}
            {current === "Changes" ? <ChangesTab engine={engine} /> : null}
            {/* The terminal stays mounted while the pane is open so a shell you opened keeps its output. */}
            <div hidden={current !== "Terminal"} className="pane-keep-pn">
              <TerminalTab engine={engine} blocks={blocks} name={name} onError={fail} />
            </div>
          </div>
        )}
        {menu ? <Menu at={menu.at} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}
      </aside>
    </ThreadContext.Provider>
  );
}

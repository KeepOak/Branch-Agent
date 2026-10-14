import { Component, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLayer } from "../../glass/Popover";
import { useEdgeFade } from "../../glass/useEdgeFade";
import { shortcutFor } from "../../shell/use-shortcuts";
import { Icon } from "../../shell/icons";
import { Header, type HeaderProps } from "./Header";
import { useFreeDrag, type Edge } from "./free-drag";
import { getFree, setFree, sideNow, sideTier, toggleRail, topicsTier } from "./free-widths";
import "../../glass/glass.css";
import "./frame.css";

class Region extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="r1-notice g-label" role="alert">This part didn’t load · <button type="button" data-local="" onClick={() => this.setState({ failed: false })}>Try again</button></p> : this.props.children; }
}
export type FrameProps = {
  sidebar: ReactNode; main: ReactNode; composer?: ReactNode; topics?: ReactNode; notice?: ReactNode;
  /** The side panel beside the conversation (parity row 2); none while it is closed. */
  pane?: ReactNode;
  header: Omit<HeaderProps, "onToggleSidebar">; navigationKey?: string; onShortcut?: (action: "settings" | "nextConversation" | "palette" | "focusSearch") => void;
  /** A pane beside the page (Talk beside), docked at the right or the bottom of the conversation column; size in px. */
  beside?: { node: ReactNode; dock: "right" | "bottom"; size: number };
  /** Freedom Mode (owner item 6): the sidebar and the threads column resize freely. Needs the threads column to show. */
  freeLayout?: boolean;
};
/** jsdom and some embedded webviews have no matchMedia; treat a missing query as a wide window. */
function narrowQuery(): MediaQueryList | null { return typeof matchMedia === "function" ? matchMedia("(max-width: 760px)") : null; }
function readWide() { try { return localStorage.getItem("branch.r1.sidebar") !== "rail"; } catch { return true; } }
const HANDLE_LABEL: Record<Edge, string> = {
  side: "Resize the sidebar. Drag to any size, double-click for the rail, Alt-drag resizes both.",
  topics: "Resize the threads. Drag to any size, double-click for the rail, Alt-drag resizes both.",
};
export function Frame({ sidebar, main, composer, topics, notice, pane, header, navigationKey, onShortcut, beside, freeLayout }: FrameProps) {
  const [wide, setWide] = useState(readWide), [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(() => narrowQuery()?.matches ?? false);
  const scroll = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), side = useRef<HTMLElement>(null), frame = useRef<HTMLDivElement>(null);
  const free = Boolean(freeLayout && topics && !narrow);
  const drag = useFreeDrag(frame, Boolean(topics));
  const sideW = drag.live ? drag.live.side : sideNow(drag.fs), topicsW = drag.live ? drag.live.topics : drag.fs.topics;
  const wideNow = free ? (drag.live ? drag.live.side >= 180 : !(drag.fs.sideRail || drag.fs.sideHidden)) : wide;
  const close = () => setDrawer(false);
  useLayer(drawer && narrow, close);
  useEdgeFade(scroll, content);
  useEffect(() => { const media = narrowQuery(); if (!media) return; const update = () => { setNarrow(media.matches); if (!media.matches) setDrawer(false); }; media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => { setDrawer(false); if (scroll.current) scroll.current.scrollTop = 0; }, [navigationKey]);
  useEffect(() => {
    if (!drawer || !narrow) return;
    const opener = document.activeElement as HTMLElement | null;
    (side.current?.querySelector<HTMLElement>("button:not(:disabled),input,a") ?? side.current)?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [drawer, narrow]);
  const toggle = () => {
    if (narrow) setDrawer(open => !open);
    else if (free) setFree({ ...toggleRail(getFree(), "side"), last: "side" });
    else setWide(value => { try { localStorage.setItem("branch.r1.sidebar", value ? "rail" : "wide"); } catch { /* Keep the choice in this window when storage is unavailable. */ } return !value; });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.g-popover,[aria-modal="true"]:not(.r1-sidebar)')) return;
      const typing = !!(event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (free && drag.shortcut(event, typing)) return;
      const action = shortcutFor(event, /Mac|iPhone|iPad/.test(navigator.platform));
      if (action === "toggleList") { event.preventDefault(); toggle(); }
      else if (action === "settings" || action === "nextConversation" || action === "palette" || action === "focusSearch") {
        if (onShortcut) {
          event.preventDefault();
          if (action === "palette" || action === "focusSearch") {
            if (narrow) setDrawer(true); else setWide(true);
            requestAnimationFrame(() => onShortcut(action));
          } else onShortcut(action);
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const gridStyle: CSSProperties | undefined = free ? {
    gridTemplateColumns: `${sideW}px ${topicsW}px minmax(0, 1fr)`,
    position: "relative", transition: drag.live ? "none" : undefined,
  } : undefined;
  const handle = (edge: Edge, left: number) => <div key={edge} className={`r1-free-handle${topicsW <= 0 && edge === "topics" ? " r1-free-open" : ""}`} role="separator" aria-orientation="vertical" aria-valuenow={Math.round(edge === "side" ? sideW : topicsW)} tabIndex={0} data-edge={edge}
    aria-label={topicsW <= 0 && edge === "topics" ? "Threads are closed. Drag right to open them, or press Enter." : HANDLE_LABEL[edge]} style={{ left: left - 4 }}
    onPointerDown={(event) => drag.begin(edge, event)} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.end}
    onDoubleClick={() => drag.doubleClick(edge)} onKeyDown={(event) => drag.handleKey(edge, event)} />;
  return <div ref={frame} className="r1-frame" data-wide={wideNow} data-drawer={drawer} data-topics={Boolean(topics)} data-pane={Boolean(pane)}
    data-free={free} data-side-tier={free ? sideTier(sideW) : undefined} data-topic-tier={free && topicsW > 0 ? topicsTier(topicsW) : undefined} style={gridStyle}>
    {narrow && drawer && <button className="r1-drawer-scrim" type="button" data-local="" aria-label="Hide the sidebar" onClick={close} />}
    <aside className="r1-sidebar" ref={side} aria-label="Sidebar" role={narrow ? "dialog" : undefined} aria-modal={narrow && drawer ? true : undefined} inert={narrow && !drawer} tabIndex={-1} onKeyDown={event => {
      if (!narrow || !drawer || event.key !== "Tab") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input,a,[tabindex='0']")];
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <div className="r1-side-top"><button type="button" className="g-ctl" data-local="" onClick={toggle} aria-label={narrow ? (drawer ? "Hide the sidebar" : "Show the sidebar") : wideNow ? "Collapse sidebar" : "Expand sidebar"}><Icon name="menu" /></button></div>
      <Region>{sidebar}</Region>
    </aside>
    {topics && <section className="r1-topics" aria-label="Topics" style={free ? { overflowX: "hidden", minWidth: 0 } : undefined}><Region>{topics}</Region></section>}
    <section className="r1-conversation" aria-label="Conversation" data-beside={beside?.dock} style={beside ? { ["--r1-beside" as string]: `${beside.size}px` } : undefined}>
      <Header {...header} onToggleSidebar={toggle} />
      <div className="r1-scroll edge-fade" ref={scroll}><div ref={content} className="r1-content"><Region>{notice && <div className="r1-notice g-label" role="status">{notice}</div>}{main}</Region></div></div>
      {composer && <div className="r1-composer-slot"><Region>{composer}</Region></div>}
      {beside && <div className="r1-beside"><Region>{beside.node}</Region></div>}
    </section>
    {pane && <div className="r1-pane-slot"><Region>{pane}</Region></div>}
    {free && handle("side", sideW)}
    {free && (topicsW > 0 ? handle("topics", sideW + topicsW) : handle("topics", sideW))}
  </div>;
}

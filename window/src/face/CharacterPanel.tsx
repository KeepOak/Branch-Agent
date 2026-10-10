import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Face } from "./Face";
import { STATE_LABEL, type AgentState } from "./agentState";
import { Icon } from "../shell/icons";
import { Menu, type MenuItem } from "../shell/Menu";
import { notify } from "../shell/notify";
import { AGENT_SIZE_PX, useLookPrefs } from "./look-prefs";
import { PRIORITY } from "./cap";
import { panelLimits, panelNearestCorner, panelPlaceAt, panelPlaceOnResize, panelPoint, readPanelPlace, savePanelPlace, USUAL_PLACE, type PanelBounds, type PanelPlace } from "./panel-position";

const CORNERS: { corner: "bottom-right" | "bottom-left" | "top-right" | "top-left"; label: string }[] = [
  { corner: "bottom-right", label: "Bottom right" },
  { corner: "bottom-left", label: "Bottom left" },
  { corner: "top-right", label: "Top right" },
  { corner: "top-left", label: "Top left" },
];

/** The Trunk card is the one pet on screen: its name and state, and a popover for the few things to do with it. */
export function CharacterPanel({ name, state, onClose, onShow, onOpenTrunk, onChangePet, others = [], column }: {
  name: string; state: AgentState; onClose: () => void; onShow: () => void; onOpenTrunk?: () => void; onChangePet: () => void; others?: string[]; column: HTMLElement | null;
}) {
  const { agentSize } = useLookPrefs();
  const panel = useRef<HTMLElement>(null);
  const limits = useRef<PanelBounds | null>(null);
  const place = useRef<PanelPlace>(readPanelPlace());
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const measure = useCallback(() => {
    const el = panel.current;
    if (!column || !el) return;
    const rect = column.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      limits.current = null;
      setPoint(null);
      return;
    }
    const composer = column.querySelector<HTMLElement>(".c-wrap");
    const headerBottom = Math.max(
      column.querySelector<HTMLElement>(".head-row")?.getBoundingClientRect().bottom ?? rect.top,
      document.querySelector<HTMLElement>(".focus-exit")?.getBoundingClientRect().bottom ?? rect.top,
    );
    const next = panelLimits(rect, el.offsetWidth, el.offsetHeight, composer?.getBoundingClientRect().top, headerBottom);
    if (limits.current) place.current = panelPlaceOnResize(place.current, limits.current, next);
    limits.current = next;
    column.style.setProperty("--agent-window-clearance", `${el.offsetHeight + 24}px`);
    setPoint(panelPoint(place.current, next));
  }, [column]);
  useLayoutEffect(() => {
    if (!column) return;
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    if (panel.current) observer.observe(panel.current);
    const composer = column.querySelector<HTMLElement>(".c-wrap");
    if (composer) observer.observe(composer);
    const header = column.querySelector<HTMLElement>(".head-row");
    if (header) observer.observe(header);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); column.style.removeProperty("--agent-window-clearance"); };
  }, [column, measure]);

  const moveTo = (next: PanelPlace, toast = false) => {
    place.current = next;
    savePanelPlace(next);
    if (limits.current) setPoint(panelPoint(next, limits.current));
    if (toast) notify("Back to the usual place.");
  };
  const hide = () => {
    onClose();
    notify("Hidden. Undo, or bring it back from the header.", { action: { label: "Undo", run: onShow } });
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("button, [role=menu]")) return;
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { id: e.pointerId, x: rect.left, y: rect.top, startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== e.pointerId || !limits.current) return;
    const dx = e.clientX - current.startX;
    const dy = e.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    current.moved = true;
    setDragging(true);
    setPoint(panelPoint(panelPlaceAt(current.x + dx, current.y + dy, limits.current), limits.current));
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== e.pointerId) return;
    if (current.moved && limits.current) moveTo(panelPlaceAt(current.x + e.clientX - current.startX, current.y + e.clientY - current.startY, limits.current));
    else setMenu({ x: e.clientX, y: e.clientY });
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const items: MenuItem[] = [
    { kind: "head", label: `${name} · ${STATE_LABEL[state]}` },
    ...(onOpenTrunk ? [{ label: "Open Trunk", run: onOpenTrunk, testid: "character-open" }] : []),
    { label: "Change pet…", run: onChangePet, testid: "character-change-pet" },
    { kind: "sep" },
    { kind: "sub", label: "Position", items: [
      ...CORNERS.map(({ corner, label }) => ({ label, checked: panelNearestCorner(place.current) === corner, run: () => moveTo({ corner }) })),
      { kind: "sep" },
      { label: "Back to the usual place", run: () => moveTo(USUAL_PLACE, true) },
    ] },
    { kind: "sep" },
    { label: "Hide", run: hide, testid: "character-hide" },
  ];
  return <>
    <aside ref={panel} className={`character-panel${dragging ? " dragging" : ""}`}
      aria-label={`${name}, ${STATE_LABEL[state]}`} tabIndex={0} style={point ? { left: point.x, top: point.y, right: "auto", bottom: "auto" } : { visibility: "hidden" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={(e) => { if (!(e.target as Element).closest("button")) moveTo(USUAL_PLACE, true); }}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      onKeyDown={(e) => { if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) { e.preventDefault(); const rect = panel.current?.getBoundingClientRect(); if (rect) setMenu({ x: rect.left + 12, y: rect.top + 12 }); } }}>
      <div className={others.length ? "character-panel-row" : undefined} style={others.length ? undefined : { display: "contents" }}>
        {[name, ...others].map((who, i) => {
          const st: AgentState = i === 0 ? state : "idle";
          return <div className="character-panel-body" key={who}>
            <Face size={AGENT_SIZE_PX[agentSize]} label={who} state={st} priority={i === 0 ? 300 : PRIORITY.row} />
            <div className="character-panel-label"><b>{who}</b><small><i data-state={st} />{STATE_LABEL[st]}</small></div>
          </div>;
        })}
      </div>
      <div className="character-panel-controls">
        <button className="ib sm" aria-label="Hide the character" title="Hide the character" onClick={hide}><Icon name="x" small /></button>
      </div>
    </aside>
    {menu ? <Menu at={menu} label={`${name} options`} onClose={() => setMenu(null)} items={items} testid="character-menu" /> : null}
  </>;
}

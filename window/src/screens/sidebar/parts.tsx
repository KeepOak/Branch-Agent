// The R1 sidebar's pieces (HANDOFF R1-02), ported from the preview's `sideR2`, `foldP11`, `contactsLookT5`, `renderSide`
// rows and the owner row. Layout and glass live in sidebar.css; data comes in as SideRows (model.ts). Every control here
// only opens, filters or navigates, so it says data-local (R1-10); the calls live in the menus (row-menu.ts).
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Avatar, InitialsFace } from "../../glass/Avatar";
import { GroupCluster } from "../../glass/GroupCluster";
import { Coming } from "../../glass/coming";
import { Face } from "../../face/Face";
import { useSidebarPointerDrag, type DropZone, type SidebarDrop } from "../../shell/sidebar-drag";
import { FOLDERS, folderCount, rowTime, type Folder, type SideRow } from "./model";
import { pinAxis, pinKey } from "./pin-order";

const svg = (body: ReactNode, size = 16) => <svg className="r1sb-i" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{body}</svg>;
export const icons = {
  search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></>),
  gear: svg(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>),
  grove: svg(<><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7.5v9M18 10c0 4-6 3.5-10.5 7" /></>),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  more: svg(<path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth="2.6" />, 15),
  chevron: svg(<path d="M9.5 6l6 6-6 6" />, 12),
  archive: svg(<><rect x="3.5" y="4.5" width="17" height="4" rx="1" /><path d="M5 8.5v10a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-10M10 12.5h4" /></>),
  trash: svg(<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />),
  cloud: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5" /><path d="M12 11v8M9 16l3 3 3-3" /></svg>,
  apps: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></svg>,
  term: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8l4 4-4 4M12 17h7" /></svg>,
  leaf: <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-14 14z" /><path d="M5 19l7-7" /></svg>,
  computer: svg(<><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></>),
};

const REDUCE = "(prefers-reduced-motion: reduce)";
const reduceQuery = () => typeof matchMedia === "function" ? matchMedia(REDUCE) : null;
const subscribeReduce = (change: () => void) => {
  const query = reduceQuery();
  query?.addEventListener?.("change", change);
  return () => query?.removeEventListener?.("change", change);
};
/** Reduced motion, live: the working ring keeps its arc but stops turning (preview: .av.working under reduced motion). */
export const useReducedMotion = () => useSyncExternalStore(subscribeReduce, () => Boolean(reduceQuery()?.matches), () => false);

/** The face is the status (preview `.av.working`): while the row's Trunk works, the face plays its working state inside
 *  the turning working ring (face/face.css); the row carries no spinner and no "Working" words. Reduced motion or
 *  "Keep things still" leave the arc still, so working still reads. */
export function RowFace({ row, size }: { row: SideRow; size: number }) {
  const still = useReducedMotion();
  const face = <RowFaceInner row={row} size={size} />;
  return row.working
    ? <span className="r1sb-ring working-ring" data-working="" data-still={still || undefined} style={{ width: size, height: size }}>{face}</span>
    : face;
}

/** One face per row kind: a Trunk's character, a person's initials, a Grafted agent's dashed disc, a group's cluster. */
function RowFaceInner({ row, size }: { row: SideRow; size: number }) {
  if (row.kind === "group") {
    const inner = Math.round(size * 0.58);
    const members = (row.members ?? []).map((member, index) => member.kind === "trunk"
      ? <Face key={index} size={inner} label={member.name} />
      : <span key={index} style={{ width: inner, height: inner, display: "grid" }}><InitialsFace name={member.name} /></span>);
    return <GroupCluster size={size} ring="side" members={members.length ? members : [<InitialsFace key="g" name={row.name} />]} />;
  }
  const status = row.waiting ? "waiting" : undefined;
  if (row.kind === "trunk") {
    return <Avatar size={size} ring="side" status={status} leaf={row.isDefault} face={<Face size={size} label={row.name} state={row.waiting ? "wait" : row.working ? "work" : "idle"} />} />;
  }
  return <Avatar size={size} ring="side" status={status} face={<InitialsFace name={row.name} kind={row.kind === "grafted" ? "grafted" : "person"} />} />;
}

/** onOpen gets the click, so Alt or Shift can pick the row instead of opening it (select several). */
export type RowHandlers = { onOpen: (row: SideRow, event?: MouseEvent<HTMLElement>) => void; onMenu: (row: SideRow, anchor: HTMLElement) => void };

/** A two-line row: name and time, then the preview. Hover shows only •••. */
export function SideRowView({ row, current, now, handlers, picked = false }: { row: SideRow; current: boolean; now: number; handlers: RowHandlers; picked?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null), more = useRef<HTMLButtonElement>(null);
  const menu = Boolean(row.contact);
  const time = rowTime(row.at, now);
  const label = [row.name, picked ? "selected" : "", row.unread ? "unread" : "", row.waiting ? "waiting for you" : "", row.working ? "working" : ""].filter(Boolean).join(", ");
  return <div className="r1sb-rw" ref={wrap} data-kind={row.kind} data-current={current || undefined} data-picked={picked || undefined}>
    <button type="button" className="r1sb-row" data-local="" aria-current={current ? "true" : undefined} aria-label={label} title={row.name}
      data-one={row.preview ? undefined : ""} data-offline={row.offline || undefined}
      onClick={event => handlers.onOpen(row, event)}
      onContextMenu={event => { if (!menu) return; event.preventDefault(); handlers.onMenu(row, wrap.current!); }}
      onKeyDown={event => { if (menu && event.key === "F10" && event.shiftKey) { event.preventDefault(); handlers.onMenu(row, more.current ?? wrap.current!); } }}>
      <span className="r1sb-face"><RowFace row={row} size={40} /></span>
      <b className="r1sb-name"><span>{row.name}</span>{row.kind === "person" && row.role ? <i className="r1sb-tag">{row.role}</i> : null}</b>
      <span className="r1sb-meta">{time ? <time>{time}</time> : null}{row.unread && !current ? <i className="r1sb-unread" aria-hidden="true" /> : null}</span>
      {row.preview ? <p className="r1sb-pv" data-unread={row.unread || undefined}>{row.sender ? <span className="r1sb-from">{row.sender}: </span> : null}{row.preview}</p> : null}
    </button>
    {menu ? <button type="button" className="r1sb-more" data-local="" ref={more} aria-label={`More for ${row.name}`} title="More" aria-haspopup="menu" onClick={() => handlers.onMenu(row, more.current!)}>{icons.more}</button> : null}
  </div>;
}

const PIN_ZONES: readonly DropZone[] = ["before", "after"];
const NO_ZONES: readonly DropZone[] = [];

/** The Pinned grid: a face, the name and a role chip; 2, 3 or 4 a row by the list's width (container queries). With
 *  onReorder, a tile drags to a new place (the Classic pointer drag, shell/sidebar-drag.ts); the default stays first. */
export function PinnedGrid({ rows, currentKey, handlers, onReorder }: { rows: SideRow[]; currentKey: string | null; handlers: RowHandlers; onReorder?: (drop: SidebarDrop) => void }) {
  const grid = useRef<HTMLDivElement | null>(null);
  const { ref: dragRef, ...drag } = useSidebarPointerDrag(drop => onReorder?.(drop), {
    itemAttribute: "data-pin", ignoreSelector: ".r1sb-pin-more, [data-pin-fixed]", dropZones: PIN_ZONES,
    // Read at drag time: the collapsed rail stacks the tiles in one column (sidebar.css), so before and after go by height.
    get axis() { return pinAxis(grid.current); },
    zonesFor: (_source, _target, element) => (element.hasAttribute("data-pin-fixed") ? NO_ZONES : PIN_ZONES),
    faceSelector: ".r1sb-pin-face", nameSelector: ".r1sb-pin-name",
  });
  const last = useRef(new Map<string, DOMRect>());
  // FLIP: when the column count changes, each tile glides from where it was.
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      for (const tile of node.querySelectorAll<HTMLElement>("[data-pin]")) {
        const before = last.current.get(tile.dataset.pin!), after = tile.getBoundingClientRect();
        last.current.set(tile.dataset.pin!, after);
        if (!before || (before.left === after.left && before.top === after.top) || matchMedia("(prefers-reduced-motion: reduce)").matches) continue;
        tile.animate?.([{ transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.3,1.3,.5,1)" });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div className="r1sb-pins" role="list" aria-label="Pinned" ref={node => { grid.current = node; dragRef.current = node; }} {...(onReorder ? drag : {})}>
    {rows.map(row => <PinnedTile key={row.id} row={row} current={row.key !== null && row.key === currentKey} handlers={handlers} />)}
  </div>;
}

function PinnedTile({ row, current, handlers }: { row: SideRow; current: boolean; handlers: RowHandlers }) {
  const tile = useRef<HTMLDivElement>(null), more = useRef<HTMLButtonElement>(null);
  return <div className="r1sb-pin" role="listitem" data-pin={pinKey(row)} data-pin-fixed={row.isDefault ? "" : undefined} ref={tile}>
    <button type="button" className="r1sb-pin-open" data-local="" aria-current={current ? "true" : undefined} title={row.name}
      aria-label={`${row.name}, ${row.role}${row.unread ? ", unread" : ""}${row.working ? ", working" : ""}`}
      onClick={() => handlers.onOpen(row)} onContextMenu={event => { event.preventDefault(); handlers.onMenu(row, tile.current!); }}>
      <span className="r1sb-pin-face"><RowFace row={row} size={60} />{row.unread && !current ? <i className="r1sb-pin-unread" aria-hidden="true" /> : null}</span>
      <b className="r1sb-pin-name">{row.name}</b>
      <span className="r1sb-pin-role">{row.role}</span>
    </button>
    <button type="button" className="r1sb-pin-more" data-local="" ref={more} aria-label={`More for ${row.name}`} aria-haspopup="menu" onClick={() => handlers.onMenu(row, more.current!)}>{icons.more}</button>
  </div>;
}

/** A sticky glass section head: no rule line, rows scroll under it. */
export function SectionHead({ label, children }: { label: string; children?: ReactNode }) {
  return <div className="r1sb-head"><span>{label}</span>{children}</div>;
}

/** The folder chip: one chip at rest; a click springs every folder open over glass. Hidden while searching. */
export const NEW_FOLDER_COMING = "Your own folders come in a later update.";

export function FolderChip({ rows, folder, onFolder, open, onOpen }: { rows: SideRow[]; folder: Folder; onFolder: (folder: Folder) => void; open: boolean; onOpen: (open: boolean) => void }) {
  return <div className="r1sb-fold" data-open={open || undefined} role="tablist" aria-label="Folders"
    onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); onOpen(false); } }}>
    {FOLDERS.map(item => {
      const selected = item.id === folder, count = folderCount(rows, item.id);
      return <button key={item.id} type="button" role="tab" className="r1sb-chip" data-local="" aria-selected={selected}
        tabIndex={selected || open ? 0 : -1}
        onClick={() => { if (!open) { onOpen(true); return; } onFolder(item.id); onOpen(false); }}>
        {item.label}{count && (open || selected) ? <b>{count}</b> : null}
      </button>;
    })}
    {/* Your own folders (preview foldP11 "New folder" chip): Coming here until the engine has sessions.folders.put (#1049). */}
    <Coming need="sessions.folders.put" unwired reason={NEW_FOLDER_COMING} where="Sidebar › New folder">
      <button type="button" className="r1sb-chip r1sb-chip-add" aria-label="New folder" tabIndex={open ? 0 : -1}>{svg(<path d="M12 5v14M5 12h14" />, 13)}</button>
    </Coming>
  </div>;
}

export type Capsules = { query: string; onQuery: (q: string) => void; searchRef: RefObject<HTMLInputElement | null>; onSettings: () => void; onGrove: () => void; plusRef: RefObject<HTMLButtonElement | null>; onPlus: () => void; plusDot: boolean };

/** Search, Settings, Grove and + (owner item 7). Search grows leftward on hover, focus or while it has a query. */
export function TopCapsules({ searchRef, plusRef, ...p }: Capsules) {
  const [tapOpen, setTapOpen] = useState(false);
  const pointer = useRef("mouse");
  // Owner item 7 on touch: in the rail, the first tap on + drops the capsule stack; the next tap opens the menu.
  const rail = () => Boolean(document.querySelector(".r1-frame[data-wide='false']")) && !matchMedia("(max-width: 760px)").matches;
  return <div className="r1sb-caps" data-tap={tapOpen || undefined} onPointerLeave={() => setTapOpen(false)}>
    <label className="r1sb-cap r1sb-search" data-keep={p.query ? "" : undefined} title="Search · Ctrl K">
      {icons.search}
      <input ref={searchRef} type="search" data-local="" aria-label="Search chats, Trunks, messages and past sessions" placeholder="Search" value={p.query}
        onChange={event => p.onQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape" && p.query) { event.stopPropagation(); p.onQuery(""); } }} />
      <kbd>Ctrl K</kbd>
    </label>
    <button type="button" className="r1sb-cap" data-local="" aria-label="Settings" title="Settings · Ctrl ," onClick={p.onSettings}>{icons.gear}</button>
    <button type="button" className="r1sb-cap" data-local="" aria-label="Grove" title="Grove: all your Trunks at a glance" onClick={p.onGrove}>{icons.grove}</button>
    <button type="button" className="r1sb-cap r1sb-plus" data-local="" ref={plusRef} aria-label="New, places and more" title="New, places and more" aria-haspopup="menu"
      onPointerDown={event => { pointer.current = event.pointerType; }}
      onClick={() => { if (pointer.current === "touch" && !tapOpen && rail()) { setTapOpen(true); return; } p.onPlus(); }}>
      {icons.plus}{p.plusDot ? <span className="r1sb-plus-dot" aria-hidden="true" /> : null}
    </button>
  </div>;
}

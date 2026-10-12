import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Pebble } from "../face/Pebble";
import { RoomAvatar } from "../rooms/RoomMessage";
import { RoomFaces } from "../rooms/RoomFaces";
import type { Conversation } from "../connect/conversations";
import type { PlaceId } from "../places-nav/routes";
import { ConversationRow, type RowExtras, type RowState } from "./ConversationRow";
import { Icon } from "./icons";
import { childrenOf, rowTime, shownChildren, type ListSection } from "./list-model";
import { ProjectsSection, type Project } from "./Projects";
import { useSidebarPointerDrag, type SidebarDrop } from "./sidebar-drag";
import "./contacts-layout.css";

/** The default Trunk beside a page: its name, the keys that toggle it, whether it is open. */
export type TalkEntry = { name: string; keys: string; open: boolean; onToggle: () => void };

export type SidebarProps = {
  /** Legacy prop for callers; contacts render only in sections. */
  home?: Conversation | null;
  sections: ListSection[];
  openKey: string | null;
  currentPlace: PlaceId | null;
  now: number;
  showPreview: boolean;
  poppedKeys?: readonly string[];
  rowState: (row: Conversation) => RowState;
  trunkName: (agentId: string | undefined) => string;
  personName: string;
  hasUnread: boolean;
  filterSlot: ReactNode;
  summary: ReactNode;
  emptyLine: string | null;
  search: ReactNode;
  searchResults: ReactNode | null;
  rail: boolean;
  onReorderPins?: (drop: SidebarDrop, visible: readonly string[]) => void;
  onGroupDrop?: (drop: SidebarDrop, anchor: DOMRect) => void;
  dropHint?: (drop: SidebarDrop) => string;
  onMoveToGroup?: (key: string, anchor: DOMRect) => void;
  onRailSearch: () => void;
  onOpen: (key: string) => void;
  onNew: (event: MouseEvent<HTMLElement>) => void;
  onMenu: (row: Conversation, event: MouseEvent<HTMLElement>) => void;
  onPin: (row: Conversation) => void;
  onArchive: (row: Conversation) => void;
  onMarkAllRead: () => void;
  onPerson: (event: MouseEvent<HTMLElement>) => void;
  onSettings: () => void;
  /** On a place or Settings page: the button by the gear that shows the default Trunk beside the page (§3.3). */
  talk?: TalkEntry | null;
  /** The engine's projects and every conversation (to count and list each project's own). */
  projects?: Project[];
  allRows?: Conversation[];
  onNewProject?: () => void;
  /** The row marks' extra facts (drafts, waiting messages, level, look switches). */
  rowExtras?: (row: Conversation) => RowExtras;
  /** Rows picked with Alt or Shift (§4.1.1 select several). A click with Alt or Shift goes to onSelect. */
  selected?: ReadonlySet<string>;
  onSelect?: (row: Conversation, event: MouseEvent<HTMLElement>) => boolean;
  /** The conversation card shown on hover or keyboard focus. */
  onCard?: (row: Conversation, el: HTMLElement | null) => void;
  /** Group by Person: "Show only <name>" or "Show everyone" on its label. */
  showOnly?: { current: string; onShow: (personId: string | null) => void; name: (id: string) => string };
  /** "Clear filters" after the empty line while a filter is on. */
  onClearFilters?: () => void;
  /** Other apps' conversations, after the list (§4.1.1 other apps' sections). */
  appSections?: ReactNode;
  /** The machine switcher, shown at the top of the list only when it slides over (760 px and below). */
  machine?: ReactNode;
};

const CHILDREN_KEY = "branch.childrenOpen";

function readOpenKids(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHILDREN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set(); // storage blocked or damaged: every parent starts folded
  }
}

/** Which parents show their child conversations, and which show all of them ("Show N more"). */
function useKids() {
  const [open, setOpen] = useState(readOpenKids);
  const [all, setAll] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(key)) next.add(key);
      try {
        localStorage.setItem(CHILDREN_KEY, JSON.stringify([...next]));
      } catch {
        // storage blocked: the fold lasts for this window only
      }
      return next;
    });
  return { open, all, toggle, showAll: (key: string) => setAll((cur) => new Set(cur).add(key)) };
}

type Kids = ReturnType<typeof useKids>;

function Row({ p, row, kids, depth = 0, child = false }: { p: SidebarProps; row: Conversation; kids: Kids; depth?: number; child?: boolean }) {
  const mine = child || row.isMain || ["trunk", "group", "chatGroup", "outside"].includes(row.kind) ? [] : childrenOf(p.allRows ?? [], row.key);
  const isOpen = kids.open.has(row.key);
  const shown = isOpen ? shownChildren(mine, kids.all.has(row.key), (c) => p.rowState(c).waiting) : [];
  return (
    <>
      <ConversationRow
        row={row}
        popped={p.poppedKeys?.includes(row.key)}
        current={row.key === p.openKey && p.currentPlace === null}
        time={rowTime(row.updatedAt || row.createdAt, p.now)}
        showPreview={p.showPreview}
        state={p.rowState(row)}
        trunkName={p.trunkName(row.agentId)}
        dimmed={row.archived}
        wakes={row.snoozedUntil && row.snoozedUntil > p.now ? rowTime(row.snoozedUntil, p.now) : undefined}
        extras={p.rowExtras?.(row)}
        kids={mine.length ? { count: mine.length, open: isOpen, onToggle: () => kids.toggle(row.key) } : undefined}
        depth={depth}
        child={child}
        selected={p.selected?.has(row.key)}
        pinDraggable={p.rail && row.pinned}
        pinFixed={row.key === p.home?.key}
        fallbackLine={row.key === p.home?.key ? "Chief of Staff" : row.kind === "group" || row.kind === "chatGroup" ? "Group" : row.kind === "outside" ? "Grafted" : row.kind === "trunk" ? "Trunk" : undefined}
        onOpen={(e) => {
          if ((e.altKey || e.shiftKey) && p.onSelect?.(row, e)) return;
          p.onOpen(row.key);
        }}
        onMenu={(e) => p.onMenu(row, e)}
        onPin={row.kind === "group" ? undefined : () => p.onPin(row)}
        onArchive={row.isMain || row.kind === "trunk" ? undefined : () => p.onArchive(row)}
        onCard={p.onCard ? (el) => p.onCard?.(row, el) : undefined}
      />
      {shown.length ? (
        <div className="kids-box" style={{ ["--dep" as string]: depth + 1 }}>
          {shown.map((k) => (
            <Row key={k.key} p={p} row={k} kids={kids} depth={depth + 1} child />
          ))}
          {mine.length > shown.length ? (
            <button type="button" className="link more-kids" onClick={() => kids.showAll(row.key)}>
              Show {mine.length - shown.length} more
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const PIN_FACE = 44;

function pinFace(p: SidebarProps, row: Conversation, state: RowState) {
  const extra = Math.max(0, (row.participantIds?.length ?? row.roomPicks?.length ?? 0) - 2);
  if (row.roomPicks?.length) {
    return (
      <>
        <RoomFaces picks={row.roomPicks} size={PIN_FACE} />
        {extra > 0 ? <i className="pin-plus">+{extra}</i> : null}
      </>
    );
  }
  if (row.kind === "outside" || row.kind === "chatGroup" || (row.kind !== "trunk" && !row.agentId)) {
    return <RoomAvatar id={row.key} name={row.title} size={PIN_FACE} />;
  }
  return <Pebble size={PIN_FACE} label={p.trunkName(row.agentId)} state={state.waiting ? "wait" : state.working ? "work" : "idle"} priority={state.working || state.waiting ? 200 : 100} />;
}

const seenPinned = new Set<string>();
function PinnedTile({ p, row }: { p: SidebarProps; row: Conversation }) {
  const [fresh] = useState(() => !seenPinned.has(row.key));
  useEffect(() => { seenPinned.add(row.key); }, [row.key]);
  const state = p.rowState(row);
  const current = row.key === p.openKey && p.currentPlace === null;
  const role = row.kind === "group" || row.kind === "chatGroup" ? "Group" : row.kind === "outside" ? "Grafted" : row.key === p.home?.key ? "Chief of Staff" : "Trunk";
  return <div className={fresh ? "pin-tile pin-new" : "pin-tile"} role="listitem" data-pin-key={row.key} data-drag-key={row.key} data-pin-fixed={row.key === p.home?.key ? "true" : undefined}>
    <button type="button" className="pin-open" aria-current={current ? "true" : undefined} aria-selected={p.selected?.has(row.key) || undefined}
      aria-label={`${row.title}, ${role}${row.unread ? ", unread" : ""}${state.working ? ", working" : ""}`}
      title={row.title} onClick={(e) => { if ((e.altKey || e.shiftKey) && p.onSelect?.(row, e)) return; p.onOpen(row.key); }}
      onContextMenu={(e) => { e.preventDefault(); p.onMenu(row, e); }}
      onKeyDown={(e) => { if (e.key === "F10" && e.shiftKey) { e.preventDefault(); p.onMenu(row, e as unknown as MouseEvent<HTMLElement>); } }}>
      <span className="pin-face">{pinFace(p, row, state)}
        {row.unread && !current ? <i className="pin-unread" aria-label="Unread" /> : null}
        {state.waiting ? <i className="needs-you" aria-label="Waiting for you" /> : null}
      </span>
      <b className="pin-name">{row.title}</b>
    </button>
    <button type="button" className="pin-more" aria-label={`More for ${row.title}`} title={`More for ${row.title}`} onClick={(e) => p.onMenu(row, e)}><Icon name="more" small /></button>
  </div>;
}

function Rows({ p, rows, kids, depth = 0 }: { p: SidebarProps; rows: Conversation[]; kids: Kids; depth?: number }) {
  return (
    <>
      {rows.map((row) => (
        <Row key={row.key} p={p} row={row} kids={kids} depth={depth} />
      ))}
    </>
  );
}

/** A section's label: Pinned, Recent, a Trunk, "<name> · n" with "Show only <name>", or a folder's name. */
function SectionLabel({ p, s, label, lead }: { p: SidebarProps; s: ListSection; label: string | null; lead: boolean }) {
  const person = s.personId !== undefined && p.showOnly ? p.showOnly : null;
  const showing = person !== null && person.current === `p:${s.personId}`;
  return (
    <div className={person ? "lh-row per" : "lh-row"}>
      {person && s.personId ? (
        <span className="who-dot pf" aria-hidden="true">{person.name(s.personId).slice(0, 1).toUpperCase()}</span>
      ) : null}
      {label !== null ? <span className="lh" title={s.folder}>{label}</span> : null}
      {lead ? p.summary : null}
      {lead && p.hasUnread ? (
        <button type="button" className="mar" data-testid="mark-all-read" onClick={p.onMarkAllRead}>
          Mark all read
        </button>
      ) : null}
      {lead ? p.filterSlot : null}
      {person && s.personId ? (
        <button type="button" className="link psh" onClick={() => person.onShow(showing ? null : s.personId ?? null)}>
          {showing ? "Show everyone" : `Show only ${person.name(s.personId)}`}
        </button>
      ) : null}
    </div>
  );
}

/** The sidebar: search and + new, contacts, the person's row and the gear. */
export function Sidebar(p: SidebarProps) {
  const kids = useKids();
  const visiblePins = p.sections.find((section) => section.id === "pinned")?.rows.map((row) => row.key) ?? [];
  const drag = useSidebarPointerDrag((drop) => {
    if (drop.zone !== "onto" && visiblePins.includes(drop.source) && visiblePins.includes(drop.target) && drop.source !== p.home?.key) p.onReorderPins?.(drop, visiblePins);
    else {
      const target = document.querySelector<HTMLElement>(`[data-drag-key="${CSS.escape(drop.target)}"]`);
      if (target) p.onGroupDrop?.(drop, target.getBoundingClientRect());
    }
  }, {
    itemAttribute: "data-drag-key", ignoreSelector: ".pin-more, .row-acts, .chv, .prj-row, input, [data-pin-fixed=true]",
    axis: p.rail ? "y" : "x", dropZones: ["onto"],
    zonesFor: (source, target, element) => visiblePins.includes(source) && visiblePins.includes(target) && source !== p.home?.key && element.hasAttribute("data-pin-key") ? ["before", "onto", "after"] : ["onto"],
    hint: (drop) => p.dropHint?.(drop) ?? "",
    onLongPress: (key) => { const item = document.querySelector<HTMLElement>(`[data-drag-key="${CSS.escape(key)}"] .pin-more, [data-drag-key="${CSS.escape(key)}"] [data-testid="row-more"]`); item?.click(); },
  });
  return (
    <aside className={p.rail ? "side rail" : "side"} aria-label="Conversations" data-testid="sidebar" {...drag}>
      {p.machine ? <div className="side-machine">{p.machine}</div> : null}
      <div className="side-top">
        {p.rail ? (
          <>
            <button type="button" className="ib rail-search" aria-label="Search" title="Search" onClick={p.onRailSearch}><Icon name="search" /></button>
            <button type="button" className="ib rail-new" aria-label="New, places and more" title="New, places and more" data-testid="new" onClick={p.onNew}><Icon name="plus" /></button>
          </>
        ) : (
          <>
            {p.search}
            <button type="button" className="ib" aria-label="New conversation, Trunk, group chat or automation" title="New conversation, Trunk, group chat or automation" data-testid="new" onClick={p.onNew}>
              <Icon name="plus" />
            </button>
          </>
        )}
      </div>
      {p.searchResults && !p.rail ? p.searchResults : (
        <div className="side-scroll">
          <div className="list" data-testid="conversation-list">
            {p.sections.map((s, i) => {
              // The Filter and sort button sits on the "Recent" label row, or on the first row when there is no "Recent".
              const lead = s.id === "recent" || (i === 0 && !p.sections.some((x) => x.id === "recent"));
              // An unlabelled "all" section still gets its "Conversations" heading (engine-core shell).
              const label = s.label !== null ? (s.id.startsWith("trunk:") ? p.trunkName(s.label) : s.label) : s.id === "all" ? "Conversations" : null;
              return (
                <section key={s.id} className="list-sec" data-section={s.id}>
                  {s.id === "pinned" && !p.rail ? null : label !== null || lead ? <SectionLabel p={p} s={s} label={label} lead={lead} /> : null}
                  {s.id === "pinned" && !p.rail ? <div className="pin-grid" role="list" aria-label="Pinned">{s.rows.map((row) => <PinnedTile key={row.key} p={p} row={row} />)}</div> : <Rows p={p} rows={s.rows} kids={kids} />}
                </section>
              );
            })}
            {!p.rail && p.projects && p.onNewProject ? <ProjectsSection projects={p.projects} rows={p.allRows ?? []} renderRows={(rows) => <Rows p={p} rows={rows} kids={kids} />} onNew={p.onNewProject} /> : null}
            {p.emptyLine ? (
              <p className="list-empty">
                {p.emptyLine}
                {p.onClearFilters && p.emptyLine === "Nothing matches these filters." ? (
                  <>
                    {" "}
                    <button type="button" className="link" onClick={p.onClearFilters}>
                      Clear filters
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
            {!p.rail ? p.appSections : null}
          </div>
        </div>
      )}
      <div className="owner">
        <button type="button" className="me" title="Who is using Branch, look, lock" aria-label={p.personName} data-testid="person" onClick={p.onPerson}>
          <span className="initial" aria-hidden="true">
            {p.personName.slice(0, 1).toUpperCase()}
          </span>
          <b>{p.personName}</b>
          <Icon name="down" small />
        </button>
        {p.talk ? (
          <button type="button" className="ib talk-btn" aria-label={`Talk to ${p.talk.name} (${p.talk.keys})`} title={`Talk to ${p.talk.name} (${p.talk.keys})`} aria-pressed={p.talk.open} data-testid="talk-beside-button" onClick={p.talk.onToggle}>
            <Icon name="chat" />
          </button>
        ) : null}
        <button type="button" className="ib" aria-label="Settings" title="Settings" data-testid="gear" onClick={p.onSettings}>
          <Icon name="gear" />
        </button>
      </div>
    </aside>
  );
}

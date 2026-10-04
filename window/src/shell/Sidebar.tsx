import { useState, type MouseEvent, type ReactNode } from "react";
import { CommunityInvite } from "./CommunityInvite";
import type { Conversation } from "../connect/conversations";
import { PLACES, type PlaceId } from "../places-nav/routes";
import { ConversationRow, type RowExtras, type RowState } from "./ConversationRow";
import { Icon } from "./icons";
import { childrenOf, rowTime, shownChildren, type ListSection } from "./list-model";
import { ProjectsSection, type Project } from "./Projects";

/** The default Trunk beside a page: its name, the keys that toggle it, whether it is open. */
export type TalkEntry = { name: string; keys: string; open: boolean; onToggle: () => void };

export type SidebarProps = {
  home: Conversation | null;
  sections: ListSection[];
  openKey: string | null;
  currentPlace: PlaceId | null;
  now: number;
  showPreview: boolean;
  rowState: (row: Conversation) => RowState;
  trunkName: (agentId: string | undefined) => string;
  inboxCount: number;
  runningCount: number;
  personName: string;
  hasUnread: boolean;
  filterSlot: ReactNode;
  summary: ReactNode;
  emptyLine: string | null;
  search: ReactNode;
  searchResults: ReactNode | null;
  /** The pet walking above the person's row (Appearance › The pet › Where it walks: The list). */
  pet?: ReactNode;
  rail: boolean;
  onRailSearch: () => void;
  onOpen: (key: string) => void;
  onPlace: (place: PlaceId) => void;
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

const FOLD_KEY = "branch.placesFolded";

function readFolded(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false; // storage blocked: places start open
  }
}

function Places({ current, inbox, running, rail, onPlace }: { current: PlaceId | null; inbox: number; running: number; rail: boolean; onPlace: (p: PlaceId) => void }) {
  const [foldedPref, setFolded] = useState(readFolded);
  const folded = foldedPref && !rail; // the rail has no header and no folding (§4.1.8)
  const toggle = () => {
    setFolded(!foldedPref);
    try {
      localStorage.setItem(FOLD_KEY, foldedPref ? "0" : "1");
    } catch {
      // storage blocked: the fold lasts for this window only
    }
  };
  return (
    <nav className={folded ? "places folded" : "places"} aria-label="Places">
      <button type="button" className="lh places-h" aria-expanded={!folded} onClick={toggle}>
        <Icon name={folded ? "chev" : "down"} small />
        Places
      </button>
      <div className="place-rows">
        {PLACES.map((p) => {
          const count = p.id === "inbox" ? inbox : p.id === "people" ? running : 0;
          return (
            <button
              key={p.id}
              type="button"
              className="nav"
              data-place={p.id}
              aria-current={current === p.id ? "page" : undefined}
              title={folded || rail ? p.name : undefined}
              aria-label={folded || rail ? p.name : undefined}
              onClick={() => onPlace(p.id)}
            >
              <Icon name={p.icon} />
              <span className="nav-name">{p.name}</span>
              {count > 0 ? (
                <span className={p.id === "inbox" ? "cnt attn" : "cnt"} title={p.id === "people" ? `${count} running now` : undefined}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

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
  const mine = child || row.isMain ? [] : childrenOf(p.allRows ?? [], row.key);
  const isOpen = kids.open.has(row.key);
  const shown = isOpen ? shownChildren(mine, kids.all.has(row.key), (c) => p.rowState(c).waiting) : [];
  return (
    <>
      <ConversationRow
        row={row}
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
        onOpen={(e) => {
          if ((e.altKey || e.shiftKey) && p.onSelect?.(row, e)) return;
          p.onOpen(row.key);
        }}
        onMenu={(e) => p.onMenu(row, e)}
        onPin={row.isMain ? undefined : () => p.onPin(row)}
        onArchive={row.isMain ? undefined : () => p.onArchive(row)}
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

/** The sidebar (DESIGN-SPEC §4.1.1): search and + new, the Places, the conversation list, the person's row and the gear. */
export function Sidebar(p: SidebarProps) {
  const kids = useKids();
  return (
    <aside className={p.rail ? "side rail" : "side"} aria-label="Conversations" data-testid="sidebar">
      {p.machine ? <div className="side-machine">{p.machine}</div> : null}
      <div className="side-top">
        {p.rail ? (
          <button type="button" className="ib rail-search" aria-label="Search" title="Search" onClick={p.onRailSearch}>
            <Icon name="search" />
          </button>
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
          <Places current={p.currentPlace} inbox={p.inboxCount} running={p.runningCount} rail={p.rail} onPlace={p.onPlace} />
          <div className="list" data-testid="conversation-list">
            {p.home ? <Rows p={p} rows={[p.home]} kids={kids} /> : null}
            {p.projects && p.onNewProject ? <ProjectsSection projects={p.projects} rows={p.allRows ?? []} renderRows={(rows) => <Rows p={p} rows={rows} kids={kids} />} onNew={p.onNewProject} /> : null}
            {p.sections.map((s, i) => {
              // The Filter and sort button sits on the "Recent" label row, or on the first row when there is no "Recent".
              const lead = s.id === "recent" || (i === 0 && !p.sections.some((x) => x.id === "recent"));
              // An unlabelled "all" section still gets its "Conversations" heading (engine-core shell).
              const label = s.label !== null ? (s.id.startsWith("trunk:") ? p.trunkName(s.label) : s.label) : s.id === "all" ? "Conversations" : null;
              return (
                <section key={s.id} className="list-sec" data-section={s.id}>
                  {label !== null || lead ? <SectionLabel p={p} s={s} label={label} lead={lead} /> : null}
                  <Rows p={p} rows={s.rows} kids={kids} />
                </section>
              );
            })}
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
            {p.appSections}
          </div>
        </div>
      )}
      <CommunityInvite />
      {p.pet}
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

// Filter and sort in the R1 sidebar: the Classic popover and button (shell/FilterSort.tsx) and the Classic choices
// (shell/list-model.ts), re-hosted. The choices narrow and order the sidebar's own rows. The Display choices the R1 list
// fixes by design (grouped by kind, empty sections dropped, a preview line on every row) are left out rather than offered
// and ignored. The popover is a clear glass panel (README item 48) opened over the window, outside the frosted sidebar.
import { useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { Level } from "../../places-nav/settings-nav";
import type { Trunk } from "../../shell/engine-data";
import { FilterButton, FilterSortPopover, type DisplayChoice, type FilterFacts } from "../../shell/FilterSort";
import { DEFAULT_PREFS, involvesMe, isSnoozed, type ListPeople, type ListPrefs, type SortBy, type StatusFilter } from "../../shell/list-model";
import type { MenuAnchor } from "../../shell/Menu";
import type { Sections, SideRow } from "./model";

/** What the R1 list does with no choice made, and what Reset returns to: newest activity first, grouped by kind. */
export const R1_PREFS: ListPrefs = { ...DEFAULT_PREFS, sortBy: "activity", groupBy: "trunk", hideEmpty: "always", preview: true };
export const R1_OMIT: readonly DisplayChoice[] = ["group", "hide", "preview"];
const KEY = "branch.r1.listPrefs";

export function readR1Prefs(): ListPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ListPrefs>;
    return { ...R1_PREFS, ...saved, groupBy: R1_PREFS.groupBy, hideEmpty: R1_PREFS.hideEmpty, preview: R1_PREFS.preview };
  } catch {
    return R1_PREFS; // storage blocked or damaged: the defaults
  }
}

export function saveR1Prefs(prefs: ListPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked: the choices last for this window only
  }
}

const agentOf = (row: SideRow) => row.row?.agentId ?? (row.contact?.kind === "trunk" ? row.contact.id.slice("trunk:".length) : undefined);

/** Status as in Classic, on contact rows: Active leaves snoozed rows out; archived rows keep their place in the bin. */
function passesStatus(row: SideRow, status: StatusFilter, now: number): boolean {
  const snoozed = Boolean(row.row && isSnoozed(row.row, now));
  if (status === "active") return !snoozed;
  if (status === "snoozed") return snoozed && !row.archived;
  if (status === "archived") return row.archived;
  return true;
}

function passesPeople(row: SideRow, people: string, selfId: string | null): boolean {
  if (people === "everyone") return true;
  if (people === "me") return Boolean(row.row && involvesMe(row.row, selfId));
  const id = people.slice(2);
  return row.row?.ownerId === id || row.id === `person:${id}`;
}

/** The rows that pass the Filters (Status, People, Trunks, automation runs, system conversations). */
export function filterSideRows(rows: readonly SideRow[], prefs: ListPrefs, now: number, people: ListPeople): SideRow[] {
  return rows.filter(row =>
    passesStatus(row, prefs.status, now)
    && passesPeople(row, prefs.people ?? "everyone", people.selfId)
    && (prefs.trunk === null || agentOf(row) === prefs.trunk)
    && (prefs.showAutomation || !row.row?.automation)
    && (prefs.showSystem || !row.row?.system));
}

/** Sort by inside each section. Latest activity is the order buildSections already gives. */
export function sortSections(sections: Sections, sortBy: SortBy, people: ListPeople): Sections {
  const owner = (row: SideRow) => {
    const id = row.row?.ownerId;
    return id ? people.names.get(id) ?? row.row?.ownerName ?? id : "\uffff";
  };
  const order = sortBy === "created" ? (a: SideRow, b: SideRow) => (b.row?.createdAt ?? 0) - (a.row?.createdAt ?? 0) || a.name.localeCompare(b.name)
    : sortBy === "person" ? (a: SideRow, b: SideRow) => owner(a).localeCompare(owner(b)) || b.at - a.at
    : null;
  if (!order) return sections;
  const sorted = (list: SideRow[]) => [...list].sort(order);
  return { pinned: sorted(sections.pinned), trunks: sorted(sections.trunks), people: sorted(sections.people), groups: sorted(sections.groups), grafted: sorted(sections.grafted), archived: sorted(sections.archived) };
}

/** What the popover can offer for these rows. Group by is left out, so whether any row has a folder doesn't matter. */
export function filterFacts(rows: readonly SideRow[], trunks: Trunk[], people: ListPeople, level: Level, prefs: ListPrefs, now: number): FilterFacts {
  const owners = new Set(rows.map(row => row.row?.ownerId).filter((id): id is string => Boolean(id)));
  const unread = filterSideRows(rows, { ...prefs, trunk: null }, now, people).filter(row => row.unread).map(agentOf);
  return { trunks, people, owners: owners.size, folders: false, level, unreadTrunks: new Set(unread.filter((id): id is string => Boolean(id))) };
}

export type R1FilterSortProps = { prefs: ListPrefs; facts: FilterFacts; onChange: (prefs: ListPrefs) => void; onSettings: (page: string) => void };

/** The Classic Filter and sort button in the sidebar's top row, and its popover over the window. */
export function R1FilterSort({ prefs, facts, onChange, onSettings }: R1FilterSortProps) {
  const [at, setAt] = useState<MenuAnchor | null>(null);
  const open = (event: MouseEvent<HTMLElement>) => {
    if (at) { setAt(null); return; }
    const box = event.currentTarget.getBoundingClientRect();
    setAt({ x: box.left, y: box.bottom + 6 });
  };
  return <>
    <span className="r1sb-filt" data-local="">
      <FilterButton prefs={prefs} open={Boolean(at)} onOpen={open} />
    </span>
    {at ? createPortal(<div className="r1-fs" data-local="">
      <FilterSortPopover at={at} prefs={prefs} facts={facts} defaults={R1_PREFS} omit={R1_OMIT} onChange={onChange} onClose={() => setAt(null)} onSettings={onSettings} />
    </div>, document.body) : null}
  </>;
}

import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Level } from "../places-nav/settings-nav";
import type { Trunk } from "./engine-data";
import { Icon } from "./icons";
import {
  anyDiffers,
  DEFAULT_PREFS,
  filtersDiffer,
  type GroupBy,
  type HideEmpty,
  type ListPeople,
  type ListPrefs,
  type SortBy,
  type StatusFilter,
} from "./list-model";
import type { MenuAnchor } from "./Menu";
import { Popover, Segmented, Switch } from "./Popover";
import { Pebble } from "../face/Pebble";

const KEY = "branch.listPrefs";

export function readPrefs(): ListPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<ListPrefs>;
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return DEFAULT_PREFS; // storage blocked or damaged: the defaults
  }
}

export function savePrefs(p: ListPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage blocked: the choices last for this window only
  }
}

const STATUS: { id: StatusFilter; name: string }[] = [
  { id: "active", name: "Active" },
  { id: "snoozed", name: "Snoozed" },
  { id: "archived", name: "Archived" },
  { id: "all", name: "All" },
];
const GROUP: [GroupBy, string][] = [["projects", "Projects"], ["folder", "Folder"], ["person", "Person"], ["trunk", "Trunk"], ["none", "None"]];
const SORT: [SortBy, string][] = [["created", "Created"], ["activity", "Latest activity"], ["person", "Person"]];
const HIDE: [HideEmpty, string][] = [["filtering", "When filtering"], ["always", "Always"], ["never", "Never"]];

/** The 24 px "Filter and sort" button at the right of the "Recent" label, with its dot while a filter is on. */
export function FilterButton({ prefs, open, onOpen }: { prefs: ListPrefs; open: boolean; onOpen: (e: MouseEvent<HTMLElement>) => void }) {
  const on = filtersDiffer(prefs);
  return (
    <button type="button" className={on ? "ib sm filt on" : "ib sm filt"} aria-label="Filter and sort" title="Filter and sort" aria-haspopup="menu" aria-expanded={open} data-testid="filter-sort" onClick={onOpen}>
      <Icon name="filter" small />
      {on ? <i className="filt-dot" aria-hidden="true" /> : null}
    </button>
  );
}

/** What the popover can offer: the Trunks, the people and whether any conversation has an owner or a folder. */
export type FilterFacts = { trunks: Trunk[]; people: ListPeople; owners: number; folders: boolean; level: Level; unreadTrunks: Set<string> };

type Props = { at: MenuAnchor; prefs: ListPrefs; facts: FilterFacts; onChange: (p: ListPrefs) => void; onClose: () => void; onSettings: (page: string) => void };
type Page = "people" | "trunk" | "group" | "sort" | "hide";

function peopleWord(p: ListPrefs, people: ListPeople): string {
  if (p.people === "me") return "Involving me";
  if (p.people.startsWith("p:")) return people.names.get(p.people.slice(2)) ?? "Everyone";
  return "Everyone";
}

/** One "choice" row: its name, the current choice and a chevron; it opens its page beside (or in place, narrow). */
function ChoiceRow({ page, label, value, open, onOpen }: { page: Page; label: string; value: string; open: boolean; onOpen: (page: Page, el: HTMLElement) => void }) {
  return (
    <button type="button" className="mi fch" role="menuitem" aria-haspopup="menu" aria-expanded={open} data-page={page}
      onClick={(e) => onOpen(page, e.currentTarget)} onKeyDown={(e) => e.key === "ArrowRight" && (e.preventDefault(), onOpen(page, e.currentTarget))}>
      <span className="mi-t">{label}</span>
      <span className="r">
        {value} <Icon name="chev" small />
      </span>
    </button>
  );
}

function Tick({ on, label, run, lead }: { on: boolean; label: string; run: () => void; lead?: ReactNode }) {
  return (
    <button type="button" className="mi" role="menuitemradio" aria-checked={on} onClick={run}>
      <span className="tick" aria-hidden="true">{on ? <Icon name="check" small /> : null}</span>
      {lead}
      <span className="mi-t">{label}</span>
    </button>
  );
}

function PeoplePage({ p, facts, set }: { p: ListPrefs; facts: FilterFacts; set: (x: Partial<ListPrefs>) => void }) {
  const [q, setQ] = useState("");
  const list = [...facts.people.names].filter(([, name]) => !q || name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="ph">People</div>
      <Tick on={p.people === "everyone"} label="Everyone" run={() => set({ people: "everyone" })} />
      {facts.people.selfId ? <Tick on={p.people === "me"} label="Involving me" run={() => set({ people: "me" })} /> : null}
      <hr />
      <div className="fpq">
        <input className="inp" type="search" placeholder="Find a person" aria-label="Find a person" autoComplete="off" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Escape" && q && (e.preventDefault(), e.stopPropagation(), setQ(""))} />
      </div>
      <div className="ph">One person: {list.length} available</div>
      {list.map(([id, name]) => (
        <Tick key={id} on={p.people === `p:${id}`} label={id === facts.people.selfId ? `${name} (you)` : name} run={() => set({ people: `p:${id}` })}
          lead={<span className="who-dot fpf" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>} />
      ))}
    </>
  );
}

function TrunkPage({ p, facts, set }: { p: ListPrefs; facts: FilterFacts; set: (x: Partial<ListPrefs>) => void }) {
  return (
    <>
      <div className="ph">Trunks</div>
      <Tick on={p.trunk === null} label="All Trunks" run={() => set({ trunk: null })} />
      <div className="tgrid" role="group" aria-label="Pick one Trunk">
        {facts.trunks.map((t) => {
          const unread = facts.unreadTrunks.has(t.id);
          return (
            <button key={t.id} type="button" className="tf" aria-pressed={p.trunk === t.id} aria-label={`${t.name}${unread ? ", unread" : ""}`} title={t.name} onClick={() => set({ trunk: t.id })}>
              <Pebble size={28} label={t.name} state="idle" priority={50} />
              {unread ? <i className="unread" /> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

function pageBody(page: Page, p: ListPrefs, facts: FilterFacts, set: (x: Partial<ListPrefs>) => void): ReactNode {
  if (page === "people") return <PeoplePage p={p} facts={facts} set={set} />;
  if (page === "trunk") return <TrunkPage p={p} facts={facts} set={set} />;
  const [title, key, options] =
    page === "group"
      ? (["Group by", "groupBy", groupChoices(facts)] as const)
      : page === "sort"
        ? (["Sort by", "sortBy", SORT.filter(([v]) => v !== "person" || facts.owners > 1)] as const)
        : (["Hide empty groups", "hideEmpty", HIDE] as const);
  return (
    <>
      <div className="ph">{title}</div>
      {options.map(([v, l]) => (
        <Tick key={v} on={p[key] === v} label={l} run={() => set({ [key]: v } as Partial<ListPrefs>)} />
      ))}
    </>
  );
}

/** Group by offers Folder only when a conversation has one and Person only with two or more owners (as the preview). */
function groupChoices(facts: FilterFacts): [GroupBy, string][] {
  return GROUP.filter(([v]) => (v !== "folder" || facts.folders) && (v !== "person" || facts.owners > 1));
}

const word = (list: readonly (readonly [string, string])[], v: string) => list.find(([k]) => k === v)?.[1] ?? "";

/** The flyout beside a choice row (§5.4 submenu): a glass menu at the row's right edge. */
function Flyout({ at, children }: { at: { x: number; y: number }; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: at.x + r.width > innerWidth - 8 ? Math.max(8, at.x - r.width - 340) : at.x, y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) });
  }, [at]);
  return (
    <div ref={ref} className="pop menu fly in17" role="menu" style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>
  );
}

/** The Filter and sort popover (DESIGN-SPEC §4.1.1 Parity adds, the preview's filterHtmlPA18): "Filters" and, at
 *  Advanced, "Display"; each choice applies at once. Narrow windows get a bottom sheet with pages. */
export function FilterSortPopover({ at, prefs, facts, onChange, onClose, onSettings }: Props) {
  const [p, setP] = useState(prefs);
  const [page, setPage] = useState<{ id: Page; at: { x: number; y: number } } | null>(null);
  const narrow = innerWidth <= 760;
  const adv = facts.level !== "regular";
  const set = (patch: Partial<ListPrefs>) => {
    const next = { ...p, ...patch };
    if (next.groupBy === "person" && facts.owners < 2) next.groupBy = "projects";
    setP(next);
    onChange(next);
  };
  const open = (id: Page, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setPage((cur) => (cur?.id === id && !narrow ? null : { id, at: { x: r.right + 4, y: r.top - 6 } }));
  };
  const trunkWord = p.trunk === null ? "All Trunks" : facts.trunks.find((t) => t.id === p.trunk)?.name ?? "All Trunks";
  const body =
    narrow && page ? (
      <>
        <button type="button" className="mi fback" onClick={() => setPage(null)}>
          <Icon name="back" small />
          <span className="mi-t">Back</span>
        </button>
        {pageBody(page.id, p, facts, set)}
      </>
    ) : (
      <>
        <div className="ph fh">
          Filters
          {anyDiffers(p) ? (
            <button type="button" className="link fr" data-testid="filter-reset" onClick={() => set(DEFAULT_PREFS)}>
              Reset
            </button>
          ) : null}
        </div>
        {adv && facts.people.names.size > 1 ? <ChoiceRow page="people" label="People" value={peopleWord(p, facts.people)} open={page?.id === "people"} onOpen={open} /> : null}
        <div className="row-in">
          <span>Status</span>
          <Segmented label="Status" value={p.status} options={STATUS} onChange={(status) => set({ status })} testid="filter-status" />
        </div>
        <ChoiceRow page="trunk" label="Trunks" value={trunkWord} open={page?.id === "trunk"} onOpen={open} />
        {adv ? (
          <>
            <SwitchRow title="Show automation runs" sub="Each scheduled run as its own conversation. They are also in Inbox › History." on={p.showAutomation} set={(showAutomation) => set({ showAutomation })} />
            <SwitchRow title="Show system conversations" sub="Conversations Branch keeps for its own upkeep." on={p.showSystem} set={(showSystem) => set({ showSystem })} />
            <p className="hint fw">
              <button type="button" className="link" onClick={() => (onClose(), onSettings("self"))}>
                Where these come from
              </button>
            </p>
            <hr />
            <div className="ph">Display</div>
            <ChoiceRow page="group" label="Group by" value={word(GROUP, p.groupBy)} open={page?.id === "group"} onOpen={open} />
            <ChoiceRow page="sort" label="Sort by" value={word(SORT, p.sortBy)} open={page?.id === "sort"} onOpen={open} />
            <ChoiceRow page="hide" label="Hide empty groups" value={word(HIDE, p.hideEmpty)} open={page?.id === "hide"} onOpen={open} />
            <SwitchRow title="Message preview" on={p.preview} set={(preview) => set({ preview })} testid="filter-preview" />
          </>
        ) : null}
      </>
    );
  return (
    <>
      <Popover at={at} onClose={onClose} label="Filter and sort" testid="filter-popover" className={narrow ? "fp sheet" : "fp"}>
        {body}
      </Popover>
      {page && !narrow ? <Flyout at={page.at}>{pageBody(page.id, p, facts, set)}</Flyout> : null}
    </>
  );
}

function SwitchRow({ title, sub, on, set, testid }: { title: string; sub?: string; on: boolean; set: (v: boolean) => void; testid?: string }) {
  return (
    <div className="ctl fsw">
      <b>{title}</b>
      <Switch label={title} on={on} onChange={set} testid={testid} />
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

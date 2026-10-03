// How the sidebar arranges the engine's conversations (DESIGN-SPEC §4.1.1 and its Parity adds):
// the default Trunk's main conversation first, then Pinned, then Recent, after the person's
// Filter and sort choices. Pure functions, so they are tested on their own.
import type { Conversation } from "../connect/conversations";

export type StatusFilter = "active" | "snoozed" | "archived" | "all";
export type SortBy = "created" | "activity" | "person";
export type GroupBy = "projects" | "folder" | "person" | "trunk" | "none";
export type HideEmpty = "filtering" | "always" | "never";
/** "everyone", "me" (Involving me) or "p:<person id>" (one person's). */
export type PeopleFilter = string;

export type ListPrefs = {
  status: StatusFilter;
  people: PeopleFilter;
  trunk: string | null;
  showAutomation: boolean;
  showSystem: boolean;
  groupBy: GroupBy;
  sortBy: SortBy;
  hideEmpty: HideEmpty;
  preview: boolean;
};

/** The preview's defaults (app-latest LIST_DEF_PA18), which are OpenClaw's (§4.1.1 Filter and sort, "Default" column). */
export const DEFAULT_PREFS: ListPrefs = {
  status: "active",
  people: "everyone",
  trunk: null,
  showAutomation: false,
  showSystem: false,
  groupBy: "projects",
  sortBy: "created",
  hideEmpty: "filtering",
  preview: false,
};

/** What the list knows about people: who you are and each person's name (users.self, users.list). */
export type ListPeople = { selfId: string | null; names: Map<string, string> };
export const NO_PEOPLE: ListPeople = { selfId: null, names: new Map() };

export type ListSection = {
  id: string;
  label: string | null;
  rows: Conversation[];
  /** A Group by Person label: whose group it is (its face and "Show only <name>"). */
  personId?: string;
  /** A Group by Folder label: the whole path, for its tooltip. */
  folder?: string;
};

/** Whether a choice under "Filters" differs from its default (the dot on the Filter and sort button). */
export function filtersDiffer(p: ListPrefs): boolean {
  return p.status !== DEFAULT_PREFS.status || p.trunk !== DEFAULT_PREFS.trunk || p.people !== DEFAULT_PREFS.people;
}

/** Whether any choice differs from its default (the "Reset" link). */
export function anyDiffers(p: ListPrefs): boolean {
  return (Object.keys(DEFAULT_PREFS) as (keyof ListPrefs)[]).some((k) => p[k] !== DEFAULT_PREFS[k]);
}

/** The filters cleared, the display choices kept (the × after the summary and "Clear filters"). */
export function clearFilters(p: ListPrefs): ListPrefs {
  return { ...p, status: DEFAULT_PREFS.status, trunk: DEFAULT_PREFS.trunk, people: DEFAULT_PREFS.people };
}

export function isSnoozed(c: Conversation, now: number): boolean {
  return c.snoozedUntil !== null && c.snoozedUntil > now;
}

function passesStatus(c: Conversation, status: StatusFilter, now: number, openKey: string | null): boolean {
  const snoozed = isSnoozed(c, now);
  if (status === "active") {
    return (!c.archived || c.key === openKey) && !snoozed;
  }
  if (status === "snoozed") {
    return snoozed;
  }
  if (status === "archived") {
    return c.archived || c.key === openKey;
  }
  return true;
}

/** Involving me: mine, or one I'm in, unless I hid it from this list (§4.1.1 People filter). */
export function involvesMe(c: Conversation, selfId: string | null): boolean {
  if (!selfId || c.hiddenFromMe) return false;
  return c.ownerId === selfId || (c.participantIds ?? []).includes(selfId);
}

function passesPeople(c: Conversation, people: PeopleFilter, selfId: string | null): boolean {
  if (people === "me") return involvesMe(c, selfId);
  if (people.startsWith("p:")) return c.ownerId === people.slice(2);
  return true;
}

/** Keys of the rows that show under another row (a conversation it started); they leave the top level. */
function childKeys(rows: Conversation[]): Set<string> {
  const keys = new Set(rows.map((r) => r.key));
  return new Set(rows.filter((r) => r.parentKey && keys.has(r.parentKey)).map((r) => r.key));
}

/** The rows that pass the person's filters, the main conversation and child rows excluded (each has its own place). */
export function filterRows(rows: Conversation[], p: ListPrefs, now: number, openKey: string | null, people: ListPeople = NO_PEOPLE): Conversation[] {
  const kids = childKeys(rows);
  return rows.filter(
    (c) =>
      !c.isMain &&
      !kids.has(c.key) &&
      passesStatus(c, p.status, now, openKey) &&
      passesPeople(c, p.people ?? "everyone", people.selfId) &&
      (p.trunk === null || c.agentId === p.trunk) &&
      (p.showAutomation || !c.automation) &&
      (p.showSystem || !c.system),
  );
}

/** A row's child conversations, newest first (§4.1.1.1 child conversations). */
export function childrenOf(rows: Conversation[], key: string): Conversation[] {
  return rows.filter((r) => r.parentKey === key && !r.isMain).sort((a, b) => b.createdAt - a.createdAt);
}

/** The children an unfolded row shows: the first four, plus any waiting or failed one (§4.1.1.1). */
export function shownChildren(kids: Conversation[], all: boolean, waiting: (c: Conversation) => boolean): Conversation[] {
  if (all) return kids;
  const must = kids.filter((k) => waiting(k) || (k.runMark !== undefined && k.runMark !== "queued"));
  return [...new Set([...kids.slice(0, 4), ...must])];
}

export function sortRows(rows: Conversation[], sortBy: SortBy, people: ListPeople = NO_PEOPLE): Conversation[] {
  if (sortBy === "person") {
    const name = (c: Conversation) => (c.ownerId ? people.names.get(c.ownerId) ?? c.ownerName ?? c.ownerId : "\uffff");
    return [...rows].sort((a, b) => name(a).localeCompare(name(b)) || b.createdAt - a.createdAt);
  }
  const key = (c: Conversation) => (sortBy === "created" ? c.createdAt : c.updatedAt);
  return [...rows].sort((a, b) => key(b) - key(a));
}

/** The people who own conversations in the list (Group by Person and Sort by Person show only with two or more). */
export function owners(rows: Conversation[]): string[] {
  return [...new Set(rows.filter((r) => !r.isMain && r.ownerId).map((r) => r.ownerId as string))];
}

/** Whether any conversation has a folder (Group by Folder shows only then). */
export function hasFolders(rows: Conversation[]): boolean {
  return rows.some((r) => !r.isMain && Boolean(r.folder));
}

/** The main conversation's row: the engine's row when it exists, else one made from the engine's main key. */
export function homeRow(rows: Conversation[], mainKey: string | null, trunkName: string): Conversation | null {
  if (!mainKey) {
    return null;
  }
  const found = rows.find((c) => c.key === mainKey);
  const base: Conversation = found ?? {
    key: mainKey,
    title: "",
    isMain: true,
    pinned: false,
    archived: false,
    unread: false,
    snoozedUntil: null,
    createdAt: 0,
    updatedAt: 0,
    preview: "",
    working: false,
    kind: "direct",
    system: false,
    automation: false,
    totalTokens: 0,
    contextTokens: 0,
  };
  // The default Trunk's main conversation keeps the Trunk's name (§4.1.1.1 Parity adds, auto-session-titles).
  return { ...base, isMain: true, title: trunkName };
}

/** The sections under the home row (§4.1.1 Group by): Pinned and Recent, one flat list, or a group per Trunk,
 *  person or folder, with "Hide empty groups" applied. */
export function buildSections(rows: Conversation[], p: ListPrefs, now: number, openKey: string | null, people: ListPeople = NO_PEOPLE): ListSection[] {
  const shown = sortRows(filterRows(rows, p, now, openKey, people), p.sortBy, people);
  if (p.groupBy === "none") {
    return [{ id: "all", label: null, rows: shown }];
  }
  if (p.groupBy === "trunk") {
    const byTrunk = new Map<string, Conversation[]>();
    for (const c of shown) {
      const id = c.agentId ?? "";
      byTrunk.set(id, [...(byTrunk.get(id) ?? []), c]);
    }
    return [...byTrunk].map(([id, list]) => ({ id: `trunk:${id}`, label: id, rows: list }));
  }
  if (p.groupBy === "person") {
    return [{ id: "recent", label: "Recent", rows: [] }, ...personGroups(shown, p, people)];
  }
  if (p.groupBy === "folder") {
    const folders = [...new Set(shown.map((c) => c.folder ?? ""))].sort((a, b) => Number(!a) - Number(!b) || a.localeCompare(b));
    const groups = folders.map((f) => ({
      id: `folder:${f}`,
      label: f ? f.split(/[\\/]/).filter(Boolean).pop() ?? f : "No folder",
      rows: shown.filter((c) => (c.folder ?? "") === f),
      ...(f ? { folder: f } : {}),
    }));
    return [{ id: "recent", label: "Recent", rows: [] }, ...groups];
  }
  const pinned = shown.filter((c) => c.pinned);
  const recent = shown.filter((c) => !c.pinned);
  return [
    ...(pinned.length || p.hideEmpty === "never" ? [{ id: "pinned", label: "Pinned", rows: pinned }] : []),
    { id: "recent", label: "Recent", rows: recent },
  ];
}

/** Group by Person: a label per owner with the count; an empty person's group shows only under "Never". */
function personGroups(shown: Conversation[], p: ListPrefs, people: ListPeople): ListSection[] {
  const ids = [...new Set([...(p.hideEmpty === "never" ? [...people.names.keys()] : []), ...shown.map((c) => c.ownerId ?? "")])];
  return ids
    .map((id) => {
      const list = shown.filter((c) => (c.ownerId ?? "") === id);
      const name = id ? people.names.get(id) ?? list[0]?.ownerName ?? id : "No owner";
      return { id: `person:${id}`, label: `${name} · ${list.length}`, rows: list, personId: id };
    })
    .filter((g) => g.rows.length > 0 || p.hideEmpty === "never");
}

/** The row's time (§4.1.1.1 Time): "now", a time like 12:04, "Yesterday" or a weekday, then a date. */
export function rowTime(ms: number, now: number): string {
  if (!ms) {
    return "";
  }
  const diff = now - ms;
  if (diff < 60_000 && diff > -60_000) {
    return "now";
  }
  const d = new Date(ms);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= startOfToday) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (ms >= startOfToday - 86_400_000) {
    return "Yesterday";
  }
  if (ms >= startOfToday - 6 * 86_400_000) {
    return d.toLocaleDateString([], { weekday: "long" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** The filter summary after the "Recent" label, for example "Snoozed · Only Sapling". */
export function filterSummary(p: ListPrefs, trunkName: (id: string) => string, personName: (id: string) => string = (id) => id): string {
  const parts: string[] = [];
  if (p.status !== "active") {
    parts.push({ snoozed: "Snoozed", archived: "Archived", all: "All", active: "Active" }[p.status]);
  }
  if (p.people === "me") {
    parts.push("Involving me");
  } else if (p.people?.startsWith("p:")) {
    parts.push(personName(p.people.slice(2)));
  }
  if (p.trunk) {
    parts.push(`Only ${trunkName(p.trunk)}`);
  }
  return parts.join(" · ");
}

/** Share of a conversation's room used (0–1), or null when the engine has not said (§4.9.1 Room left). */
export function roomUsed(row: Conversation | null): number | null {
  if (!row || row.contextTokens <= 0 || row.totalTokens <= 0) {
    return null;
  }
  return Math.min(1, row.totalTokens / row.contextTokens);
}

/** The list's empty line under the person's filters (§4.1.1 Filter and sort, Status filter). */
export function emptyLineFor(p: ListPrefs, shown: number): string | null {
  if (shown > 0) {
    return null;
  }
  if (p.status === "snoozed" && p.trunk === null) {
    return "No snoozed conversations.";
  }
  if (p.status === "archived" && p.trunk === null) {
    return "No archived conversations.";
  }
  return filtersDiffer(p) ? "Nothing matches these filters." : null;
}

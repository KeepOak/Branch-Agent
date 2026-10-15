// Settings search: one box at the top of the nav. The index is the row table itself (label, help, card and page) plus
// the pages, Trunks and features the frame passes in. Results are grouped Settings · Go to · Trunks · Features.
import { NAV, PAGES, TOP_PAGES, pageShown, type Level, type PageId } from "./nav";
import { COMING_FROM, ROWS, comingRow, rowHelp, rowLabel, shownLevel, type Row, type UiHints } from "./rows";

export const NOTHING_MATCHES = "Nothing matches. Try another word.";
export const SEARCH_PLACEHOLDER = "Search settings";
const MAX = { pages: 6, rows: 14, trunks: 5, features: 6 } as const;

export type SearchHit =
  | { kind: "page"; id: PageId; label: string; sub: string }
  | { kind: "row"; id: string; label: string; sub: string; page: PageId; card: string; level: Level }
  | { kind: "place"; id: string; label: string; sub?: string }
  | { kind: "trunk"; id: string; label: string; actions: ("open" | "makeDefault")[] }
  | { kind: "newTrunk"; id: "new-trunk"; label: string }
  | { kind: "feature"; id: string; label: string; sub?: string };
export type SearchGroups = { settings: SearchHit[]; goto: SearchHit[]; trunks: SearchHit[]; features: SearchHit[] };

export type SearchInput = {
  level: Level;
  hints: UiHints;
  rows?: Row[];
  /** Places in Branch (the Go to list). */
  places?: { id: string; label: string; sub?: string }[];
  trunks?: { id: string; name: string; isDefault?: boolean }[];
  features?: { id: string; name: string; description?: string }[];
};

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
/** 3: the label starts with the query; 2: the label has every word; 1: the other words have every word; 0: no match. */
function score(q: string, label: string, rest: string): number {
  const ws = words(q);
  if (!ws.length) return 0;
  const l = label.toLowerCase();
  if (l.startsWith(q.trim().toLowerCase())) return 3;
  if (ws.every((w) => l.includes(w))) return 2;
  const all = `${l} ${rest.toLowerCase()}`;
  return ws.every((w) => all.includes(w)) ? 1 : 0;
}
function best<T>(items: T[], rank: (item: T) => number, max: number): T[] {
  return items.map((item, i) => ({ item, s: rank(item), i })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((x) => x.item);
}

/** Search hits for a query, grouped; empty groups when the query is blank. */
export function searchSettings(query: string, input: SearchInput): SearchGroups {
  const out: SearchGroups = { settings: [], goto: [], trunks: [], features: [] };
  const q = query.trim();
  if (!q) return out;
  const { level, hints } = input;
  const ids = [...TOP_PAGES, ...NAV.flatMap((g) => g.pages)].filter((p) => p.id !== "card" && p.id !== "goto" && pageShown(p.id, level)).map((p) => p.id);
  const pageScore = (id: PageId) => score(q, PAGES[id].title, `${PAGES[id].lede} ${PAGES[id].cards.join(" ")}`);
  const rowScore = (r: Row) => score(q, rowLabel(r, hints), `${rowHelp(r, hints) ?? ""} ${r.card} ${PAGES[r.page].title}`);
  const pages = best(ids, pageScore, MAX.pages).map((id) => ({ s: pageScore(id), hit: { kind: "page", id, label: PAGES[id].title, sub: PAGES[id].lede } as SearchHit }));
  // Regular never finds a row that waits for a later update: opening it would only switch the level to show it.
  const rows = best((input.rows ?? ROWS).filter((r) => pageShown(r.page, level) && (level >= COMING_FROM || !comingRow(r))), rowScore, MAX.rows).map((r) => ({ s: rowScore(r), hit: {
    kind: "row", id: r.id, label: rowLabel(r, hints), sub: `${PAGES[r.page].title}${r.card ? ` › ${r.card}` : ""}`, page: r.page, card: r.card, level: shownLevel(r, hints),
  } as SearchHit }));
  // Pages and rows rank together, so Enter opens the closest match; a page wins a tie.
  out.settings = [...pages, ...rows].map((x, i) => ({ ...x, i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.hit);
  out.goto = best(input.places ?? [], (p) => score(q, p.label, p.sub ?? ""), MAX.pages).map((p) => ({ kind: "place", ...p }));
  const trunks = best(input.trunks ?? [], (t) => score(q, t.name, "trunk"), MAX.trunks);
  out.trunks = trunks.map((t): SearchHit => ({ kind: "trunk", id: t.id, label: t.name, actions: t.isDefault ? ["open"] : ["open", "makeDefault"] }));
  if (score(q, "New Trunk", "make create start add") > 0 && input.trunks) out.trunks.push({ kind: "newTrunk", id: "new-trunk", label: "New Trunk" });
  out.features = best(input.features ?? [], (f) => score(q, f.name, `${f.description ?? ""} ${f.id}`), MAX.features).map((f) => ({ kind: "feature", id: f.id, label: f.name, sub: f.description }));
  return out;
}

/** The first hit (what Enter opens), or null. */
export function firstHit(groups: SearchGroups): SearchHit | null {
  return groups.settings[0] ?? groups.goto[0] ?? groups.trunks[0] ?? groups.features[0] ?? null;
}

// Settings › Branch › All features (R1-10 part B, preview `PAGES.featuresP17`): every feature Branch has, half has,
// or plans, from the feature atlas. The atlas is static and ships with the app; it needs no engine call. It's stored as
// atlas/NN.json shards of packed rows [id, area, name, what it does, status, pack], each under 100 KB so GitHub still
// returns a reviewable patch, and loaded together on first open. Rows: {id, a: area, f: name, w: what it does, s: status, p: pack}.

import type { PlaceId } from "../../places-nav/routes";
import type { PageId } from "../settings/nav";

export type AtlasStatus = "in Branch" | "partly built" | "planned";
export type AtlasRow = { id: string; a: string; f: string; w: string; s: AtlasStatus; p: string };
export type StatusFilter = "all" | "in" | "part" | "soon";

/** 7 kinds › 21 areas, in the preview's order. */
export const KINDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["Trunks and how they think", ["agent-loop", "multi-agent", "self-improvement", "research"]],
  ["Tools and connections", ["tools", "integrations", "coding", "browser", "computer-use"]],
  ["Conversations and channels", ["sessions", "chat-apps", "voice", "media"]],
  ["Automations", ["automation"]],
  ["Memory and knowledge", ["memory"]],
  ["Safety and oversight", ["safety", "observability", "ops"]],
  ["Accounts, models and apps", ["models-accounts", "ui-desktop", "ui-mobile-web"]],
];

export const AREA: Readonly<Record<string, string>> = {
  "agent-loop": "How a turn runs", "multi-agent": "Teams of Trunks", "self-improvement": "Learning and self-improvement", research: "Research",
  tools: "Tools", integrations: "Integrations", coding: "Coding", browser: "Browser", "computer-use": "Using the computer",
  sessions: "Conversations and sessions", "chat-apps": "Chat apps", voice: "Voice", media: "Pictures, audio and video",
  automation: "Automations", memory: "Memory", safety: "Safety", observability: "Seeing what happened", ops: "Running Branch",
  "models-accounts": "Models and accounts", "ui-desktop": "The desktop app", "ui-mobile-web": "Phone and web",
};

/** Areas shown only at the Technical level, or while searching. */
export const TECHNICAL_AREAS: ReadonlySet<string> = new Set(["agent-loop", "ops", "observability"]);

/** Where a feature lives: a Settings page (the R1-06 page ids), a place (optionally on a tab), or a conversation. */
export type FeatureHome = { kind: "settings"; page: PageId } | { kind: "place"; place: PlaceId; tab?: string } | { kind: "chat" };

// The preview's HOME table, moved to the new page ids (its OLD2NEW: computer → browser, gateway → remote, usage → privacy,
// self → learning). research and media have no home yet.
export const HOME: Readonly<Record<string, FeatureHome>> = {
  tools: { kind: "place", place: "customize", tab: "Tools" },
  integrations: { kind: "place", place: "customize", tab: "Tools" },
  coding: { kind: "place", place: "customize", tab: "Tools" },
  browser: { kind: "settings", page: "browser" },
  "computer-use": { kind: "settings", page: "browser" },
  "chat-apps": { kind: "settings", page: "chatapps" },
  voice: { kind: "settings", page: "voice" },
  memory: { kind: "place", place: "library", tab: "memory" },
  "models-accounts": { kind: "settings", page: "models" },
  safety: { kind: "settings", page: "permissions" },
  automation: { kind: "place", place: "automations" },
  observability: { kind: "settings", page: "privacy" },
  ops: { kind: "settings", page: "remote" },
  "self-improvement": { kind: "settings", page: "learning" },
  "multi-agent": { kind: "settings", page: "trunks" },
  "agent-loop": { kind: "settings", page: "instructions" },
  "ui-desktop": { kind: "settings", page: "appearance" },
  "ui-mobile-web": { kind: "settings", page: "general" },
  sessions: { kind: "chat" },
};

export const statusWord = (s: AtlasStatus): string => (s === "in Branch" ? "In Branch" : s === "partly built" ? "Partly built" : "Coming");

const FILTER: Readonly<Record<StatusFilter, AtlasStatus | null>> = { all: null, in: "in Branch", part: "partly built", soon: "planned" };

export type ListItem =
  | { kind: "k"; key: string; label: string }
  | { kind: "a"; key: string; area: string; label: string; count: number }
  | { kind: "r"; key: string; row: AtlasRow };

/** Fixed row heights the list is virtualised with: kind 44, area 34, feature 58. */
export const HEIGHT: Readonly<Record<ListItem["kind"], number>> = { k: 44, a: 34, r: 58 };

export type Flat = { items: ListItem[]; offsets: number[]; height: number; shown: number; hidden: number };

/** The list as the preview draws it: kinds › areas › rows, filtered and searched, Technical areas held back. */
export function flatten(rows: readonly AtlasRow[], o: { query: string; filter: StatusFilter; technical: boolean }): Flat {
  const q = o.query.trim().toLowerCase();
  const want = FILTER[o.filter];
  const byArea = new Map<string, AtlasRow[]>();
  for (const row of rows) {
    if (want && row.s !== want) continue;
    if (q && !`${row.f} ${row.w} ${row.id}`.toLowerCase().includes(q)) continue;
    const list = byArea.get(row.a);
    if (list) list.push(row); else byArea.set(row.a, [row]);
  }
  const items: ListItem[] = [];
  let hidden = 0;
  for (const [kind, areas] of KINDS) {
    const inKind: ListItem[] = [];
    for (const area of areas) {
      const found = byArea.get(area) ?? [];
      if (TECHNICAL_AREAS.has(area) && !o.technical && !q) { hidden += found.length; continue; }
      if (!found.length) continue;
      inKind.push({ kind: "a", key: `a:${area}`, area, label: AREA[area] ?? area, count: found.length });
      for (const row of found) inKind.push({ kind: "r", key: row.id, row });
    }
    if (inKind.length) items.push({ kind: "k", key: `k:${kind}`, label: kind }, ...inKind);
  }
  const offsets: number[] = [];
  let y = 0;
  for (const item of items) { offsets.push(y); y += HEIGHT[item.kind]; }
  return { items, offsets, height: y, shown: items.filter((item) => item.kind === "r").length, hidden };
}

/** The items to draw for a scroll position, with 200 px drawn ahead above and below (the preview's paint()). */
export function visibleRange(flat: Flat, top: number, viewport: number, ahead = 200): [number, number] {
  const { items, offsets } = flat;
  let lo = 0;
  let hi = Math.max(0, items.length - 1);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! + HEIGHT[items[mid]!.kind] < top - ahead) lo = mid + 1; else hi = mid;
  }
  const bottom = top + viewport + ahead;
  let end = lo;
  while (end < items.length && offsets[end]! < bottom) end++;
  return [lo, end];
}

export type Counts = { all: number; in: number; part: number; soon: number };
export function countsOf(rows: readonly AtlasRow[]): Counts {
  const c: Counts = { all: rows.length, in: 0, part: 0, soon: 0 };
  for (const row of rows) { if (row.s === "in Branch") c.in++; else if (row.s === "partly built") c.part++; else c.soon++; }
  return c;
}

export const fmt = (n: number) => n.toLocaleString("en-US");

/** Browsing with no search or status filter: what is in Branch leads, Coming follows on the same quiet line, and rows
 *  held back for Technical come last. A search or a filter reads as "N of M features", so the match count is the point. */
export function countLine(flat: Flat, total: number, counts: Counts, browsing: boolean): string {
  const more = flat.hidden ? ` · ${fmt(flat.hidden)} more at the Technical level` : "";
  if (browsing) return `In Branch ${fmt(counts.in)} · Coming ${fmt(counts.soon)}${more}`;
  return `${fmt(flat.shown)} of ${fmt(total)} features${more}`;
}

type PackedRow = readonly [id: string, a: string, f: string, w: string, s: AtlasStatus, p: string];
const shards = import.meta.glob<readonly PackedRow[]>("./atlas/*.json", { import: "default" });

let atlas: Promise<AtlasRow[]> | null = null;
/** The atlas, loaded once on first use (separate chunks, so the window doesn't carry it at start), in shard order. */
export function loadAtlas(): Promise<AtlasRow[]> {
  atlas ??= Promise.all(Object.keys(shards).sort().map((key) => shards[key]!())).then(
    (parts) => parts.flat().map(([id, a, f, w, s, p]) => ({ id, a, f, w, s, p })),
    (error: unknown) => {
      atlas = null;
      throw error;
    },
  );
  return atlas;
}

// Settings › Branch › All features (R1-10 part B, preview `PAGES.featuresP17`): every feature Branch has, half has,
// or plans, from the feature atlas. The atlas is static and ships with the app (atlas.json, loaded on first open);
// it needs no engine call. Rows: {id, a: area, f: name, w: what it does, s: status, p: pack}.

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

/** Where a feature lives: a Settings page (the R1-06 page ids) or a place, optionally on a tab. */
export type FeatureHome = { kind: "settings"; page: string } | { kind: "place"; place: string; tab?: string };

// The preview's HOME table, moved to the new page ids (its OLD2NEW: computer → browser, gateway → remote, usage → privacy,
// self → learning). research and media have no home yet.
export const HOME: Readonly<Record<string, FeatureHome>> = {
  tools: { kind: "place", place: "customize", tab: "tools" },
  integrations: { kind: "place", place: "customize", tab: "tools" },
  coding: { kind: "place", place: "customize", tab: "tools" },
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
  "multi-agent": { kind: "settings", page: "trunksP17" },
  "agent-loop": { kind: "settings", page: "instructions" },
  "ui-desktop": { kind: "settings", page: "appearance" },
  "ui-mobile-web": { kind: "settings", page: "general" },
  sessions: { kind: "place", place: "chat" },
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

/** "N of 4,973 features · M more at the Technical level". */
export function countLine(flat: Flat, total: number): string {
  return `${fmt(flat.shown)} of ${fmt(total)} features${flat.hidden ? ` · ${fmt(flat.hidden)} more at the Technical level` : ""}`;
}

let atlas: Promise<AtlasRow[]> | null = null;
/** The atlas, loaded once on first use (a separate chunk, so the window doesn't carry it at start). */
export function loadAtlas(): Promise<AtlasRow[]> {
  atlas ??= import("./atlas.json").then((m) => m.default, (error: unknown) => {
    atlas = null;
    throw error;
  });
  return atlas;
}

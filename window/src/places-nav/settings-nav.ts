// The Settings page list (DESIGN-SPEC §4.7.0 "Nav per level"), in its exact order.
export type Level = "regular" | "advanced" | "technical";

export type SettingsGroup = { name: string; pages: { id: string; name: string }[] };

const BASE: SettingsGroup[] = [
  {
    name: "General",
    pages: [
      { id: "general", name: "General" },
      { id: "people", name: "People" },
      { id: "appearance", name: "Appearance" },
      { id: "notifications", name: "Notifications" },
    ],
  },
  {
    name: "Your Trunks",
    pages: [
      { id: "instructions", name: "Instructions & personality" },
      { id: "models", name: "Models" },
      { id: "local", name: "On this computer" },
      { id: "accounts", name: "Accounts" },
      { id: "voice", name: "Voice" },
      { id: "chatapps", name: "Chat apps" },
    ],
  },
  {
    name: "Safety",
    pages: [
      { id: "permissions", name: "Permissions" },
      { id: "computer", name: "Computer & browser" },
      { id: "secrets", name: "Saved passwords" },
      { id: "agents", name: "Connected agents" },
    ],
  },
  {
    name: "Data and safety",
    pages: [
      { id: "usage", name: "Data & usage" },
      { id: "backups", name: "Backups" },
      { id: "gateway", name: "Gateway" },
      { id: "self", name: "About Branch" },
      { id: "seasons", name: "Seasons" },
      { id: "updates", name: "Updates & about" },
    ],
  },
];

export const LEVEL_LINES: Record<Level, string> = {
  regular: "The essentials, in plain words.",
  advanced: "Every feature and the fine controls.",
  technical: "File paths, raw keys, launch variables, config and logs.",
};

/** The groups shown at a level: "More" exists only at Advanced (Advanced) and Technical (Advanced, Developer). */
export function settingsGroups(level: Level): SettingsGroup[] {
  if (level === "regular") {
    return BASE;
  }
  const more = [{ id: "advanced", name: "Advanced" }, ...(level === "technical" ? [{ id: "developer", name: "Developer" }] : [])];
  return [...BASE, { name: "More", pages: more }];
}

export function pageName(id: string): string {
  for (const g of settingsGroups("technical")) {
    const found = g.pages.find((p) => p.id === id);
    if (found) {
      return found.name;
    }
  }
  return "";
}

/** The page to show after a level change (§4.7.0 "Level drop"): a page the level hides falls back to General. */
export function pageAtLevel(page: string, level: Level): string {
  return settingsGroups(level).some((g) => g.pages.some((p) => p.id === page)) ? page : "general";
}

/** The lowest level, at or above this one, that shows the page: opening a page the level hides (from settings search,
 *  Find anything or a link) raises the level instead of falling back to General. Unknown pages keep the level. */
export function levelFor(page: string, level: Level): Level {
  const order: Level[] = ["regular", "advanced", "technical"];
  return order.slice(order.indexOf(level)).find((l) => settingsGroups(l).some((g) => g.pages.some((p) => p.id === page))) ?? level;
}

/** Extra words each page answers to (the preview's KEYS_E18), so "dark" finds Appearance. */
const KEYWORDS: Record<string, string> = {
  general: "start startup windows tray projects keyboard shortcuts vim summaries",
  people: "person family child pin invite profile sign in",
  appearance: "dark light moonlight daylight theme themes colour color accent contrast background scene pet font text size width language mirror skin",
  notifications: "quiet hours sound chime days off alerts ping",
  instructions: "soul identity user agents tools sop memory heartbeat files personality prompt",
  models: "chatgpt claude gemini openrouter thinking default model second opinion pictures video budget arena",
  local: "ollama lm studio download install gpu graphics memory runtime local offline",
  accounts: "sign in plan pool order keepoak rotation",
  voice: "microphone mic push to talk wake word dictation speak call meeting",
  chatapps: "telegram whatsapp discord slack chat app bot routing who answers",
  permissions: "lockdown ask first full access mode rules pin app lock pin sandbox",
  computer: "computers browser chrome sandbox sealed box cloud phone lend screen mouse",
  secrets: "passwords bitwarden 1password sign-ins keys tokens",
  usage: "spend cost money usage limits report export import checkpoints keep delete flagged tray",
  backups: "backup back up copy restore git github repository folder schedule daily weekly",
  gateway: "background tray restart engine always on",
  self: "self improve restart doctor check fix roll back",
  seasons: "rings gardener budding memory overnight skills learn improve",
  updates: "version update beta stable remove uninstall about release notes",
  advanced: "memory automations webhooks search skills logs",
  developer: "api address session key language servers debugger playground telemetry",
};

const ORDER: Level[] = ["regular", "advanced", "technical"];
/** The lowest level that shows a page (Advanced for Advanced, Technical for Developer). */
export function pageLevel(id: string): Level {
  return ORDER.find((l) => settingsGroups(l).some((g) => g.pages.some((p) => p.id === id))) ?? "regular";
}

/** A row a page lists for search: its exact title, its section and the level that shows it (0, 1, 2). */
export type SearchRow = { page: string; title: string; sec?: string; group?: string; lv: 0 | 1 | 2; words?: string };
export type SearchHit = { page: { id: string; name: string; lv: 0 | 1 | 2 }; rows: SearchRow[] };
export type SearchGroup = { name: string; hits: SearchHit[] };

/** Pages whose name or keywords match, and rows whose title, section or words match, by group (§4.7.0 Searching).
 *  Every level is searched; a result above the current level says which level shows it. At most 8 rows a page. */
export function searchSettings(query: string, rows: SearchRow[]): SearchGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return settingsGroups("technical")
    .map((g) => ({
      name: g.name,
      hits: g.pages
        .map((p) => {
          const lv = ORDER.indexOf(pageLevel(p.id)) as 0 | 1 | 2;
          const hit = rows.filter((r) => r.page === p.id && `${r.title} ${r.sec ?? ""} ${r.words ?? ""}`.toLowerCase().includes(q)).slice(0, 8);
          const named = p.name.toLowerCase().includes(q) || (KEYWORDS[p.id] ?? "").includes(q);
          return named || hit.length ? { page: { ...p, lv }, rows: hit.map((r) => ({ ...r, lv: Math.max(r.lv, lv) as 0 | 1 | 2 })) } : null;
        })
        .filter((h): h is SearchHit => h !== null),
    }))
    .filter((g) => g.hits.length > 0);
}

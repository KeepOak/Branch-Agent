// Five Settings destinations, with searchable sections and existing deep links kept intact.
export type Level = "regular" | "advanced" | "technical";

export type SettingsGroup = { name: string; pages: { id: string; name: string }[] };

const BASE: SettingsGroup[] = [
  {
    name: "General",
    pages: [
      { id: "general", name: "General" },
      { id: "people", name: "People" },
      { id: "devices", name: "Devices & apps" },
      { id: "appearance", name: "Appearance" },
      { id: "notifications", name: "Notifications" },
    ],
  },
  {
    name: "Trunks",
    pages: [
      { id: "instructions", name: "Instructions & personality" },
      { id: "models", name: "Models" },
      { id: "local", name: "On this computer" },
      { id: "accounts", name: "Accounts" },
      { id: "voice", name: "Voice" },
      { id: "chatapps", name: "Chat apps" },
      { id: "helpers", name: "Helpers" },
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
    name: "Data",
    pages: [
      { id: "usage", name: "Data & usage" },
      { id: "backups", name: "Backups" },
      { id: "seasons", name: "Memory cleanup" },
    ],
  },
  {
    name: "About",
    pages: [
      { id: "updates", name: "Updates" },
      { id: "self", name: "Version & self-check" },
      { id: "gateway", name: "Gateway" },
    ],
  },
];

/** Pages that change setup (§4.7.0): config.patch needs operator.admin, so without it their rows grey. */
export const SETUP_PAGES: readonly string[] = ["general", "models", "local", "accounts", "chatapps", "permissions", "computer", "usage", "seasons", "updates", "advanced", "developer"];

export const LEVEL_LINES: Record<Level, string> = {
  regular: "The essentials, in plain words.",
  advanced: "Every feature and the fine controls.",
  technical: "File paths, raw keys, launch variables, config and logs.",
};

/** Detail levels add sections inside About, never another top-level destination. */
export function settingsGroups(level: Level): SettingsGroup[] {
  if (level === "regular") {
    return BASE;
  }
  const more = [{ id: "advanced", name: "Advanced" }, ...(level === "technical" ? [{ id: "developer", name: "Developer" }] : [])];
  return BASE.map((g) => g.name === "About" ? { ...g, pages: [...g.pages, ...more] } : g);
}

/** Models, Accounts and local setup are one section rather than three competing destinations. */
export function sectionId(page: string): string {
  return page === "models" || page === "local" ? "accounts" : page;
}

export function settingsSections(group: SettingsGroup): { id: string; name: string }[] {
  return group.pages.filter((p) => p.id !== "models" && p.id !== "local")
    .map((p) => p.id === "accounts" ? { ...p, name: "Models & accounts" } : p);
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
  devices: "everywhere devices phone iphone android mac windows terminal pair pairing qr code keepoak.com browser widget snippet",
  appearance: "dark light moonlight daylight theme themes colour color accent contrast background scene pet font text size width language mirror skin",
  notifications: "quiet hours sound chime days off alerts ping",
  instructions: "soul identity user agents tools sop memory heartbeat files personality prompt",
  models: "chatgpt claude gemini openrouter thinking default model second opinion pictures video budget arena",
  local: "ollama lm studio download install gpu graphics memory runtime local offline",
  accounts: "sign in plan pool order keepoak rotation",
  voice: "microphone mic push to talk wake word dictation speak call meeting",
  chatapps: "telegram whatsapp discord slack chat app bot routing who answers",
  helpers: "specialists helpers subagents sub-agents teamwork swarm router lead parallel teams debate built in fleet",
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
export function searchSettings(query: string, rows: SearchRow[], hiddenPages: readonly string[] = []): SearchGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return settingsGroups("technical")
    .map((g) => ({
      name: g.name,
      hits: g.pages
        .filter((p) => !hiddenPages.includes(p.id))
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

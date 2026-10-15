// Settings nav and page structure, ported from the approved R1 preview (item 36: NAV and PG). Page ids are the new
// ids; OLD_IDS sends the preview's and Classic's old ids to their new page so old deep links still land.

/** How much to show: 0 Regular, 1 Advanced, 2 Technical. */
export type Level = 0 | 1 | 2;

export type PageId =
  | "card"
  | "goto"
  | "general"
  | "appearance"
  | "notifications"
  | "who"
  | "trunks"
  | "instructions"
  | "customize"
  | "seedbank"
  | "memory"
  | "autos"
  | "voice"
  | "chatapps"
  | "accounts"
  | "models"
  | "permissions"
  | "signins"
  | "privacy"
  | "devices"
  | "browser"
  | "coding"
  | "remote"
  | "history"
  | "learning"
  | "updates"
  | "features"
  | "developer";

export type NavPage = { id: PageId; title: string; icon: string; minLevel?: Level };
export type NavGroup = { title: string; pages: NavPage[] };

/** The two rows above the groups. */
export const TOP_PAGES: NavPage[] = [
  { id: "card", title: "Your card", icon: "person" },
  { id: "goto", title: "Go to", icon: "compass" },
];
/** Sub-line under Go to. */
export const GOTO_SUB = "Overview, Canopy, Inbox…";

export const NAV: NavGroup[] = [
  { title: "You", pages: [
    { id: "general", title: "General", icon: "gear" },
    { id: "appearance", title: "Appearance", icon: "palette" },
    { id: "notifications", title: "Notifications", icon: "bell" },
    { id: "who", title: "Who uses Branch", icon: "users" },
  ] },
  { title: "Your Trunks", pages: [
    { id: "trunks", title: "Trunks", icon: "branch" },
    { id: "instructions", title: "Instructions & personality", icon: "edit" },
    { id: "customize", title: "Customize", icon: "sliders" },
    { id: "seedbank", title: "Seedbank", icon: "seed" },
    { id: "memory", title: "Memory & documents", icon: "brain" },
    { id: "autos", title: "Automations", icon: "clock" },
  ] },
  { title: "Talking", pages: [
    { id: "voice", title: "Voice & calls", icon: "mic" },
    { id: "chatapps", title: "Chat apps", icon: "chat" },
  ] },
  { title: "Accounts & models", pages: [
    { id: "accounts", title: "Accounts & usage", icon: "users" },
    { id: "models", title: "Models", icon: "spark" },
  ] },
  { title: "Permissions & safety", pages: [
    { id: "permissions", title: "Permissions", icon: "shield" },
    { id: "signins", title: "Sign-ins & keys", icon: "key" },
    { id: "privacy", title: "Privacy & data", icon: "lock" },
  ] },
  { title: "Computers", pages: [
    { id: "devices", title: "Devices", icon: "monitor" },
    { id: "browser", title: "Browser & screen", icon: "globe" },
    { id: "coding", title: "Coding", icon: "code" },
    { id: "remote", title: "Remote access", icon: "remote" },
  ] },
  { title: "Branch", pages: [
    { id: "history", title: "History & backups", icon: "retry" },
    { id: "learning", title: "Learning & self-updates", icon: "leaf" },
    { id: "updates", title: "Updates & about", icon: "up" },
    { id: "features", title: "All features", icon: "star" },
    { id: "developer", title: "Developer", icon: "term", minLevel: 2 },
  ] },
];

export type PageSpec = { title: string; lede: string; cards: string[] };

/** Each page: its title, lede and its cards in order (one glass card each; an untitled card is ""). */
export const PAGES: Record<PageId, PageSpec> = {
  card: { title: "Your card", lede: "How people see you in Branch: your photo, name, role, computers and teams.", cards: ["Your card"] },
  goto: { title: "Go to", lede: "Every place in Branch, one tap away.", cards: [""] },
  general: { title: "General", lede: "How Branch starts, how you write to it, and how conversations behave.", cards: ["Pinned", "Show agents’ work", "Starting up", "Projects", "Keyboard", "Writing", "The conversation", "Summaries of older turns", "History repair", "Waiting line", "Clipboard history", "Quick ask", "Controllers", "Cover the screen"] },
  appearance: { title: "Appearance", lede: "How Branch looks: theme, glass, background, the pet and the list.", cards: ["Theme", "Background", "Reading", "The pet", "Characters", "What’s shown", "The list", "Window", "Tray", "Language", "Celebrations", "Make it yours"] },
  notifications: { title: "Notifications", lede: "When Branch tells you something, and how.", cards: ["Tell me when…", "Quiet", "When work stalls", "Live activity", "Kinds of notice", "Sorting", "This PC", "Send events to a web address", "Web Push"] },
  who: { title: "Who uses Branch", lede: "The people who use Branch on this computer, and how they sign in.", cards: ["People", "Records", "Signing in to Branch"] },
  trunks: { title: "Trunks", lede: "Your Trunks, groups and grafted agents: make one the default, change it, package it or remove it.", cards: ["", "Defaults for every Trunk", "Trunks’ own databases"] },
  instructions: { title: "Instructions & personality", lede: "What every Trunk knows about you, and how it writes.", cards: ["Just about you", "Project instructions", "Kits", "How replies are written", "Prompts behind quick actions", "What goes with every message", "Rules"] },
  customize: { title: "Customize", lede: "Toolsets, connectors, skills, plugins, command-line tools, agents and prompts, for every Trunk or one.", cards: ["", "Saved prompts", "Tools and skills", "Skills", "Plugins", "Helpers and other agents", "What it can do"] },
  seedbank: { title: "Seedbank", lede: "Agents, skills, connectors, plugins, command-line tools and toolsets shared by people who use Branch.", cards: [""] },
  memory: { title: "Memory & documents", lede: "What Trunks remember, what they read, and your Library.", cards: ["Memory", "Recall and memory files", "Documents it reads", "Library"] },
  autos: { title: "Automations", lede: "Routines that run on their own: when, how, and what they may do.", cards: ["Automations", "Steps and nudges"] },
  voice: { title: "Voice & calls", lede: "Talking to Branch, hearing it back, live voice and calls.", cards: ["Talking", "Listening", "Speaking back", "Live voice", "Calls & meetings", "Voice services"] },
  chatapps: { title: "Chat apps", lede: "Telegram, WhatsApp, Slack and 71 more: who answers, who may message, and how replies arrive.", cards: ["Your chat apps", "Who answers", "Who may message", "How replies look & arrive", "Groups", "Commands", "Approvals & what Trunks may do", "Each app", "Limits & quiet"] },
  accounts: { title: "Accounts & usage", lede: "Your model accounts, what each has left, the order Branch uses them in, and your keepoak.com account.", cards: ["Usage by account", "Linked accounts", "Order Branch uses them in", "When one runs out", "Which account goes next", "Your own accounts", "Coding apps on this computer", "Where each sign-in comes from", "Terms"] },
  models: { title: "Models", lede: "Which models answer, for which jobs, with what budget, and how turns run.", cards: ["Defaults and picking models", "Models for smaller jobs", "Compare models", "Testing models", "Mixtures and savings", "Decision models", "Pictures, video and music", "Finishing well", "Budgets", "Retries and timeouts", "Per connection", "How turns run", "How turns are planned", "Try early", "Attachments", "Each model"] },
  permissions: { title: "Permissions", lede: "What Trunks may do without asking, what they must ask for, and what they may never do.", cards: ["Mode", "Lockdown", "Without asking", "Rules for each tool and folder", "Commands by default", "Checks before anything runs", "Approvals", "Guards", "Money", "What each connector may do", "Isolation and sandbox", "Network and sandbox", "Company policy", "Privacy"] },
  signins: { title: "Sign-ins & keys", lede: "Passwords and keys Branch may use, where they come from, and how narrow they are.", cards: ["Branch may fill", "Where passwords come from", "Keys Branch holds", "Narrow keys"] },
  privacy: { title: "Privacy & data", lede: "What Branch keeps, for how long, and how to take it with you.", cards: ["Your data", "Keeping things", "Archived & Recently deleted", "Conversations", "Moving in and out", "Flagged replies", "Money and keeping"] },
  devices: { title: "Devices", lede: "Every computer, phone and place Branch runs, and which Trunk may use which.", cards: ["Everywhere", "Computers they may use", "Which Trunk uses which", "Who is connected now", "Cloud computers", "Phones and small devices", "Let Trunks use this computer", "Runtimes", "Running models here", "More places to run work", "Where scripts run"] },
  browser: { title: "Browser & screen", lede: "How Trunks use a computer’s screen and its browser.", cards: ["On a computer", "Using the screen", "The browser", "How it browses", "Sites", "Page cleaners", "What it hands to you", "Saved flows", "Your own browser", "Logbook"] },
  coding: { title: "Coding", lede: "Code, git, checks and the coding apps Trunks work with.", cards: ["Code", "What it knows about a project", "Git", "Checks before done", "Big coding tasks", "Suggestions while you edit", "Coding apps", "Code and commits", "Commands", "Files"] },
  remote: { title: "Remote access", lede: "Keep Branch running, and reach it from your other computers, your phone and scripts.", cards: ["Keep Branch running", "Reach", "How it’s reached", "What it has been doing", "Another computer", "Connection", "Exposure", "Limits", "App previews", "From scripts", "Never break"] },
  history: { title: "History & backups", lede: "The whole undo story in one place: backups, snapshots, rolling back and a copy of your setup.", cards: ["Backups", "Snapshots", "Roll back, see the change, undo", "A copy of your setup"] },
  learning: { title: "Learning & self-updates", lede: "What Branch may learn and change about itself, and how it keeps a change.", cards: ["What Branch may change about itself", "Learning", "Working on its own code", "What it may fix by itself", "Gardener", "Budding", "Keeping a change", "Extras fetched when first used", "How the engine runs", "Settings you can talk to"] },
  updates: { title: "Updates & about", lede: "Updating Branch, your other devices, achievements, shortcuts and the guide.", cards: ["Updating", "Branch on your other devices", "Before you install", "Reports", "In your editors and notes", "Achievements", "Shortcuts, guide & apps", "About", "Privacy", "Remove Branch"] },
  features: { title: "All features", lede: "Every feature Branch has, is building, or plans, with where to find it.", cards: [""] },
  developer: { title: "Developer", lede: "For building on Branch: addresses, links, logs, hooks and the settings file.", cards: ["Build on Branch", "Local address", "branch:// links", "Editors and other apps", "Let other assistants use Branch", "Runs and traces", "Run without the window", "From a terminal", "Settings file", "System", "Troubleshooting", "Help with code", "Widgets", "Memory and automations, for scripts", "Tools", "Logs", "Docker", "Hooks", "Network", "Health", "Everything else"] },
};

/** Old page ids (the preview's and Classic's) and the page each one now lives on. */
const OLD_IDS: Record<string, PageId> = {
  people: "who", gateway: "remote", usage: "privacy", seasons: "learning", backupsT5: "history", self: "learning",
  achievements: "updates", branchP17: "updates", advanced: "general", computer: "browser", secrets: "signins",
  placesP17: "goto", graftsT5: "customize", czP17: "customize", trunksP17: "trunks", seedbankP17: "seedbank",
  featuresP17: "features", local: "devices",
};

/** The R1 page a route id belongs to: a new or old id on its page, or the id itself when R1 has no page for it (a Classic page). */
export function r1PageFor(id: string): string {
  return Object.hasOwn(PAGES, id) || Object.hasOwn(OLD_IDS, id) ? pageFor(id) : id;
}

/** The page a link or saved id opens: a new id as is, an old id on its new page, anything else on General. */
export function pageFor(id: string | null | undefined): PageId {
  if (id && Object.hasOwn(PAGES, id)) return id as PageId;
  return id && Object.hasOwn(OLD_IDS, id) ? OLD_IDS[id] : "general";
}

const ALL_PAGES: NavPage[] = [...TOP_PAGES, ...NAV.flatMap((g) => g.pages)];
const BY_ID = new Map(ALL_PAGES.map((page) => [page.id, page]));
function pagesOf(...ids: PageId[]): NavPage[] {
  return ids.map((id) => BY_ID.get(id)!);
}

/** Regular's four pages. Every page except Developer lives in one of them.
 *  Developer stays on Technical, inside NAV's Branch group. The first page in a group is what that
 *  Regular page shows. The others stay reachable under an Advanced section on that page. */
export const REGULAR_GROUPS: NavGroup[] = [
  { title: "General", pages: pagesOf("general", "card", "goto", "appearance", "notifications", "who", "trunks", "instructions", "customize", "seedbank", "memory", "autos", "voice", "chatapps") },
  { title: "Computer", pages: pagesOf("devices", "browser", "coding", "remote", "permissions") },
  { title: "Usage", pages: pagesOf("accounts", "models", "privacy", "signins") },
  { title: "Updates", pages: pagesOf("updates", "history", "learning", "features") },
];

/** The Regular page a settings page belongs to, or none (Developer). */
export function regularHub(id: PageId): NavGroup | undefined {
  return REGULAR_GROUPS.find((g) => g.pages.some((p) => p.id === id));
}

/** The sidebar for a level. Regular is the four pages. Advanced and Technical keep the full nav. */
export function navAt(level: Level): { top: NavPage[]; groups: NavGroup[] } {
  if (level === 0) {
    return { top: REGULAR_GROUPS.map((g) => ({ ...g.pages[0], title: g.title })), groups: [] };
  }
  return { top: TOP_PAGES, groups: NAV };
}

/** A page's nav entry. */
export const navPage = (id: PageId): NavPage | undefined => ALL_PAGES.find((p) => p.id === id);
/** Whether a page is in the nav at this level (Developer needs Technical). */
export const pageShown = (id: PageId, level: Level): boolean => (navPage(id)?.minLevel ?? 0) <= level;

/** The "How much to show" choices and the line under the control for each. */
export const LEVELS: { v: Level; label: string; line: string }[] = [
  { v: 0, label: "Regular", line: "The essentials, in plain words." },
  { v: 1, label: "Advanced", line: "Every feature and the fine controls." },
  { v: 2, label: "Technical", line: "File paths, raw keys, launch variables, config and logs." },
];

/** The engine call a section with no rows yet waits for (R1-10; HANDOFF R1-06 "Engine calls": a row with no key is
 *  Coming with need = the method it waits for). A card listed here overrides its page; any other section on a page
 *  waits for config.patch, the call that will save its keys. */
const PAGE_NEED: Partial<Record<PageId, string>> = {
  card: "users.setDisplayName", appearance: "users.prefs.set", who: "users.list", trunks: "agents.list", instructions: "agents.files.set",
  customize: "tools.catalog", seedbank: "plugins.catalog.browse", memory: "memory.status", autos: "cron.list", voice: "talk.config",
  chatapps: "channels.status", accounts: "usage.status", models: "models.list", permissions: "exec.approvals.get", signins: "secrets.store.list",
  devices: "node.list", coding: "projects.list", history: "backup.status", learning: "skills.proposals.list", updates: "update.status",
};
const CARD_NEED: Record<string, string> = {
  "notifications/Web Push": "push.web.subscribe", "trunks/Defaults for every Trunk": "config.patch",
  "trunks/Trunks’ own databases": "config.patch", "customize/Skills": "skills.search", "customize/Plugins": "plugins.list",
  "customize/Helpers and other agents": "agents.list", "voice/Speaking back": "tts.status", "accounts/Usage by account": "usage.cost",
  "permissions/Mode": "config.patch", "privacy/Archived & Recently deleted": "sessions.list", "history/Snapshots": "worktrees.list",
  "developer/Logs": "logs.tail", "developer/Hooks": "hooks.status", "developer/Health": "diagnostics.stability",
};
export const sectionNeed = (page: PageId, card: string): string => CARD_NEED[`${page}/${card}`] ?? PAGE_NEED[page] ?? "config.patch";

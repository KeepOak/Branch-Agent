// Settings › Accounts & usage: the rows of the R1 Accounts page, in the approved preview's cards, order and words
// (preview.html PG accounts, item 36, rendered at Regular, Advanced and Technical): Usage by account, Linked accounts,
// Order Branch uses them in, When one runs out, Which account goes next, Your own accounts (with your keepoak.com
// account and the finer rows at Advanced), Coding apps on this computer, Where each sign-in comes from (Technical) and
// Terms. Ported from the Classic Accounts and Data & usage pages (places/settings/set1/accounts*.tsx, coding-apps.tsx,
// own-accounts.tsx, GitHubSettings.tsx, set2/usage.tsx). Every working Classic control works on a list the engine
// reports, so it is a "slot" row: the page draws it with Classic's own logic on the same engine calls
// (accounts-live.tsx, plugged.ts), and nothing working is left behind (#976). A row with no key is Coming in its own
// words (R1-10).
import { COMING_REASON } from "../../../glass/coming-registry";
import type { Level } from "../nav";
import type { Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[]; bare?: true; fallback?: unknown };
const coming = (id: string, card: string, label: string, need: string, reason: string = COMING_REASON, extra: Extra = {}): Row =>
  ({ id, page: "accounts", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason } });
/** A row the page draws itself (accounts-live.tsx), making these calls. */
const slot = (id: string, card: string, label: string, calls: string[], extra: Extra = {}, reason = `${label} comes in a later update.`): Row =>
  ({ id, page: "accounts", card, label, level: 0, control: "custom", ...extra, source: { kind: "slot", calls, reason } });

const USAGE = "Usage by account";
const LINKED = "Linked accounts";
const ORDER = "Order Branch uses them in";
const OUT = "When one runs out";
const NEXT = "Which account goes next";
const OWN = "Your own accounts";
const APPS = "Coding apps on this computer";
const SOURCES = "Where each sign-in comes from";
const STATUS = "models.authStatus";
const ORDER_SET = "models.authOrderSet";
const DETECT = "branch.setup.detect";
const ADD = [STATUS, DETECT, "models.authLogin", "models.authSetApiKey", ORDER_SET];
const GITHUB = ["tools.github.status", "tools.github.authorize.start", "tools.github.authorize.poll", "tools.github.authorize.cancel", "tools.github.configure"];
/** Said under each linked account in the preview. */
const OVERVIEW = "Overview shows a card for each one you link.";

/** R1-10: each Coming reason names its thing; the bare fallback becomes "<its label> comes in a later update.". */
const named = (row: Row): Row => {
  const src = row.source;
  if ((src.kind === "coming" || src.kind === "slot") && src.reason === COMING_REASON) return { ...row, source: { ...src, reason: `${row.label} comes in a later update.` } };
  return row;
};

const ROWS_AS_DRAWN: Row[] = [
  // Usage by account: what Branch spent (7 / 30 / 90 days, Open the report), what each account has left, then the rows.
  slot("accounts.usage.spend", USAGE, "What Branch spent", ["sessions.usage"], { bare: true }),
  slot("accounts.usage.list", USAGE, "Usage by account", ["usage.status", STATUS], { bare: true }),
  slot("accounts.usage.ring", USAGE, "The ring bottom right", [], { help: "The connection used next, how much of its window is left, and when it refills." }),
  slot("accounts.usage.save-progress", USAGE, "Offer to save progress at 95%", ["users.prefs.set"], { help: "It only asks, once per connection per window, and never for an estimate." }),
  coming("accounts.usage.ask", USAGE, "Asking a service what is left", "engine: a switch for asking each service what is left (always on today)", "Asking a service what is left comes in a later update.",
    { help: "Only OpenRouter documents a way to ask. Subscriptions are never asked.", control: "toggle", fallback: true }),
  { id: "accounts.usage.tray", page: "accounts", card: USAGE, label: "Show usage in the tray", help: "A small ring by the clock opens the same list.", level: 0, control: "toggle",
    source: { kind: "desktop", name: "trayUsage" }, fallback: false },

  // Linked accounts: GitHub (live, Classic's connection), then the three the preview lists, Coming.
  slot("accounts.github.connection", LINKED, "GitHub", GITHUB, { help: OVERVIEW }),
  slot("accounts.github.permissions", LINKED, "Permissions", ["tools.github.status"], { level: 1 }),
  slot("accounts.linked.gmail", LINKED, "Gmail", ["engine: linking Gmail for Overview"], { help: OVERVIEW }, "Linking Gmail comes in a later update."),
  slot("accounts.linked.calendar", LINKED, "Google Calendar", ["engine: linking Google Calendar for Overview"], { help: `Coming to Overview. ${OVERVIEW}` }, "Linking Google Calendar comes in a later update."),
  slot("accounts.linked.drive", LINKED, "Google Drive", ["engine: linking Google Drive for Overview"], { help: OVERVIEW }, "Linking Google Drive comes in a later update."),

  // Order Branch uses them in: the status line, Classic's list of accounts with Move up and its ⋯ menu, and Select accounts.
  slot("accounts.order.list", ORDER, "Your accounts, in order", [STATUS, ORDER_SET, "models.probe", "models.authLogout"],
    { help: "Move one up, or open its ⋯ menu to test it, put it first or sign out." }),
  slot("accounts.order.add", ORDER, "Add an account", ADD, { help: "Or another account of a service you use." }),
  slot("accounts.order.test", ORDER, "Test it", [STATUS, "models.probe"], { help: "Checks that an account answers." }),
  slot("accounts.order.answer-first", ORDER, "Answer first", [STATUS, ORDER_SET], { help: "Puts an account first for its service." }),
  coming("accounts.order.rename", ORDER, "Rename", "engine: a way to rename an account", "Renaming an account comes in a later update."),
  coming("accounts.order.which-trunks", ORDER, "Which Trunks use it", "window: each Trunk's own order (models.authStatus with agentId) per account", "Choosing which Trunks use an account comes in a later update."),
  slot("accounts.order.sign-out", ORDER, "Sign out", [STATUS, "models.authLogout"], { help: "Signs Branch out of one account." }),
  slot("accounts.order.select", ORDER, "Select accounts", [STATUS, ORDER_SET, "models.authLogout"], { help: "Move several to the top, or sign out of them.", level: 1 }),
  coming("accounts.order.pause", ORDER, "Pause", "engine: a way to pause an account", "Pausing an account comes in a later update.", { level: 1 }),

  // When one runs out
  coming("accounts.out.next", OUT, "Move to the next account in the list", "engine: a switch for moving between accounts (Branch always moves on today)", COMING_REASON,
    { help: "Only between accounts you own and pay for, within each provider’s terms. No account’s allowance is shared with another person.", control: "toggle", fallback: true }),
  slot("accounts.out.this-computer", OUT, "Fall back to this computer", ["models.list", "config.get", "config.patch"]),

  // Which account goes next (Technical): In order or Take turns per service.
  slot("accounts.next.mode", NEXT, "Which account goes next", [STATUS, ORDER_SET], { help: "The first account with room left, as listed above.", level: 2 }),

  // Your own accounts: yours, Add your own account and your keepoak.com account; at Advanced the finer rows.
  slot("accounts.own.list", OWN, "Your own accounts", ["users.listModelAccounts", "users.unlinkAuthProfile"],
    { help: "Accounts only you use. New conversations you start prefer the one you pick; the household’s order still applies when it runs out. This isn’t a billing promise." }),
  slot("accounts.own.add", OWN, "Add your own account", ["users.listModelAccounts", "users.selectModelAccount"]),
  slot("accounts.keepoak.connect", OWN, "Your keepoak.com account", ["engine: a keepoak.com sign-in"], { help: "Have a KeepOak computer or a team on keepoak.com? Connect it once." },
    "keepoak.com has no sign-in Branch can use yet."),
  slot("accounts.more.each-trunk", OWN, "Which account each Trunk uses", ["agents.list", STATUS, ORDER_SET],
    { help: "A Trunk with its own account follows that account’s order and limits. Helpers keep the one their Trunk had.", level: 1 }),
  coming("accounts.more.helpers-keep", OWN, "Helpers keep their account", "engine: a setting for helpers keeping their account", COMING_REASON,
    { help: "Through a pause or a restart, a helper keeps the exact account it started with.", level: 1, control: "toggle" }),
  coming("accounts.more.by-task", OWN, "Pick by what the task needs", "engine: a setting for picking an account by what the task needs", COMING_REASON,
    { help: "A task that needs pictures or a long room gets an account that has it.", level: 1, control: "toggle" }),
  slot("accounts.more.fallback-keys", OWN, "Fallback keys", [], { help: "One service can hold several keys; a rate-limited key rests while the next one works.", level: 1 }),
  slot("accounts.more.resting", OWN, "Resting now", [STATUS], { help: "A limit benches an account only for that model.", level: 1 }),
  coming("accounts.more.request-log", OWN, "Which sign-in each request used", "engine: a log of which sign-in each request used", COMING_REASON,
    { help: "Key or sign-in, and which account; never the key itself.", level: 1 }),
  coming("accounts.more.organisation", OWN, "Organisation", "engine: an organisation setting for accounts in more than one", COMING_REASON,
    { help: "For accounts in more than one organisation: who is billed.", level: 1, control: "select", options: [{ v: "personal", label: "Personal" }] }),
  coming("accounts.more.customer-chatgpt", OWN, "A customer’s ChatGPT plan on a KeepOak computer", "engine: a setting for a customer's own ChatGPT sign-in on a computer KeepOak manages", COMING_REASON,
    { help: "Only with that customer’s own sign-in on it. Off until you choose.", level: 1, control: "toggle" }),

  // Coding apps on this computer: Codex runs through the engine's codex plugin; the others follow their own sign-in.
  slot("accounts.apps.claude", APPS, "Claude Code", [DETECT, "usage.status"], { help: "Follows Claude Code’s own sign-in on this computer." }),
  slot("accounts.apps.codex", APPS, "Codex", [DETECT, "config.get", "config.patch"], { help: "Turn it on to use Codex’s models. Turning it on doesn’t sign you in." }),
  slot("accounts.apps.gemini", APPS, "Gemini CLI", [DETECT], { help: "Follows Gemini CLI’s own sign-in on this computer." }),
  slot("accounts.apps.check", APPS, "Check again", [DETECT], { help: "Looks for the coding apps on this computer again." }),

  // Where each sign-in comes from (Technical): each service's sign-ins, then the finer rows.
  slot("accounts.sources.each", SOURCES, "Where each sign-in comes from", [STATUS], { level: 2 }),
  coming("accounts.tech.command", SOURCES, "A command that makes a sign-in", "engine: a setting for a command whose output is a service's key", COMING_REASON,
    { help: "For a service whose key comes from a program of yours. Its output is used as the key.", level: 2, control: "text" }),
  coming("accounts.tech.build-server", SOURCES, "On a build server, sign in with", "engine: a setting for how a build server signs in", COMING_REASON,
    { level: 2, control: "segmented", options: [{ v: "token", label: "A personal token" }, { v: "identity", label: "The server’s own identity" }] }),
  coming("accounts.tech.editor", SOURCES, "Accept sign-ins from your editor", "engine: a setting for borrowing an editor's sign-in", COMING_REASON,
    { help: "An editor or kit already signed in can lend that sign-in.", level: 2, control: "toggle" }),
  slot("accounts.tech.identity", SOURCES, "This Branch’s identity", ["gateway.identity.get"], { help: "Signs Branch’s calls to other services and computers.", level: 2 }),
  coming("accounts.tech.gateway", SOURCES, "Sign-ins through the Gateway", "engine: a switch for Gateway-kept sign-ins (always on today)", COMING_REASON,
    { help: "A service that asks for it signs in through the Gateway, which keeps the refreshed sign-in.", level: 2, control: "toggle", fallback: true }),
  coming("accounts.tech.bring-in", SOURCES, "Settings from another Branch", "engine: a way to bring in model settings and keys from another Branch", COMING_REASON,
    { help: "Bring in a saved model setup, keys and connectors from a Branch on another computer.", level: 2 }),
  coming("accounts.tech.in-step", SOURCES, "Keep service settings in step on my devices", "engine: a setting for keeping service settings in step across devices", COMING_REASON,
    { help: "Not keys: those stay on each computer.", level: 2, control: "toggle" }),
  slot("accounts.tech.hub", SOURCES, "Use a model from a hub for one run", [], { level: 2 }),
  coming("accounts.tech.region", SOURCES, "Region", "engine: a region setting", COMING_REASON,
    { help: "Changes which services and mirrors come first.", level: 2, control: "select", options: [{ v: "auto", label: "Automatic" }, { v: "world", label: "Worldwide" }, { v: "cn", label: "China" }] }),
  coming("accounts.tech.install", SOURCES, "Install a service’s package when needed", "engine: a setting for installing a service's package when needed", COMING_REASON,
    { help: "Otherwise it says which one to install.", level: 2, control: "toggle" }),
  slot("accounts.tech.own-folder", SOURCES, "Each account keeps its own folder", [], { help: "A coding app’s sign-in for one account never mixes with another’s.", level: 2 }),
  coming("accounts.tech.point-apps", SOURCES, "Point your coding apps at Branch", "engine: a way to write one model service into each coding app's settings", COMING_REASON,
    { help: "Writes the service you pick into each coding app’s own settings, so they all use the same one.", level: 2 }),

  // Terms (Advanced)
  coming("accounts.terms.lines", "Terms", "Each service’s terms", "engine: each service's terms, listed", "Each service’s terms come in a later update.",
    { help: "Branch only signs in to a plan the way its service allows, and says so.", level: 1 }),
];

export const ACCOUNTS_ROWS: Row[] = ROWS_AS_DRAWN.map(named);

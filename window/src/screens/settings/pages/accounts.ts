// Settings › Accounts & usage: the rows of the R1 Accounts page, ported from the Classic Accounts page
// (places/settings/set1/accounts*.tsx, coding-apps.tsx, own-accounts.tsx and GitHubSettings.tsx). Every working Classic
// control works on a list the engine reports (models.authStatus, branch.setup.detect, the person's own accounts, the
// GitHub connection), so it is a "slot" row: the page draws it with Classic's own logic on the same engine calls
// (accounts-live.tsx, plugged.ts), and nothing working is left behind (#976). Codex's switch stays on the engine key
// Classic saves (plugins.entries.codex.enabled). What Classic itself greys (Rename, Pause, keepoak.com, the settings
// Branch has no key for) stays a Coming row naming the call it waits for (#952).
import type { Level } from "../nav";
import type { Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[]; ownerLevel?: boolean };
const coming = (id: string, card: string, label: string, need: string, reason: string, extra: Extra = {}): Row =>
  ({ id, page: "accounts", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason } });
/** A row the page draws itself (accounts-live.tsx), making these calls. */
const slot = (id: string, card: string, label: string, calls: string[], extra: Extra = {}): Row =>
  ({ id, page: "accounts", card, label, level: 0, control: "custom", ...extra, source: { kind: "slot", calls, reason: `${label} comes with the R1 Accounts page.` } });

const ORDER = "Order Branch uses them in";
const OUT = "When one runs out";
const NEXT = "Which account goes next";
const OWN = "Your own accounts";
const APPS = "Coding apps on this computer";
const MORE = "Accounts, more";
const TECH = "Accounts, technical";
/** Classic greys these with "Branch has no setting for this yet." */
const NO_KEY = "Branch has no setting for this yet.";
const STATUS = "models.authStatus";
const ORDER_SET = "models.authOrderSet";
const DETECT = "branch.setup.detect";
const ADD = [STATUS, DETECT, "models.authLogin", "models.authSetApiKey", ORDER_SET];
const GITHUB = ["tools.github.status", "tools.github.authorize.start", "tools.github.authorize.poll", "tools.github.authorize.cancel", "tools.github.configure"];

export const ACCOUNTS_ROWS: Row[] = [
  // Order Branch uses them in: the status line, Classic's list of accounts with Move up and its ⋯ menu, and Select accounts.
  slot("accounts.order.list", ORDER, "Your accounts, in order", [STATUS, ORDER_SET, "models.probe", "models.authLogout"],
    { help: "Branch never sees your passwords. Each account is billed by its own site." }),
  slot("accounts.order.add", ORDER, "Add an account", ADD, { help: "Or another account of a service you use." }),
  slot("accounts.order.test", ORDER, "Test it", [STATUS, "models.probe"], { help: "Checks that an account answers." }),
  slot("accounts.order.answer-first", ORDER, "Answer first", [STATUS, ORDER_SET], { help: "Puts an account first for its service." }),
  coming("accounts.order.rename", ORDER, "Rename", "engine: a way to rename an account", "Branch can’t rename an account yet."),
  coming("accounts.order.which-trunks", ORDER, "Which Trunks use it", "window: each Trunk's own order (models.authStatus with agentId) per account", "Every Trunk uses this account, in this order."),
  slot("accounts.order.sign-out", ORDER, "Sign out", [STATUS, "models.authLogout"], { help: "Signs Branch out of one account." }),
  slot("accounts.order.select", ORDER, "Select accounts", [STATUS, ORDER_SET, "models.authLogout"], { help: "Move several to the top, or sign out of them.", level: 1 }),
  coming("accounts.order.pause", ORDER, "Pause", "engine: a way to pause an account", "Branch can’t pause an account yet.", { level: 1 }),

  // When one runs out
  coming("accounts.out.next", OUT, "Move to the next account in the list", "engine: a switch for moving between accounts (Branch always moves on today)",
    "Branch always moves on when an account runs out.", { help: "Only switches between accounts you own and pay for.", control: "toggle" }),
  slot("accounts.out.this-computer", OUT, "Fall back to this computer", ["models.list", "config.get", "config.patch"]),

  // Terms (Advanced)
  coming("accounts.terms.lines", "Terms", "Each service’s terms", "engine: each service's terms, listed", "Each service’s terms are on its own site; Branch doesn’t list them yet.",
    { help: "Branch signs in to plans only as each service allows.", level: 1 }),

  // Which account goes next (Technical): In order or Take turns per service.
  slot("accounts.next.mode", NEXT, "Which account goes next", [STATUS, ORDER_SET], { help: "Accounts that run out or lose sign-in are skipped until ready.", level: 2 }),

  // Your own accounts
  slot("accounts.own.list", OWN, "Your own accounts", ["users.listModelAccounts", "users.unlinkAuthProfile"], { help: "Accounts only you use." }),
  slot("accounts.own.add", OWN, "Add your own account", ["users.listModelAccounts", "users.selectModelAccount"]),

  // Coding apps on this computer: Codex runs through the engine's codex plugin; the others follow their own sign-in.
  slot("accounts.apps.claude", APPS, "Claude Code", [DETECT, "usage.status"], { help: "Follows Claude Code’s own sign-in on this computer." }),
  slot("accounts.apps.codex", APPS, "Codex", [DETECT, "config.get", "config.patch"], { help: "Turn it on to use Codex’s models. Turning it on doesn’t sign you in.", ownerLevel: true }),
  slot("accounts.apps.gemini", APPS, "Gemini CLI", [DETECT], { help: "Follows Gemini CLI’s own sign-in on this computer." }),
  slot("accounts.apps.check", APPS, "Check again", [DETECT], { help: "Looks for the coding apps on this computer again." }),

  // Where each sign-in comes from (Technical)
  slot("accounts.sources.each", "Where each sign-in comes from", "Where each sign-in comes from", [STATUS], { level: 2 }),

  // GitHub
  slot("accounts.github.connection", "GitHub", "GitHub", GITHUB, { help: "For Trunks without their own GitHub connection." }),
  slot("accounts.github.permissions", "GitHub", "Permissions", ["tools.github.status"]),
  slot("accounts.github.expires", "GitHub", "Access expires", ["tools.github.status"]),

  // keepoak.com
  coming("accounts.keepoak.connect", "keepoak.com", "Connect your keepoak.com account", "engine: a keepoak.com sign-in", "keepoak.com has no sign-in Branch can use yet.",
    { help: "Have a KeepOak computer or a team on keepoak.com? Connect it once." }),

  // Accounts, more (Advanced)
  slot("accounts.more.each-trunk", MORE, "Which account each Trunk uses", ["agents.list", STATUS, ORDER_SET], { help: "A Trunk with its own account follows that account’s order and limits.", level: 1 }),
  coming("accounts.more.helpers-keep", MORE, "Helpers keep their account", "engine: a setting for helpers keeping their account", NO_KEY,
    { help: "Helpers keep their starting account through pauses and restarts.", level: 1, control: "toggle" }),
  coming("accounts.more.by-task", MORE, "Pick by what the task needs", "engine: a setting for picking an account by what the task needs", NO_KEY,
    { help: "A task that needs pictures or a long room gets an account that has it.", level: 1, control: "toggle" }),
  slot("accounts.more.fallback-keys", MORE, "Fallback keys", [], { help: "Rate-limited keys rest while the next key works.", level: 1 }),
  slot("accounts.more.resting", MORE, "Resting now", [STATUS], { help: "A limit benches an account only for that model.", level: 1 }),
  coming("accounts.more.request-log", MORE, "Which sign-in each request used", "engine: a log of which sign-in each request used", NO_KEY,
    { help: "Key or sign-in, and which account; never the key itself.", level: 1 }),
  coming("accounts.more.organisation", MORE, "Organisation", "engine: an organisation setting for accounts in more than one", NO_KEY,
    { help: "For accounts in more than one organisation: who is billed.", level: 1, control: "select", options: [{ v: "personal", label: "Personal" }] }),
  coming("accounts.more.customer-chatgpt", MORE, "A customer’s ChatGPT account on a KeepOak computer", "engine: a setting for a customer's own ChatGPT sign-in on a computer KeepOak manages", NO_KEY,
    { help: "Only with that customer’s own sign-in on it.", level: 1, control: "toggle" }),

  // Accounts, technical (Technical)
  coming("accounts.tech.command", TECH, "A command that makes a sign-in", "engine: a setting for a command whose output is a service's key", NO_KEY,
    { help: "For a service whose key comes from a program of yours.", level: 2, control: "text" }),
  coming("accounts.tech.build-server", TECH, "On a build server, sign in with", "engine: a setting for how a build server signs in", NO_KEY,
    { level: 2, control: "segmented", options: [{ v: "token", label: "A personal token" }, { v: "identity", label: "The server’s own identity" }] }),
  coming("accounts.tech.editor", TECH, "Accept sign-ins from your editor", "engine: a setting for borrowing an editor's sign-in", NO_KEY,
    { help: "An editor or kit already signed in can lend that sign-in.", level: 2, control: "toggle" }),
  slot("accounts.tech.identity", TECH, "This Branch’s identity", ["gateway.identity.get"], { help: "Signs Branch’s calls to other services and computers.", level: 2 }),
  coming("accounts.tech.gateway", TECH, "Sign-ins through the Gateway", "engine: a switch for Gateway-kept sign-ins (always on today)", "The Gateway always keeps refreshed sign-ins.",
    { help: "The Gateway keeps service sign-ins refreshed.", level: 2, control: "toggle" }),
  coming("accounts.tech.bring-in", TECH, "Settings from another Branch", "engine: a way to bring in model settings and keys from another Branch", NO_KEY,
    { help: "Bring model settings and keys from another Branch computer.", level: 2 }),
  coming("accounts.tech.in-step", TECH, "Keep service settings in step on my devices", "engine: a setting for keeping service settings in step across devices", NO_KEY,
    { help: "Not keys: those stay on each computer.", level: 2, control: "toggle" }),
  slot("accounts.tech.hub", TECH, "Use a model from a hub for one run", [], { level: 2 }),
  coming("accounts.tech.region", TECH, "Region", "engine: a region setting", NO_KEY,
    { help: "Changes which services and mirrors come first.", level: 2, control: "select", options: [{ v: "auto", label: "Automatic" }, { v: "world", label: "Worldwide" }, { v: "cn", label: "China" }] }),
  coming("accounts.tech.install", TECH, "Install a service’s package when needed", "engine: a setting for installing a service's package when needed", NO_KEY,
    { help: "Otherwise it says which one to install.", level: 2, control: "toggle" }),
  slot("accounts.tech.own-folder", TECH, "Each account keeps its own folder", [], { help: "A coding app’s sign-in for one account never mixes with another’s.", level: 2 }),
  coming("accounts.tech.point-apps", TECH, "Point your coding apps at Branch", "engine: a way to write one model service into each coding app's settings", NO_KEY,
    { help: "Use one model service across your coding apps.", level: 2 }),
];

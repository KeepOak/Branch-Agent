// Settings › Accounts & usage: the rows of the R1 Accounts page, ported from the Classic Accounts page
// (places/settings/set1/accounts*.tsx, coding-apps.tsx, own-accounts.tsx and GitHubSettings.tsx). Codex's switch is on the
// same engine key Classic saves (plugins.entries.codex.enabled), so turning it on either page shows on the other. Every
// other Classic control works on a list the engine reports (models.authStatus, branch.setup.detect, users.prefs accounts,
// the GitHub connection) or has no setting yet, so it is a Coming row naming the call or row kind it waits for (#952).
import type { Level } from "../nav";
import type { Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[] };
const coming = (id: string, card: string, label: string, need: string, reason: string, extra: Extra = {}): Row =>
  ({ id, page: "accounts", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason } });

const ORDER = "Order Branch uses them in";
const OUT = "When one runs out";
const NEXT = "Which account goes next";
const OWN = "Your own accounts";
const APPS = "Coding apps on this computer";
const MORE = "Accounts, more";
const TECH = "Accounts, technical";
/** Classic greys these with "Branch has no setting for this yet." */
const NO_KEY = "Branch has no setting for this yet.";
const LIST = "window: a list row kind over models.authStatus";
const DETECT = "window: a read-only row kind over branch.setup.detect";

export const ACCOUNTS_ROWS: Row[] = [
  // Order Branch uses them in: Classic's list of accounts, its ⋯ menu and Select accounts.
  coming("accounts.order.list", ORDER, "Your accounts, in order", `${LIST}, with Move up saving through models.authOrderSet`,
    "Your accounts and the order Branch uses them in show on the Classic page until this list can.", { help: "When one account runs low, Branch moves to the next." }),
  coming("accounts.order.add", ORDER, "Add an account", "window: the add-account sign-in (models.authStatus providerCapabilities, then each provider's sign-in) opened from a row",
    "Adding an account, or another account of a service you use, is on the Classic page for now."),
  coming("accounts.order.test", ORDER, "Test it", `${LIST} with a per-account action calling models.probe`, "Testing an account is in its ⋯ menu on the Classic page for now."),
  coming("accounts.order.answer-first", ORDER, "Answer first", `${LIST} with a per-account action saving models.authOrderSet`, "Putting an account first is in its ⋯ menu on the Classic page for now."),
  coming("accounts.order.rename", ORDER, "Rename", "engine: a way to rename an account", "Branch can’t rename an account yet."),
  coming("accounts.order.which-trunks", ORDER, "Which Trunks use it", `${LIST} showing each Trunk's own order (models.authStatus with agentId)`, "Every Trunk uses this account, in this order."),
  coming("accounts.order.sign-out", ORDER, "Sign out", `${LIST} with a per-account action calling models.authLogout`, "Signing out of an account is in its ⋯ menu on the Classic page for now."),
  coming("accounts.order.select", ORDER, "Select accounts", `${LIST} with ticks, moving them to the top (models.authOrderSet) or signing out (models.authLogout)`,
    "Selecting several accounts at once is on the Classic page for now.", { level: 1 }),
  coming("accounts.order.pause", ORDER, "Pause", "engine: a way to pause an account", "Branch can’t pause an account yet.", { level: 1 }),

  // When one runs out
  coming("accounts.out.next", OUT, "Move to the next account in the list", "engine: a switch for moving between accounts (Branch always moves on today)",
    "Branch always moves on when an account runs out.", { help: "Only switches between accounts you own and pay for.", control: "toggle" }),
  coming("accounts.out.this-computer", OUT, "Fall back to this computer", "window: a row that adds this computer's model (models.list, local) to agents.defaults.model.fallbacks",
    "Falling back to a model on this computer is set on the Classic page for now.", { help: "When every account is out, keep going on a model on this computer instead of stopping.", control: "toggle" }),

  // Terms (Advanced)
  coming("accounts.terms.lines", "Terms", "Each service’s terms", "engine: each service's terms, listed", "Each service’s terms are on its own site; Branch doesn’t list them yet.",
    { help: "Branch signs in to plans only as each service allows.", level: 1 }),

  // Which account goes next (Technical): In order or Take turns per service.
  coming("accounts.next.mode", NEXT, "Which account goes next", `${LIST}: one row per service, saving models.authOrderSet (an order, or none to take turns)`,
    "Which account goes next for each service is set on the Classic page for now.", { help: "Accounts that run out or lose sign-in are skipped until ready.", level: 2, control: "segmented",
      options: [{ v: "order", label: "In order" }, { v: "turns", label: "Take turns" }, { v: "random", label: "At random" }, { v: "least", label: "Least used" }] }),

  // Your own accounts
  coming("accounts.own.list", OWN, "Your own accounts", "window: a list row kind over the person's own accounts (users.unlinkAuthProfile to stop using one)",
    "Accounts only you use show on the Classic page for now.", { help: "New conversations you start use it first." }),
  coming("accounts.own.add", OWN, "Add your own account", "window: an account picker row saving users.selectModelAccount", "Adding your own account is on the Classic page for now."),

  // Coding apps on this computer: Codex runs through the engine's codex plugin; the others follow their own sign-in.
  coming("accounts.apps.claude", APPS, "Claude Code", `${DETECT} (it follows Claude Code’s own sign-in; there is no switch to save)`,
    "Claude Code follows its own sign-in on this computer.", { control: "toggle" }),
  { id: "accounts.apps.codex", page: "accounts", card: APPS, label: "Codex", help: "Turn it on to use Codex’s models. Turning it on doesn’t sign you in.", level: 0, ownerLevel: true, control: "toggle",
    source: { kind: "config", path: "plugins.entries.codex.enabled" }, codec: { read: (v) => v === true, write: (on) => on === true }, fallback: false },
  coming("accounts.apps.gemini", APPS, "Gemini CLI", `${DETECT} (it follows Gemini CLI’s own sign-in; there is no switch to save)`,
    "Gemini CLI follows its own sign-in on this computer.", { control: "toggle" }),
  coming("accounts.apps.check", APPS, "Check again", `${DETECT} with a reload action`, "Looking for coding apps again is on the Classic page for now."),

  // Where each sign-in comes from (Technical)
  coming("accounts.sources.each", "Where each sign-in comes from", "Where each sign-in comes from", `window: a read-only row kind over models.authStatus (browser sign-ins, keys, and where a key is read from)`,
    "Where each service’s sign-in comes from shows on the Classic page for now.", { level: 2 }),

  // GitHub
  coming("accounts.github.connection", "GitHub", "GitHub", "window: the GitHub connection (connect, cancel, use the shared account, refresh) as a row",
    "Connecting GitHub is on the Classic page for now.", { help: "For Trunks without their own GitHub connection." }),
  coming("accounts.github.permissions", "GitHub", "Permissions", "window: a read-only row kind over the GitHub connection's scopes", "GitHub’s permissions show on the Classic page for now."),
  coming("accounts.github.expires", "GitHub", "Access expires", "window: a read-only row kind over the GitHub connection's expiry", "When GitHub access expires shows on the Classic page for now."),

  // keepoak.com
  coming("accounts.keepoak.connect", "keepoak.com", "Connect your keepoak.com account", "engine: a keepoak.com sign-in", "keepoak.com has no sign-in Branch can use yet.",
    { help: "Have a KeepOak computer or a team on keepoak.com? Connect it once." }),

  // Accounts, more (Advanced)
  coming("accounts.more.each-trunk", MORE, "Which account each Trunk uses", "window: one row per Trunk (agents.list), saving that Trunk's own order with models.authOrderSet and agentId",
    "Which account each Trunk uses is set on the Classic page for now.", { help: "A Trunk with its own account follows that account’s order and limits.", level: 1 }),
  coming("accounts.more.helpers-keep", MORE, "Helpers keep their account", "engine: a setting for helpers keeping their account", NO_KEY,
    { help: "Helpers keep their starting account through pauses and restarts.", level: 1, control: "toggle" }),
  coming("accounts.more.by-task", MORE, "Pick by what the task needs", "engine: a setting for picking an account by what the task needs", NO_KEY,
    { help: "A task that needs pictures or a long room gets an account that has it.", level: 1, control: "toggle" }),
  coming("accounts.more.fallback-keys", MORE, "Fallback keys", "window: a link row kind to Sign-ins & keys", "Keys are added in Sign-ins & keys.",
    { help: "Rate-limited keys rest while the next key works.", level: 1 }),
  coming("accounts.more.resting", MORE, "Resting now", `window: a read-only row kind over models.authStatus (accounts in cooldown)`, "Accounts resting after a limit show on the Classic page for now.",
    { help: "A limit benches an account only for that model.", level: 1 }),
  coming("accounts.more.request-log", MORE, "Which sign-in each request used", "engine: a log of which sign-in each request used", NO_KEY,
    { help: "Key or sign-in, and which account; never the key itself.", level: 1 }),
  coming("accounts.more.organisation", MORE, "Organisation", "engine: an organisation setting for accounts in more than one", NO_KEY,
    { help: "For accounts in more than one organisation: who is billed.", level: 1, control: "select", options: [{ v: "personal", label: "Personal" }] }),
  coming("accounts.more.customer-chatgpt", MORE, "A customer’s ChatGPT account on a KeepOak computer", "engine: a setting for a customer's own ChatGPT sign-in on a KeepOak computer", NO_KEY,
    { help: "Only with that customer’s own sign-in on it.", level: 1, control: "toggle" }),

  // Accounts, technical (Technical)
  coming("accounts.tech.command", TECH, "A command that makes a sign-in", "engine: a setting for a command whose output is a service's key", NO_KEY,
    { help: "For a service whose key comes from a program of yours.", level: 2, control: "text" }),
  coming("accounts.tech.build-server", TECH, "On a build server, sign in with", "engine: a setting for how a build server signs in", NO_KEY,
    { level: 2, control: "segmented", options: [{ v: "token", label: "A personal token" }, { v: "identity", label: "The server’s own identity" }] }),
  coming("accounts.tech.editor", TECH, "Accept sign-ins from your editor", "engine: a setting for borrowing an editor's sign-in", NO_KEY,
    { help: "An editor or kit already signed in can lend that sign-in.", level: 2, control: "toggle" }),
  coming("accounts.tech.identity", TECH, "This Branch’s identity", "window: a read-only row kind over gateway.identity.get (deviceId)", "This Branch’s identity shows on the Classic page for now.",
    { help: "Signs Branch’s calls to other services and computers.", level: 2 }),
  coming("accounts.tech.gateway", TECH, "Sign-ins through the Gateway", "engine: a switch for Gateway-kept sign-ins (always on today)", "The Gateway always keeps refreshed sign-ins.",
    { help: "The Gateway keeps service sign-ins refreshed.", level: 2, control: "toggle" }),
  coming("accounts.tech.bring-in", TECH, "Settings from another Branch", "engine: a way to bring in model settings and keys from another Branch", NO_KEY,
    { help: "Bring model settings and keys from another Branch computer.", level: 2 }),
  coming("accounts.tech.in-step", TECH, "Keep service settings in step on my devices", "engine: a setting for keeping service settings in step across devices", NO_KEY,
    { help: "Not keys: those stay on each computer.", level: 2, control: "toggle" }),
  coming("accounts.tech.hub", TECH, "Use a model from a hub for one run", "window: a read-only row kind showing a command (branch --model owner/package)", "Run branch --model owner/package from a terminal.",
    { level: 2 }),
  coming("accounts.tech.region", TECH, "Region", "engine: a region setting", NO_KEY,
    { help: "Changes which services and mirrors come first.", level: 2, control: "select", options: [{ v: "auto", label: "Automatic" }, { v: "world", label: "Worldwide" }, { v: "cn", label: "China" }] }),
  coming("accounts.tech.install", TECH, "Install a service’s package when needed", "engine: a setting for installing a service's package when needed", NO_KEY,
    { help: "Otherwise it says which one to install.", level: 2, control: "toggle" }),
  coming("accounts.tech.own-folder", TECH, "Each account keeps its own folder", "window: a read-only row kind (always on: a coding app's sign-in for one account never mixes with another's)",
    "Always on.", { help: "A coding app’s sign-in for one account never mixes with another’s.", level: 2 }),
  coming("accounts.tech.point-apps", TECH, "Point your coding apps at Branch", "engine: a way to write one model service into each coding app's settings", NO_KEY,
    { help: "Use one model service across your coding apps.", level: 2 }),
];

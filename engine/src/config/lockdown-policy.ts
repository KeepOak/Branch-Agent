// Which gateway calls stay available while Lockdown is on. Reads pass; everything that sends, changes or
// spends is refused, except stopping work, narrowing access, and the switch itself.
// Also the local-only control rule (atlas SAFETY-0194, G-1614), whatever the Lockdown state.
import { classifyLocalOnlyControl, type LocalOnlyControl } from "../safety/local-only-control.js";

type Params = Record<string, unknown>;

const asParams = (params: unknown): Params | undefined =>
  params && typeof params === "object" && !Array.isArray(params) ? (params as Params) : undefined;

const onlyKeys = (value: Params, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

/**
 * The switch itself: a config.patch whose params are only `raw` (+ `baseHash`) and whose raw patch is exactly
 * `{"security":{"lockdown":<bool>}}`. Returns the requested state, or undefined for any other call.
 */
export function readLockdownSwitchPatch(params: unknown): boolean | undefined {
  const value = asParams(params);
  if (!value || !onlyKeys(value, ["raw", "baseHash"]) || typeof value.raw !== "string") {
    return undefined;
  }
  try {
    const root = asParams(JSON.parse(value.raw) as unknown);
    if (!root || Object.keys(root).length !== 1) {
      return undefined;
    }
    const security = asParams(root.security);
    if (!security || Object.keys(security).length !== 1) {
      return undefined;
    }
    return typeof security.lockdown === "boolean" ? security.lockdown : undefined;
  } catch {
    return undefined;
  }
}

export function isLockdownSwitchPatch(params: unknown): boolean {
  return readLockdownSwitchPatch(params) !== undefined;
}

/**
 * Read-scoped methods that nonetheless spend, write, or reach outside this computer. The rule: refuse a read that
 * calls a model, writes the person's data, contacts another server, or widens access. Reads that only change this
 * person's own view (mentions.dismiss, sessions.setInvolvement, sessions.viewers.set) stay: they drive no Trunk and
 * nothing leaves the computer. Plugin methods registered with read scope are outside this list.
 */
export const LOCKDOWN_REFUSED_READ_METHODS: ReadonlySet<string> = new Set([
  "sessions.companion.ask", // side chat: a model call
  "users.personalFile.set", // writes the person's file
  "users.github.authorize.start", // starts an outbound OAuth flow
  "users.github.authorize.poll",
  "users.github.disconnect", // revokes upstream and writes the link
  "mcp.app.readResource", // calls the connector's server
  "mcp.app.openFile",
  "mcp.app.modelContext",
  "mcp.app.subscribeResource",
  "controlUi.linkPreview", // outbound fetches
  "controlUi.githubPreview",
  "controlUi.githubDetail",
  "github.preview",
  "github.detail",
  "github.image",
  "controlUi.sessionPullRequests.checks", // asks GitHub for check runs
  "skills.search",
  "board.prompt.authorize", // grants a board widget a prompt
  "device.scopes.requestUpgrade", // asks for wider access
]);

/** Writes that only stop work or narrow access: Stop, "Don't", revoking a device, pausing a schedule. */
type Check = (params: Params | undefined) => boolean;
const always: Check = () => true;
const denies: Check = (p) => p?.decision === "deny";
const STOP_OR_NARROW = new Map<string, Check>([
  ["chat.abort", always],
  ["sessions.abort", always],
  ["sessions.processes.stop", always],
  ["sessions.goal.update", (p) => p?.action === "pause"],
  ["exec.approval.resolve", denies],
  ["plugin.approval.resolve", denies],
  ["approval.resolve", denies],
  ["device.token.revoke", always],
  ["device.pair.remove", always],
  ["device.pair.reject", always],
  ["attach.revoke", always],
  ["channels.stop", always],
  [
    "cron.update",
    (p) => {
      const patch = asParams(p?.patch);
      return Boolean(patch && onlyKeys(patch, ["enabled"]) && patch.enabled === false);
    },
  ],
]);

export type LockdownAdmission =
  | { admitted: true }
  | { admitted: false; reason: "locked" | "owner-only" | "local-only" };

/**
 * Decides one gateway request while Lockdown is on. `isOwner` and `isLocalWindow` are consulted only to switch
 * it off: the owner, from the window on this computer (G-1614).
 */
export function decideLockdownAdmission(request: {
  method: string;
  params: unknown;
  scope: string | undefined;
  isOwner: () => boolean;
  isLocalWindow: () => boolean;
}): LockdownAdmission {
  if (request.method === "config.patch") {
    const next = readLockdownSwitchPatch(request.params);
    if (next === true) {
      return { admitted: true };
    }
    if (next === false) {
      if (!request.isOwner()) {
        return { admitted: false, reason: "owner-only" };
      }
      return request.isLocalWindow() ? { admitted: true } : { admitted: false, reason: "local-only" };
    }
    return { admitted: false, reason: "locked" };
  }
  if (request.scope === "operator.read") {
    return LOCKDOWN_REFUSED_READ_METHODS.has(request.method)
      ? { admitted: false, reason: "locked" }
      : { admitted: true };
  }
  return STOP_OR_NARROW.get(request.method)?.(asParams(request.params))
    ? { admitted: true }
    : { admitted: false, reason: "locked" };
}

export type LocalOnlyAdmission = { admitted: true } | { admitted: false; control: LocalOnlyControl };

/**
 * G-1614, whatever the Lockdown state: switching Lockdown off, and creating webhooks, triggers, chat setups,
 * sign-in codes or people, only from the local window. Switching Lockdown on is never refused here.
 */
export function decideLocalOnlyControl(request: {
  method: string;
  params: unknown;
  currentConfig: unknown;
  isLocalWindow: (control: LocalOnlyControl) => boolean;
}): LocalOnlyAdmission {
  const control = classifyLocalOnlyControl(request.method, request.params, request.currentConfig);
  if (!control || request.isLocalWindow(control)) {
    return { admitted: true };
  }
  return { admitted: false, control };
}

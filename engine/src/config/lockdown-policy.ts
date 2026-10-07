// Which gateway calls stay available while Lockdown is on. Reads pass; everything that sends, changes or
// spends is refused, except stopping work, narrowing access, and the switch itself.

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
  | { admitted: false; reason: "locked" | "owner-only" };

/** Decides one gateway request while Lockdown is on. `isOwner` is consulted only to switch it off. */
export function decideLockdownAdmission(request: {
  method: string;
  params: unknown;
  scope: string | undefined;
  isOwner: () => boolean;
}): LockdownAdmission {
  if (request.method === "config.patch") {
    const next = readLockdownSwitchPatch(request.params);
    if (next === true) {
      return { admitted: true };
    }
    if (next === false) {
      return request.isOwner() ? { admitted: true } : { admitted: false, reason: "owner-only" };
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

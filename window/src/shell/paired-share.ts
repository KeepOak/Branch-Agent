// Share a conversation with paired computers from the conversation menu (engine/extensions/session-share).
// The plugin publishes every conversation in the named groups and skips drafts, so this uses the Share
// dialog's existing session.visibility.set and sessions.patch category, then writes plugins.entries.session-share.
// People › Access › Shared keeps listing and managing who on this Branch may see a conversation.

export const DEFAULT_PAIRED_GROUP = "Shared";
export const PAIRED_SHARE_NEED = ["config.patch", "sessions.patch"] as const;
export const PAIRED_SHARE_GROUPS_PATH = ["plugins", "entries", "session-share", "config", "share", "groups"];
export const PAIRED_SHARE_ENABLED_PATH = ["plugins", "entries", "session-share", "enabled"];

const CATALOG_KEY = /^agent:[^:]+:catalog:/i;

export type PairedSession = {
  category: string;
  visibility: string;
  incognito: boolean;
  createdVia: string;
  spawnedBy: string;
};

const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The same prefix check the session-share plugin uses before it will publish a conversation. */
function isSubagentSessionKey(sessionKey: string): boolean {
  const raw = sessionKey.trim();
  if (!raw) return false;
  if (raw.toLowerCase().startsWith("subagent:")) return true;
  const rest = /^agent:[^:]+:(.+)$/i.exec(raw)?.[1];
  return rest?.toLowerCase().startsWith("subagent:") === true;
}

/** Facts sessions.describe already returned for this conversation. */
export function readPairedSession(described: unknown): PairedSession {
  const session = rec(rec(described).session);
  return {
    category: typeof session.category === "string" ? session.category.trim() : "",
    visibility: typeof session.visibility === "string" ? session.visibility : "",
    incognito: session.incognito === true,
    createdVia: typeof session.createdVia === "string" ? session.createdVia : "",
    spawnedBy: typeof session.spawnedBy === "string" ? session.spawnedBy : "",
  };
}

/** Why the plugin will never publish this conversation, or null when sharing can start. */
export function pairedShareBlock(sessionKey: string, session: PairedSession): string | null {
  if (session.incognito) return "An incognito conversation stays on this computer.";
  if (isSubagentSessionKey(sessionKey)) return "A helper conversation stays on this computer.";
  if (session.createdVia === "spawn" || session.spawnedBy.trim()) return "A conversation a Trunk started stays on this computer.";
  if (CATALOG_KEY.test(sessionKey)) return "A conversation from another catalog stays where it is.";
  return null;
}

function pluginEntry(snapshot: unknown): Record<string, unknown> {
  const root = rec(snapshot);
  const config = root.hash !== undefined || root.valid !== undefined ? rec(root.config) : root;
  return rec(rec(rec(config.plugins).entries)["session-share"]);
}

/** Group names the session-share plugin is publishing (config.get, or the config object itself). */
export function shareGroupsOf(snapshot: unknown): string[] {
  const share = rec(rec(pluginEntry(snapshot).config).share);
  if (!Array.isArray(share.groups)) return [];
  return share.groups.filter((group): group is string => typeof group === "string" && group.length > 0);
}

/** The plugin publishes nothing until its entry is turned on. */
export function pairedShareEnabled(snapshot: unknown): boolean {
  return pluginEntry(snapshot).enabled === true;
}

/** The plugin writes for turning paired reading on or off for one group, leaving other groups in place. */
export function pairedShareWrites(snapshot: unknown, group: string, on: boolean): { groups: string[]; enabled?: boolean } {
  const current = shareGroupsOf(snapshot);
  if (on) return { enabled: true, groups: current.includes(group) ? current : [...current, group] };
  const groups = current.filter((name) => name !== group);
  return groups.length === 0 ? { enabled: false, groups } : { groups };
}

/** The group this conversation joins: its own group, or Shared when it has none. */
export function pairedShareGroup(session: PairedSession): string {
  return session.category || DEFAULT_PAIRED_GROUP;
}

export function pairedSharePublished(session: PairedSession, groups: readonly string[], enabled: boolean): boolean {
  return enabled && Boolean(session.category) && session.visibility !== "draft" && groups.includes(session.category);
}

export function pairedShareHint(session: PairedSession, published: boolean): string {
  const group = pairedShareGroup(session);
  const draft = session.visibility === "draft" && !published
    ? " This is a draft, so sharing also lets everyone else on this Branch read it."
    : "";
  if (published) return `Paired computers can read every conversation in ${group}. Thinking, tools and files stay here.`;
  if (!session.category) return `Puts this conversation in the ${group} group. A paired computer can read the text of every conversation in that group. Thinking, tools and files stay here.${draft}`;
  return `A paired computer can read the text of every conversation in ${group}. Thinking, tools and files stay here.${draft}`;
}

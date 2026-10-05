// The sidebar roster is keyed by a contact's durable thread, never by a transcript id.
// Hermes' canonical Bot Chat supplies that identity rule; LobeHub's agent/topic split
// supplies the classification. Topic cards arrive with the contact thread package.
import type { Conversation } from "../connect/conversations";
import type { Trunk } from "./engine-data";
import type { ListPrefs, ListSection } from "./list-model";

export type ContactKind = "trunk" | "chatGroup" | "outside";
export type Contact = {
  id: string;
  kind: ContactKind;
  name: string;
  threadKey: string;
  isDefault: boolean;
  pinnedAt?: number;
  archivedAt?: number;
  lastActivityAt: number;
  preview: { kind: "message"; text: string; at: number };
  unreadTopics: number;
  threadUnread: boolean;
  needsYou: boolean;
  working: boolean;
  topicCount: number;
  topics: Conversation[];
  thread: Conversation | null;
};

export type ContactSource = {
  trunks: Trunk[];
  defaultId: string | null;
  mainKey: string;
  sessions: Conversation[];
  pending?: ReadonlyMap<string, number>;
};

/** A session has exactly one owner. Helpers, automation and room plumbing are not topics. */
export function contactIdFor(row: Conversation, mainKey = "main"): string | null {
  const key = row.key;
  const match = /^agent:([^:]+):(.+)$/.exec(key);
  if (!match) return null;
  const [, agentId, suffix] = match;
  if (row.helper || (row.spawnDepth ?? 0) > 0) return null;
  if (row.system || row.automation || row.classification === "cron") return null;
  if (suffix.startsWith("room:")) return null;
  const a2a = /^a2a:.*:direct:([^:]+):/.exec(suffix);
  if (a2a) return `a2a:${a2a[1]}`;
  if (suffix === mainKey) return `trunk:${agentId}`;
  if (suffix.includes(":group:") || row.groupChat) return `chat:${key}`;
  // A split outside DM remains a topic of its Trunk, not a second sidebar row.
  return `trunk:${agentId}`;
}

/** Project configured and former Trunks from real roster/session rows. */
export function projectContact(source: ContactSource): Contact[] {
  const { trunks, defaultId, mainKey, sessions } = source;
  const configured = new Map(trunks.map((t) => [t.id, t]));
  const byKey = new Map(sessions.map((s) => [s.key, s]));
  // An unconfigured former Trunk is evidenced by its main thread, not by a helper,
  // group chat or outside-agent session that happens to carry its agent id.
  const ids = new Set([...configured.keys(), ...sessions.map((s) => /^agent:([^:]+):(.+)$/.exec(s.key)).filter((m) => m?.[2] === mainKey).map((m) => m![1])]);
  const contacts: Contact[] = [];
  for (const id of ids) {
    const threadKey = `agent:${id}:${mainKey}`;
    const thread = byKey.get(threadKey) ?? null;
    const topics = sessions.filter((s) => s.key !== threadKey && contactIdFor(s, mainKey) === `trunk:${id}`);
    const all = [thread, ...topics].filter((s): s is Conversation => Boolean(s));
    const configuredTrunk = configured.get(id);
    const at = thread?.updatedAt || thread?.createdAt || 0;
    contacts.push({
      id: `trunk:${id}`, kind: "trunk", name: configuredTrunk?.name ?? `${id} (former Trunk)`, threadKey,
      isDefault: id === defaultId, pinnedAt: thread?.pinned ? at || 1 : topics.some((s) => s.pinned) ? 1 : undefined,
      archivedAt: configuredTrunk ? (thread?.archived ? at || 1 : undefined) : at || 1,
      lastActivityAt: Math.max(0, ...all.map((s) => s.updatedAt || s.createdAt)),
      // Until update cards exist in W-thread, only the main thread can supply a preview.
      preview: { kind: "message", text: thread?.preview ?? "", at },
      unreadTopics: topics.filter((s) => s.unread).length, threadUnread: thread?.unread ?? false,
      needsYou: all.some((s) => (source.pending?.get(s.key) ?? 0) > 0),
      working: all.some((s) => s.working), topicCount: topics.length, topics, thread,
    });
  }
  const outside = new Map<string, Conversation[]>();
  for (const row of sessions) {
    const id = contactIdFor(row, mainKey);
    if (id?.startsWith("a2a:")) {
      outside.set(id, [...(outside.get(id) ?? []), row]);
      continue;
    }
    if (!id?.startsWith("chat:")) continue;
    contacts.push({
      id, kind: "chatGroup", name: row.title || "Group chat", threadKey: row.key, isDefault: false,
      pinnedAt: row.pinned ? row.updatedAt || 1 : undefined, archivedAt: row.archived ? row.updatedAt || 1 : undefined,
      lastActivityAt: row.updatedAt || row.createdAt,
      preview: { kind: "message", text: row.preview, at: row.updatedAt || row.createdAt },
      unreadTopics: 0, threadUnread: row.unread, needsYou: (source.pending?.get(row.key) ?? 0) > 0,
      working: row.working, topicCount: 0, topics: [], thread: row,
    });
  }
  for (const [id, rows] of outside) {
    const [thread, ...topics] = rows.sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key));
    contacts.push({
      id, kind: "outside", name: thread.title || id.slice(4), threadKey: thread.key, isDefault: false,
      pinnedAt: thread.pinned ? thread.updatedAt || 1 : undefined,
      archivedAt: thread.archived ? thread.updatedAt || 1 : undefined,
      lastActivityAt: Math.max(...rows.map((row) => row.updatedAt || row.createdAt)),
      preview: { kind: "message", text: thread.preview, at: thread.updatedAt || thread.createdAt },
      unreadTopics: topics.filter((row) => row.unread).length, threadUnread: thread.unread,
      needsYou: rows.some((row) => (source.pending?.get(row.key) ?? 0) > 0),
      working: rows.some((row) => row.working), topicCount: topics.length, topics, thread,
    });
  }
  return contacts;
}

/** ConversationRow is presentation only; its key remains the contact's thread key. */
export function contactRow(contact: Contact): Conversation {
  const base = contact.thread;
  return {
    key: contact.threadKey, title: contact.name, agentId: base?.agentId ?? (contact.kind === "trunk" ? contact.id.slice(6) : undefined),
    isMain: contact.isDefault, pinned: Boolean(contact.pinnedAt), archived: Boolean(contact.archivedAt),
    unread: contact.threadUnread || contact.unreadTopics > 0, snoozedUntil: base?.snoozedUntil ?? null,
    createdAt: base?.createdAt ?? 0, updatedAt: contact.preview.at, preview: contact.preview.text,
    working: contact.working, needsYou: contact.needsYou, kind: contact.kind, system: false, automation: false,
    totalTokens: base?.totalTokens ?? 0, contextTokens: base?.contextTokens ?? 0,
    ...(base?.sessionId ? { sessionId: base.sessionId } : {}),
  };
}

export function buildContactSections(contacts: Contact[], prefs: ListPrefs, now: number): ListSection[] {
  const shown = contacts.filter((c) => {
    if (c.isDefault) return false;
    if (prefs.trunk && c.thread?.agentId !== prefs.trunk && c.id !== `trunk:${prefs.trunk}`) return false;
    if (prefs.status === "archived") return Boolean(c.archivedAt);
    if (prefs.status === "snoozed") return Boolean(c.thread?.snoozedUntil && c.thread.snoozedUntil > now);
    return prefs.status === "all" || (!c.archivedAt && !(c.thread?.snoozedUntil && c.thread.snoozedUntil > now));
  }).sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name));
  const pinned = shown.filter((c) => c.pinnedAt).map(contactRow);
  const recent = shown.filter((c) => !c.pinnedAt).map(contactRow);
  return [
    ...(pinned.length || prefs.hideEmpty === "never" ? [{ id: "pinned", label: "Pinned", rows: pinned }] : []),
    { id: "recent", label: "Recent", rows: recent },
  ];
}

/** W-list-a bridge: W-list-b replaces this one call with contacts.markRead. */
export async function markContactRead(contact: Contact, request: (method: string, params: unknown) => Promise<unknown>): Promise<boolean> {
  const rows = [contact.thread, ...contact.topics].filter((row): row is Conversation => Boolean(row && row.unread));
  if (!rows.length) return false;
  await request("sessions.patchMany", {
    targets: rows.map((row) => ({ key: row.key, ...(row.agentId ? { agentId: row.agentId } : {}), ...(row.sessionId ? { expectedSessionId: row.sessionId } : {}) })),
    patch: { unread: false },
  });
  return true;
}

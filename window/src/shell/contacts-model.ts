// Hermes' canonical Bot Chat supplies the durable row target. The Gateway owns
// contact classification and unread rollup; this file only adapts it to rows.
import type { Contact as GatewayContact, Topic } from "@branch/gateway-protocol";
import type { Conversation } from "../connect/conversations";
import type { RoomPick } from "../rooms/RoomFaces";
import type { Actions } from "./conversation-actions";
import type { ListPrefs, ListSection } from "./list-model";
import type { Trunk } from "./engine-data";

export type Contact = GatewayContact & { thread: Conversation | null; roomId?: string; offline?: boolean; roomPicks?: RoomPick[] };

/** Trunks remain reachable until the gateway's contacts projection has loaded. */
export function fallbackTrunkContacts(trunks: readonly Trunk[], sessions: readonly Conversation[], mainKey: string | null): GatewayContact[] {
  const suffix = mainKey?.split(":").slice(2).join(":") || "main";
  return trunks.map((trunk) => {
    const threadKey = trunk.isDefault && mainKey ? mainKey : `agent:${trunk.id}:${suffix}`;
    const thread = sessions.find((row) => row.key === threadKey);
    return {
      id: `trunk:${trunk.id}`, kind: "trunk", name: trunk.name, threadKey,
      isDefault: trunk.isDefault, lastActivityAt: thread?.updatedAt ?? 0,
      preview: { kind: "message", text: thread?.preview ?? "", at: thread?.updatedAt ?? 0 },
      unreadTopics: 0, threadUnread: thread?.unread ?? false, needsYou: thread?.needsYou ?? false,
      working: thread?.working ?? false, topicCount: 0,
    };
  });
}

/** An empty loaded roster is authoritative; only the first-run bootstrap owner is window-local. */
export function contactRowsFor(gateway: readonly GatewayContact[], loaded: boolean, trunks: readonly Trunk[], sessions: readonly Conversation[], mainKey: string | null, firstRun: boolean, bootstrapDefault?: Trunk): GatewayContact[] {
  const rows = loaded ? [...gateway] : firstRun ? fallbackTrunkContacts(trunks, sessions, mainKey) : [];
  if (bootstrapDefault && !rows.some((row) => row.id === `trunk:${bootstrapDefault.id}`)) {
    rows.push(...fallbackTrunkContacts([bootstrapDefault], sessions, mainKey));
  }
  return rows;
}

/** Join Gateway contacts to session rows only for existing row actions and detail. */
export function projectContact(raw: readonly (GatewayContact & { roomId?: string; offline?: boolean; roomPicks?: RoomPick[] })[], sessions: readonly Conversation[]): Contact[] {
  const byKey = new Map(sessions.map((row) => [row.key, row]));
  return raw.map((contact) => ({
    ...contact,
    thread: byKey.get(contact.threadKey) ?? null,
  }));
}

/** ConversationRow is presentation only; its key remains the contact's thread key. */
export function contactRow(contact: Contact): Conversation {
  const base = contact.thread;
  const preview = contact.preview.kind === "topic"
    ? `${contact.preview.title}: ${contact.preview.text}`
    : contact.preview.text;
  return {
    key: contact.threadKey, title: contact.name, agentId: base?.agentId ?? (contact.kind === "trunk" ? contact.id.slice(6) : contact.roomId ? contact.threadKey.split(":")[1] : undefined),
    isMain: contact.kind === "trunk", pinned: Boolean(contact.pinnedAt), archived: Boolean(contact.archivedAt),
    unread: contact.threadUnread || contact.unreadTopics > 0, snoozedUntil: base?.snoozedUntil ?? null,
    ...(base?.projectId ? { projectId: base.projectId } : {}),
    ...(contact.roomPicks ? { roomPicks: contact.roomPicks } : contact.face?.trunks?.length
      ? { roomPicks: contact.face.trunks.map((trunk) => ({ kind: "trunk" as const, name: trunk.name, avatar: trunk.avatar })) }
      : {}),
    createdAt: base?.createdAt ?? 0, updatedAt: contact.preview.at, preview,
    working: contact.working, needsYou: contact.needsYou, kind: contact.kind, system: false, automation: false,
    totalTokens: base?.totalTokens ?? 0, contextTokens: base?.contextTokens ?? 0,
    ...(base?.sessionId ? { sessionId: base.sessionId } : {}),
    // The thread's last run error, so its restart notice shows on the Trunk's own conversation.
    ...(base?.runError ? { runError: base.runError } : {}),
  };
}

export function openContactRow(key: string | null, contacts: readonly Contact[], sessions: readonly Conversation[]): Conversation | null {
  const contact = contacts.find((candidate) => candidate.threadKey === key);
  return contact ? contactRow(contact) : sessions.find((row) => row.key === key) ?? null;
}

export function missingConversation(key: string | null, mainKey: string | null, contactsLoaded: boolean, contacts: readonly Contact[], sessions: readonly Conversation[]): boolean {
  return Boolean(contactsLoaded && key && mainKey && key !== mainKey && !openContactRow(key, contacts, sessions));
}

export async function pinContact(contact: Contact, sessions: readonly Conversation[], actions: Actions, request: (method: string, params: unknown) => Promise<unknown>, refreshContacts: () => void): Promise<void> {
  const row = contactRow(contact);
  if (contact.pinnedAt) {
    const topics = await listContactTopics(contact.id, request);
    await actions.patchMany([row, ...topics.filter((topic) => topic.pinnedAt).map((topic) => sessions.find((candidate) => candidate.key === topic.key)).filter((candidate): candidate is Conversation => Boolean(candidate))], { pinned: false }, `Unpinned ${contact.name}.`);
  } else {
    await actions.pin(row);
  }
  refreshContacts();
}

export function buildContactSections(contacts: Contact[], prefs: ListPrefs, now: number): ListSection[] {
  const shown = contacts.filter((c) => {
    if (prefs.trunk && c.id !== `trunk:${prefs.trunk}`) return false;
    if (prefs.status === "archived") return Boolean(c.archivedAt);
    if (prefs.status === "snoozed") return Boolean(c.thread?.snoozedUntil && c.thread.snoozedUntil > now);
    return prefs.status === "all" || (!c.archivedAt && !(c.thread?.snoozedUntil && c.thread.snoozedUntil > now));
  }).sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name));
  const pinned = shown.filter((c) => c.pinnedAt).map(contactRow);
  const groups = shown.filter((c) => !c.pinnedAt && Boolean(c.roomId)).map(contactRow);
  const recent = shown.filter((c) => !c.pinnedAt && !c.roomId).map(contactRow);
  return [
    ...(pinned.length || prefs.hideEmpty === "never" ? [{ id: "pinned", label: "Pinned", rows: pinned }] : []),
    ...(groups.length ? [{ id: "groups", label: "Groups", rows: groups }] : []),
    { id: "recent", label: "Recent", rows: recent },
  ];
}

export async function markContactRead(contact: Contact, request: (method: string, params: unknown) => Promise<unknown>): Promise<boolean> {
  if (!contact.threadUnread && contact.unreadTopics === 0) return false;
  await request("contacts.markRead", { contactId: contact.id });
  return true;
}

/** Threads per shared-state read request; a bulk read is several small writes, never one all-or-nothing batch. */
const READ_BATCH = 500;

type RequestFn = (method: string, params: unknown) => Promise<unknown>;

/** Marks every thread read in one request. No agent is consulted, so a starting agent cannot fail it. */
export async function markAllThreadsRead(request: RequestFn): Promise<void> {
  await request("contacts.markAllRead", { mutationId: crypto.randomUUID() });
}

/** Marks just these sessions read, in batches of READ_BATCH. */
export async function markThreadsRead(request: RequestFn, sessionKeys: readonly string[]): Promise<void> {
  for (let i = 0; i < sessionKeys.length; i += READ_BATCH) {
    await request("contacts.markAllRead", { mutationId: crypto.randomUUID(), sessionKeys: sessionKeys.slice(i, i + READ_BATCH) });
  }
}

export async function listContactTopics(contactId: string, request: (method: string, params: unknown) => Promise<unknown>): Promise<Topic[]> {
  const topics: Topic[] = [];
  let cursor: string | undefined;
  do {
    const page = await request("contacts.topics", { contactId, limit: 200, ...(cursor ? { cursor } : {}) }) as { topics: Topic[]; nextCursor?: string };
    topics.push(...page.topics);
    cursor = page.nextCursor;
  } while (cursor);
  return topics;
}

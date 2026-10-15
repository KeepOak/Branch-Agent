import type { Contact, Topic } from "../../../packages/gateway-protocol/src/schema/contacts.js";
import { resolveCanonicalMainSessionKey } from "../../config/sessions/main-session-key.js";
import type { SessionEntrySummary } from "../../config/sessions/session-accessor.js";
import type { SessionScope } from "../../config/sessions/types.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";

export type ContactAgent = { id: string; name: string; iconUrl?: string };
export type OutsidePeer = {
  name: string;
  where: string | null;
  kind?: "branch" | "trunk";
  via?: string;
  avatar?: string;
  card?: {
    name: string;
    description: string;
    iconUrl?: string;
    skills: { name: string; description?: string }[];
    fetchedAt: number;
  };
};
export type ContactProjectionInput = {
  agents: readonly ContactAgent[];
  defaultAgentId: string;
  includeDefault?: boolean;
  mainKey?: string;
  sessionScope?: SessionScope;
  sessions: readonly SessionEntrySummary[];
  previews?: ReadonlyMap<string, string>;
  titles?: ReadonlyMap<string, string>;
  outsidePeers?: readonly OutsidePeer[];
  /** Whether a session has a live run in the engine's run registry (the source sessions.list uses). */
  isWorking?: (row: SessionEntrySummary) => boolean;
};

/** Unread follows activity, never bookkeeping writes such as restart recovery's (deriveSessionUnread). */
export function isContactUnread(entry: SessionEntrySummary["entry"]): boolean {
  return (
    (entry.markedUnreadAt ?? 0) > (entry.lastReadAt ?? 0) ||
    Math.max(entry.lastInteractionAt ?? 0, entry.lastActivityAt ?? 0) > (entry.lastReadAt ?? 0)
  );
}

/** Classify by the persisted key, never by a mutable session-id pointer. */
export function contactIdForSession(row: SessionEntrySummary): string | undefined {
  if (row.entry.movedToSessionKey) return undefined;
  const parsed = parseAgentSessionKey(row.sessionKey);
  if (
    !parsed ||
    row.entry.spawnedBy ||
    (row.entry.spawnDepth ?? 0) > 0 ||
    parsed.rest.startsWith("cron:") ||
    parsed.rest.includes(":cron:") ||
    parsed.rest.startsWith("room:") ||
    parsed.rest.startsWith("system:")
  ) {
    return undefined;
  }
  const group = parsed.rest.match(/^([^:]+):group:([^:]+)/);
  if (group) return `chat:agent:${parsed.agentId}:${group[1]}:group:${group[2]}`;
  const a2a = parsed.rest.match(/^a2a:.*:direct:([^:]+):/);
  if (a2a) return `a2a:${a2a[1]}`;
  return `trunk:${parsed.agentId}`;
}

function topicTitle(row: SessionEntrySummary, preview: string, derivedTitle?: string): string {
  const outsideDm = row.sessionKey.match(/:([^:]+):direct:([^:]+)$/);
  return (
    row.entry.label?.trim() ||
    row.entry.topicName?.trim() ||
    row.entry.displayName?.trim() ||
    (outsideDm ? `${outsideDm[1]} \u00b7 ${outsideDm[2]}` : undefined) ||
    derivedTitle?.trim() ||
    preview.trim().slice(0, 80) ||
    row.sessionKey
  );
}

export function projectContacts(input: ContactProjectionInput): {
  contacts: Contact[];
  topics: Topic[];
  defaultId: string;
} {
  const visibleSessions = input.sessions.filter((row) => !row.entry.movedToSessionKey);
  const working = (row: SessionEntrySummary | undefined) =>
    row !== undefined && (input.isWorking?.(row) ?? false);
  const byKey = new Map(visibleSessions.map((row) => [row.sessionKey, row]));
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]));
  const ids = new Set([
    ...agentById.keys(),
    ...(input.includeDefault === false ? [] : [input.defaultAgentId]),
  ]);
  for (const row of visibleSessions) {
    const id = contactIdForSession(row);
    if (id?.startsWith("trunk:")) ids.add(id.slice(6));
  }
  const topics: Topic[] = [];
  const contacts: Contact[] = [];
  for (const agentId of ids) {
    const threadKey = resolveCanonicalMainSessionKey({
      agentId,
      mainKey: input.mainKey,
      sessionScope: input.sessionScope,
    });
    const thread = byKey.get(threadKey);
    const contactId = `trunk:${agentId}`;
    const children = visibleSessions.filter(
      (row) => row.sessionKey !== threadKey && contactIdForSession(row) === contactId,
    );
    const projectedTopics = children.map((row): Topic => {
      const entry = row.entry;
      const anchorAt = entry.createdAt ?? entry.updatedAt;
      return {
        key: row.sessionKey,
        contactId,
        title: topicTitle(
          row,
          input.previews?.get(row.sessionKey) ?? "",
          input.titles?.get(row.sessionKey),
        ),
        labelled: Boolean(entry.label?.trim() || entry.topicName?.trim()),
        anchor: {
          threadKey: entry.contactAnchor?.threadKey ?? threadKey,
          ...(entry.contactAnchor?.afterMessageId
            ? { afterMessageId: entry.contactAnchor.afterMessageId }
            : {}),
          at: anchorAt,
        },
        status: entry.archivedAt
          ? "archived"
          : entry.done
            ? "done"
            : entry.providerReview || entry.observerDigest?.health === "waiting-on-user"
              ? "waiting"
              : working(row)
                ? "working"
                : "active",
        unread: isContactUnread(entry),
        ...(entry.pinnedAt ? { pinnedAt: entry.pinnedAt } : {}),
        ...(entry.projectId ? { projectId: entry.projectId } : {}),
        ...(entry.category ? { folder: entry.category } : {}),
        ...(entry.owner?.actor.id ? { ownerId: entry.owner.actor.id } : {}),
      };
    });
    topics.push(...projectedTopics);
    const latestTopic = children.toSorted(
      (a, b) =>
        (b.entry.lastActivityAt ?? b.entry.updatedAt) -
        (a.entry.lastActivityAt ?? a.entry.updatedAt),
    )[0];
    const threadAt = thread?.entry.lastActivityAt ?? thread?.entry.updatedAt ?? 0;
    const topicAt = latestTopic?.entry.lastActivityAt ?? latestTopic?.entry.updatedAt ?? 0;
    const topic = projectedTopics.find((candidate) => candidate.key === latestTopic?.sessionKey);
    const preview =
      topic && topicAt > threadAt
        ? {
            kind: "topic" as const,
            topicKey: topic.key,
            title: topic.title,
            text: input.previews?.get(topic.key) ?? "",
            at: topicAt,
          }
        : { kind: "message" as const, text: input.previews?.get(threadKey) ?? "", at: threadAt };
    const agent = agentById.get(agentId);
    contacts.push({
      id: contactId,
      kind: "trunk",
      name: agent?.name || agentId,
      face: { agentId, ...(agent?.iconUrl ? { iconUrl: agent.iconUrl } : {}) },
      threadKey,
      isDefault: agentId === input.defaultAgentId,
      ...(thread?.entry.pinnedAt ? { pinnedAt: thread.entry.pinnedAt } : {}),
      ...(!agent || thread?.entry.archivedAt
        ? { archivedAt: thread?.entry.archivedAt ?? thread?.entry.updatedAt ?? 0 }
        : {}),
      lastActivityAt: Math.max(threadAt, topicAt),
      preview,
      unreadTopics: projectedTopics.filter((candidate) => candidate.unread).length,
      threadUnread: thread ? isContactUnread(thread.entry) : false,
      needsYou: [thread, ...children].some(
        (row) =>
          Boolean(row?.entry.providerReview) ||
          row?.entry.observerDigest?.health === "waiting-on-user",
      ),
      working: [thread, ...children].some(working),
      topicCount: projectedTopics.length,
    });
  }
  const groupIds = new Set(
    visibleSessions
      .map(contactIdForSession)
      .filter((id): id is string => Boolean(id?.startsWith("chat:"))),
  );
  for (const id of groupIds) {
    const threadKey = id.slice(5);
    const row = byKey.get(threadKey);
    const children = visibleSessions.filter(
      (candidate) => candidate.sessionKey !== threadKey && contactIdForSession(candidate) === id,
    );
    const groupTopics = children.map((child): Topic => ({
      key: child.sessionKey,
      contactId: id,
      title: topicTitle(
        child,
        input.previews?.get(child.sessionKey) ?? "",
        input.titles?.get(child.sessionKey),
      ),
      labelled: Boolean(child.entry.label?.trim() || child.entry.topicName?.trim()),
      anchor: {
        threadKey,
        at: child.entry.createdAt ?? child.entry.updatedAt,
        ...(child.entry.contactAnchor?.afterMessageId
          ? { afterMessageId: child.entry.contactAnchor.afterMessageId }
          : {}),
      },
      status: child.entry.archivedAt
        ? "archived"
        : child.entry.done
          ? "done"
          : working(child)
            ? "working"
            : "active",
      unread: isContactUnread(child.entry),
      ...(child.entry.pinnedAt ? { pinnedAt: child.entry.pinnedAt } : {}),
      ...(child.entry.projectId ? { projectId: child.entry.projectId } : {}),
      ...(child.entry.category ? { folder: child.entry.category } : {}),
    }));
    topics.push(...groupTopics);
    const latest = children.toSorted(
      (a, b) =>
        (b.entry.lastActivityAt ?? b.entry.updatedAt) -
        (a.entry.lastActivityAt ?? a.entry.updatedAt),
    )[0];
    const threadAt = row?.entry.lastActivityAt ?? row?.entry.updatedAt ?? 0;
    const topicAt = latest?.entry.lastActivityAt ?? latest?.entry.updatedAt ?? 0;
    const topic = groupTopics.find((candidate) => candidate.key === latest?.sessionKey);
    contacts.push({
      id,
      kind: "chatGroup",
      name: row?.entry.subject?.trim() || row?.entry.label?.trim() || threadKey,
      threadKey,
      isDefault: false,
      ...(row?.entry.pinnedAt ? { pinnedAt: row.entry.pinnedAt } : {}),
      ...(row?.entry.archivedAt ? { archivedAt: row.entry.archivedAt } : {}),
      lastActivityAt: Math.max(threadAt, topicAt),
      preview:
        topic && topicAt > threadAt
          ? {
              kind: "topic",
              topicKey: topic.key,
              title: topic.title,
              text: input.previews?.get(topic.key) ?? "",
              at: topicAt,
            }
          : { kind: "message", text: input.previews?.get(threadKey) ?? "", at: threadAt },
      unreadTopics: groupTopics.filter((candidate) => candidate.unread).length,
      threadUnread: row ? isContactUnread(row.entry) : false,
      needsYou: [row, ...children].some(
        (candidate) =>
          Boolean(candidate?.entry.providerReview) ||
          candidate?.entry.observerDigest?.health === "waiting-on-user",
      ),
      working: [row, ...children].some(working),
      topicCount: groupTopics.length,
    });
  }
  const outsideIds = new Set([
    ...(input.outsidePeers ?? []).filter((peer) => peer.kind !== "trunk").map((peer) => peer.name),
    ...input.sessions
      .map(contactIdForSession)
      .filter((id): id is string => Boolean(id?.startsWith("a2a:")))
      .map((id) => id.slice(4)),
  ]);
  for (const peerName of outsideIds) {
    const id = `a2a:${peerName}`;
    const peer = input.outsidePeers?.find((candidate) => candidate.name === peerName);
    if (peer?.kind === "trunk") continue;
    const graftedTrunks = peer?.kind === "branch"
      ? (input.outsidePeers ?? []).filter((candidate) => candidate.kind === "trunk" && candidate.via === peerName).slice(0, 2)
      : [];
    const rows = input.sessions
      .filter((row) => contactIdForSession(row) === id)
      .toSorted(
        (a, b) =>
          (a.entry.createdAt ?? a.entry.updatedAt) - (b.entry.createdAt ?? b.entry.updatedAt) ||
          a.sessionKey.localeCompare(b.sessionKey),
      );
    const threadKey = id;
    const outsideTopics = rows.map((row): Topic => ({
      key: row.sessionKey,
      contactId: id,
      title: topicTitle(
        row,
        input.previews?.get(row.sessionKey) ?? "",
        input.titles?.get(row.sessionKey),
      ),
      labelled: Boolean(row.entry.label?.trim() || row.entry.topicName?.trim()),
      anchor: { threadKey, at: row.entry.createdAt ?? row.entry.updatedAt },
      status: row.entry.archivedAt
        ? "archived"
        : working(row)
          ? "working"
          : "active",
      unread: isContactUnread(row.entry),
      ...(row.entry.pinnedAt ? { pinnedAt: row.entry.pinnedAt } : {}),
    }));
    topics.push(...outsideTopics);
    contacts.push({
      id,
      kind: "outside",
      name: peer?.card?.name ?? peerName,
      threadKey,
      isDefault: false,
      ...(peer?.where ? { where: peer.where } : {}),
      ...(peer?.avatar ? { face: { iconUrl: peer.avatar } } : {}),
      ...(peer?.card
        ? { card: peer.card, face: peer.card.iconUrl ? { iconUrl: peer.card.iconUrl } : {} }
        : {}),
      ...(graftedTrunks.length ? { face: { trunks: graftedTrunks.map((trunk) => ({ name: trunk.card?.name ?? trunk.name, ...(trunk.avatar ? { avatar: trunk.avatar } : {}) })) } } : {}),
      // W-outside supplies the aggregate view. Do not preview a context
      // that opening this contact key cannot show yet.
      lastActivityAt: 0,
      preview: { kind: "message", text: "", at: 0 },
      unreadTopics: outsideTopics.filter((topic) => topic.unread).length,
      threadUnread: false,
      needsYou: rows.some(
        (row) =>
          Boolean(row.entry.providerReview) ||
          row.entry.observerDigest?.health === "waiting-on-user",
      ),
      working: rows.some(working),
      topicCount: outsideTopics.length,
    });
  }
  contacts.sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      Number(Boolean(b.pinnedAt)) - Number(Boolean(a.pinnedAt)) ||
      b.lastActivityAt - a.lastActivityAt,
  );
  return { contacts, topics, defaultId: `trunk:${input.defaultAgentId}` };
}

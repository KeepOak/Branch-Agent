// Who the open conversation is with, as the header pill, the composer and the agent details name it. The session's own
// `name` is the default Trunk's (read once when the window connects), so it can't name any other conversation.
import type { Topic } from "@branch/gateway-protocol";
import type { Conversation } from "../../connect/conversations";
import { agentIdOf, roomIdOf } from "../../connect/session";
import { displayTrunkTitle } from "../../connect/trunk-name";
import type { Trunk } from "../../shell/engine-data";

/**
 * A grafted agent's sidebar row opens `a2a:<peer>`: the contact's id, not a conversation. The engine files any
 * conversation key without an `agent:` prefix under the default Trunk, so opening it would show (and send into) a
 * conversation of the default Trunk.
 */
export function isGraftedContactKey(key: string | null | undefined): key is string {
  return typeof key === "string" && /^a2a:[^:]+$/.test(key);
}

/** The grafted contact (`a2a:<peer>`) a conversation is with, as the engine's contacts projection reads its key; null for any other. */
export function graftedContactOf(key: string | null | undefined): string | null {
  if (!key) return null;
  if (isGraftedContactKey(key)) return key;
  const rest = /^agent:[^:]+:(.*)$/.exec(key)?.[1] ?? "";
  const peer = /^a2a:.*:direct:([^:]+):/.exec(rest)?.[1];
  return peer ? `a2a:${peer}` : null;
}

export type OpenNameInput = {
  /** The open conversation's key, or the grafted contact's key while that contact is shown. */
  key: string | null;
  /** The open conversation's row, when the list has it. */
  row?: Pick<Conversation, "kind" | "title" | "agentId" | "groupChat"> | null;
  trunks: readonly Pick<Trunk, "id" | "name">[];
  /** Grafted agents' names by contact id (`a2a:<peer>`). */
  grafted: ReadonlyMap<string, string>;
  /** The default Trunk's id: until the Trunks list loads, its conversations read the session's name. */
  defaultAgentId?: string;
  /** The name to fall back on while nothing above is known yet. */
  fallback: string;
};

/** The open conversation's name: a group's own name, a grafted agent's name, else the name of the Trunk it belongs to. */
export function openConversationName({ key, row, trunks, grafted, defaultAgentId, fallback }: OpenNameInput): string {
  if (!key) return fallback;
  const contact = graftedContactOf(key);
  if (contact) return grafted.get(contact) || contact.slice("a2a:".length);
  if (row && (row.groupChat || row.kind === "group" || roomIdOf(key)) && row.title) return row.title;
  const agentId = agentIdOf(key) ?? row?.agentId;
  if (!agentId) return fallback;
  const own = trunks.find((trunk) => trunk.id === agentId)?.name;
  if (own) return own;
  return agentId === defaultAgentId && fallback ? fallback : displayTrunkTitle("", agentId);
}

/** The conversation a grafted agent's row opens: its most recent one that isn't archived; null when it has none. */
export function newestGraftedTopic(topics: readonly Topic[]): string | null {
  const live = topics.filter((topic) => topic.status !== "archived");
  const newest = live.reduce<Topic | null>((best, topic) => (!best || (topic.anchor?.at ?? 0) > (best.anchor?.at ?? 0) ? topic : best), null);
  return newest?.key ?? null;
}

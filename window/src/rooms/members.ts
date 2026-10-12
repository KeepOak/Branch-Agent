// Who is in a conversation, from the engine (DESIGN-SPEC §4.2.4 "Room header"): the session row's participants
// (sessions.describe `expandedParticipants`, else `participants`; schema/session-participant.ts) and the senders the
// history recorded. A conversation is a room when it is a chat-app group, or when another Trunk, another person or an
// agent on another computer is in it. Nothing here is invented: a member with no name is left out.
import type { Block } from "../thread/model";
import { A2A_CHANNEL, isMine, type Sender } from "./sender";

export type Member = { id: string; name: string };
export type Members = {
  /** The other Trunks (agent ids), not counting the conversation's own Trunk. */
  trunks: string[];
  people: Member[];
  agents: Member[];
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const NO_MEMBERS: Members = { trunks: [], people: [], agents: [] };

function add(list: Member[], m: Member): void {
  if (m.id && m.name && !list.some((x) => x.id === m.id)) list.push(m);
}

/** The session row's participants, sorted into Trunks, people and outside agents. `selfId` is left out. */
export function readParticipants(session: unknown, ownAgentId: string | undefined, selfId: string | null | undefined): Members {
  const s = rec(session);
  const raw = Array.isArray(s.expandedParticipants) ? s.expandedParticipants : Array.isArray(s.participants) ? s.participants : [];
  const out: Members = { trunks: [], people: [], agents: [] };
  for (const p of raw) {
    const identity = rec(rec(p).identity);
    const type = str(identity.type);
    const id = str(identity.id);
    const label = str(rec(p).label);
    if (!id) continue;
    if (type === "agent") {
      if (id !== ownAgentId && !out.trunks.includes(id)) out.trunks.push(id);
    } else if (type === "profile") {
      if (id !== selfId) add(out.people, { id, name: label });
    } else if (type === "observation" || type === "remote") {
      add(str(identity.pluginId) === A2A_CHANNEL ? out.agents : out.people, { id, name: label });
    }
  }
  return out;
}

/** The senders the thread shows, merged into the participants (the engine keeps at most 32 participants). */
export function withSenders(base: Members, history: readonly Block[], ownAgentId: string | undefined, selfId: string | null | undefined): Members {
  const out: Members = { trunks: [...base.trunks], people: [...base.people], agents: [...base.agents] };
  for (const b of history) {
    if (b.kind !== "user" && b.kind !== "text") continue;
    const sender: Sender | undefined = b.meta?.sender;
    if (!sender) continue;
    if (sender.kind === "trunk") {
      if (sender.agentId !== ownAgentId && !out.trunks.includes(sender.agentId)) out.trunks.push(sender.agentId);
    } else if (sender.kind === "agent") {
      add(out.agents, { id: sender.id, name: sender.name });
    } else if (!isMine(sender, b.meta?.owner === true, selfId)) {
      add(out.people, { id: sender.id, name: sender.name });
    }
  }
  return out;
}

/** A chat-app group (sessions row kind "group", or chatType group / channel). */
export function isChatAppGroup(session: unknown, rowKind: string | undefined): boolean {
  const s = rec(session);
  const chatType = str(s.chatType);
  return rowKind === "group" || str(s.kind) === "group" || chatType === "group" || chatType === "channel";
}

/** A room: a chat-app group, or a conversation the engine says other Trunks, people or outside agents are in. */
export function isRoom(session: unknown, rowKind: string | undefined, participants: Members): boolean {
  return isChatAppGroup(session, rowKind) || participants.trunks.length > 0 || participants.people.length > 0 || participants.agents.length > 0;
}

const first = (name: string) => name.split(/\s+/)[0] || name;

/**
 * The room's description for the header's state line (the preview's c.role): its people (first names), its Trunks,
 * its outside agents, then "and you" ("<person>, <Trunk>, <Trunk>, <agent> and you").
 */
export function describeMembers(members: Members, ownTrunk: string, trunkName: (agentId: string) => string): string {
  const names = [...members.people.map((p) => first(p.name)), ownTrunk, ...members.trunks.map(trunkName), ...members.agents.map((a) => a.name)];
  const unique = names.filter((n, i) => n && names.indexOf(n) === i);
  return `${unique.join(", ")} and you`;
}

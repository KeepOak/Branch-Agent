// Who wrote a message, read from what the engine records on each `chat.history` entry (DESIGN-SPEC §4.2.4):
// - a person: `__branch.senderIdentity` of type "profile" (the Gateway profile, with `senderProfileAvatarUrl`), or a
//   chat-app "observation" / "remote" sender, named by `__branch.senderName` or the message's `senderLabel`;
// - an agent on another computer: an observation whose channel (`pluginId`) is "a2a" (extensions/a2a/src/inbound.ts);
// - another Trunk: a message forwarded from that Trunk's conversation, which the engine shows as an assistant entry
//   with `senderSession.agentId` (gateway/chat-display-projection.history.ts projectForwardedMessages).
// The window's own messages carry the viewer's profile, or `senderIsOwner`; `isMine` tells them apart.

export type Sender =
  | { kind: "person"; id: string; name: string; avatarUrl?: string; channel?: string }
  | { kind: "agent"; id: string; name: string; channel: string }
  /** `posted`: from the group chat's own log (room_post, or a room Trunk's reply), not forwarded by sessions_send. */
  | { kind: "trunk"; agentId: string; name?: string; posted?: boolean };

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The A2A channel's id (extensions/a2a: `channel: "a2a"`). */
export const A2A_CHANNEL = "a2a";

/** A sender label "Forwarded from <Trunk>" names the Trunk; the bare name is what the thread shows. */
function forwardedName(label: string): string {
  return label.replace(/^Forwarded from\s+/i, "").trim();
}

/** A message forwarded from another Trunk's conversation. An automation's delivery carries the job's name as
 *  `senderSession.label` (projectForwardedMessages); that is not a Trunk talking, so it is left as it was. */
function readTrunk(m: Rec): Sender | undefined {
  const from = rec(m.senderSession);
  const agentId = str(from.agentId);
  if (!agentId || str(from.label)) return undefined;
  const label = forwardedName(str(m.senderLabel));
  return { kind: "trunk", agentId, ...(label && label !== agentId ? { name: label } : {}) };
}

function readPerson(m: Rec): Sender | undefined {
  const meta = rec(m.__branch);
  const identity = rec(meta.senderIdentity);
  const type = str(identity.type);
  const id = str(identity.id) || str(meta.senderId);
  const name = str(meta.senderName) || str(m.senderLabel) || str(meta.senderUsername);
  if (!id || !name) return undefined;
  const channel = str(identity.pluginId) || undefined;
  if ((type === "observation" || type === "remote") && channel === A2A_CHANNEL) {
    return { kind: "agent", id, name, channel };
  }
  if (type !== "profile" && type !== "observation" && type !== "remote") return undefined;
  const avatarUrl = str(meta.senderProfileAvatarUrl) || undefined;
  return { kind: "person", id, name, ...(avatarUrl ? { avatarUrl } : {}), ...(channel ? { channel } : {}) };
}

/** The sender of one `chat.history` message, when the engine recorded one; undefined for plain own messages. */
export function readSender(message: unknown): Sender | undefined {
  const m = rec(message);
  if (m.role === "assistant") return readTrunk(m);
  if (m.role !== "user") return undefined;
  return readPerson(m);
}

/** Whether the engine marked the message as the owner's own (`__branch.senderIsOwner`). */
export function readOwner(message: unknown): boolean {
  return rec(rec(message).__branch).senderIsOwner === true;
}

/**
 * True when a person's message is the viewer's own: one the engine marks as the owner's, or one carrying the viewer's
 * profile. `selfId` is the viewer's profile id (users.self): null when the connection has no signed-in person,
 * undefined while it is still being read (a profile message then counts as the viewer's, so nothing flips sides).
 */
export function isMine(sender: Sender | undefined, owner: boolean, selfId: string | null | undefined): boolean {
  if (!sender) return true;
  if (sender.kind !== "person") return false;
  if (owner) return true;
  if (sender.channel) return false;
  return selfId === undefined || sender.id === selfId;
}

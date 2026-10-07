// What the thread needs to draw messages from other people, outside agents and other Trunks (DESIGN-SPEC §4.2.4).
// Sender rendering works in any conversation (an A2A agent writes into a one-to-one conversation too); being a room
// only adds the sender's name over each Trunk run.
import type { Block } from "../thread/model";
import { isMine, type Sender } from "./sender";

export type ThreadRoom = {
  isRoom: boolean;
  selfId: string | null | undefined;
  ownAgentId?: string;
  trunkName: (agentId: string) => string;
  whereRuns: (peer: string) => string | null;
  isOnline?: (peer: string) => boolean;
};

type Other = Extract<Sender, { kind: "person" | "agent" }>;

/** The person or outside agent who wrote a "user" block, when it isn't the viewer. */
export function otherSender(block: Extract<Block, { kind: "user" }>, room: ThreadRoom | undefined): Other | null {
  const sender = block.meta?.sender;
  if (!room || !sender || sender.kind === "trunk") return null;
  return isMine(sender, block.meta?.owner === true, room.selfId) ? null : sender;
}

/** In a room, the name over the first block of a Trunk's run: the forwarding Trunk, else the room's own Trunk. */
export function fromName(block: Extract<Block, { kind: "text" }>, firstReply: boolean, room: ThreadRoom | undefined, ownName: string): string | undefined {
  if (!room?.isRoom || !firstReply) return undefined;
  const sender = block.meta?.sender;
  return sender?.kind === "trunk" ? room.trunkName(sender.agentId) : ownName;
}

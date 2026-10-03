// Trunks talking to each other (DESIGN-SPEC §4.2.4 rule 2): one fold per exchange, never a stream of replies.
// When another Trunk messages this one (sessions_send), the engine shows its message as a forwarded entry with
// `senderSession.agentId`; this Trunk's answers follow. The run of forwarded messages and answers becomes one
// "<A> and <B> talked it through · <n> messages" fold. Thinking and Done lines inside the exchange stay in it;
// anything else (steps, approvals, errors, your messages) ends it, so nothing that needs you is folded away.
import type { Item } from "../thread/layout";
import type { Block } from "../thread/model";

export type TalkLine = { key: string; agentId: string | null; text: string };
export type TalkItem = { type: "talk"; key: string; from: string; lines: TalkLine[] };
export type RoomItem = Item | TalkItem;

/** The other Trunk a block was forwarded from, or null when it isn't from another Trunk. */
function otherTrunk(block: Block, ownAgentId: string | undefined): string | null {
  if (block.kind !== "text") return null;
  const sender = block.meta?.sender;
  return sender?.kind === "trunk" && sender.agentId !== ownAgentId ? sender.agentId : null;
}

const quiet = (block: Block) => block.kind === "thinking" || block.kind === "done";

/** Folds each exchange between Trunks into one talk item; every other item is returned as it was. */
export function foldTalks(items: readonly Item[], ownAgentId: string | undefined): RoomItem[] {
  const out: RoomItem[] = [];
  let talk: TalkItem | null = null;
  for (const item of items) {
    const block = item.type === "block" ? item.block : null;
    const from = block ? otherTrunk(block, ownAgentId) : null;
    if (block?.kind === "text" && from) {
      if (!talk) {
        talk = { type: "talk", key: `talk:${block.key}`, from, lines: [] };
        out.push(talk);
      }
      if (block.text.trim()) talk.lines.push({ key: block.key, agentId: from, text: block.text });
      continue;
    }
    if (talk && block?.kind === "text") {
      if (block.text.trim()) talk.lines.push({ key: block.key, agentId: null, text: block.text });
      continue;
    }
    if (talk && block && quiet(block)) continue;
    talk = null;
    out.push(item);
  }
  return out;
}

/** "<A> and <B> talked it through · <n> messages". */
export function talkSummary(fromName: string, ownName: string, count: number): string {
  return `${fromName} and ${ownName} talked it through · ${count === 1 ? "1 message" : `${count} messages`}`;
}

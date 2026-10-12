// Trunks talking to each other (DESIGN-SPEC §4.2.4 rule 2): one collapsed row per exchange, never a stream of
// replies, so the room reads as the Trunks' reports to you (Grok parity X06: "3 messages with 2 agents").
// - A Trunk messaging this one (sessions_send) shows as a forwarded entry with `senderSession.agentId`; this Trunk's
//   answers follow. That run of forwarded messages and answers is agent-to-agent talk.
// - A group chat's own log (room_post, and the replies of the room's other Trunks) is `sender.posted`: a Trunk's first
//   message after a person writes is its report and stays in the thread; any more before the next person's message is
//   the Trunks talking among themselves and folds.
// Thinking and Done lines inside an exchange stay in it; anything else (steps, approvals, errors, a person's message)
// ends it, so nothing that needs you is folded away.
import type { Item } from "../thread/layout";
import type { Block } from "../thread/model";

export type TalkLine = { key: string; agentId: string | null; text: string };
export type TalkItem = { type: "talk"; key: string; from: string; lines: TalkLine[]; withOwn: boolean };
export type RoomItem = Item | TalkItem;

type TrunkText = { agentId: string; posted: boolean };

/** The other Trunk a reply came from, or null when it is the room's own Trunk. */
function otherTrunk(block: Block, ownAgentId: string | undefined): TrunkText | null {
  if (block.kind !== "text") return null;
  const sender = block.meta?.sender;
  return sender?.kind === "trunk" && sender.agentId !== ownAgentId ? { agentId: sender.agentId, posted: sender.posted === true } : null;
}

const quiet = (block: Block) => block.kind === "thinking" || block.kind === "done";

/** Folds each exchange between Trunks into one talk item; every other item is returned as it was. */
export function foldTalks(items: readonly Item[], ownAgentId: string | undefined): RoomItem[] {
  const out: RoomItem[] = [];
  let talk: TalkItem | null = null;
  // The Trunks that already reported since a person last wrote ("" is the room's own Trunk).
  let reported = new Set<string>();
  // The last message shown was another Trunk's report: the room's own Trunk answering it is talking to that Trunk.
  let afterReport = false;
  for (const item of items) {
    const block = item.type === "block" ? item.block : null;
    if (block?.kind === "user") reported = new Set();
    const from = block ? otherTrunk(block, ownAgentId) : null;
    if (block?.kind === "text" && from) {
      if (from.posted && !reported.has(from.agentId)) {
        reported.add(from.agentId);
        talk = null;
        afterReport = true;
        out.push(item);
        continue;
      }
      if (!talk) {
        talk = { type: "talk", key: `talk:${block.key}`, from: from.agentId, lines: [], withOwn: !from.posted };
        out.push(talk);
      }
      if (block.text.trim()) talk.lines.push({ key: block.key, agentId: from.agentId, text: block.text });
      continue;
    }
    if (talk && block?.kind === "text") {
      talk.withOwn = true;
      afterReport = false;
      if (block.text.trim()) talk.lines.push({ key: block.key, agentId: null, text: block.text });
      continue;
    }
    if (block?.kind === "text" && afterReport && reported.has("")) {
      talk = { type: "talk", key: `talk:${block.key}`, from: ownAgentId ?? "", lines: [], withOwn: true };
      out.push(talk);
      if (block.text.trim()) talk.lines.push({ key: block.key, agentId: null, text: block.text });
      afterReport = false;
      continue;
    }
    if (talk && block && quiet(block)) continue;
    if (block && quiet(block)) {
      out.push(item);
      continue;
    }
    if (block?.kind === "text") reported.add("");
    talk = null;
    afterReport = false;
    out.push(item);
  }
  return out;
}

/** The agents in an exchange: everyone who wrote in it, and the room's own Trunk when it was spoken to. */
export function talkAgents(talk: TalkItem): (string | null)[] {
  const ids: (string | null)[] = [];
  for (const line of talk.lines) if (!ids.includes(line.agentId)) ids.push(line.agentId);
  if (talk.withOwn && !ids.includes(null)) ids.push(null);
  return ids;
}

/** "<n> messages with <k> agents". */
export function talkSummary(messages: number, agents: number): string {
  return `${messages === 1 ? "1 message" : `${messages} messages`} with ${agents === 1 ? "1 agent" : `${agents} agents`}`;
}

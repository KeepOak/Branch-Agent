import type { Block } from "../thread/model";

/** Preview lastLineT5: each thread's own last user/text block, not the open session. */
export function topicSenderPrefix(last: { kind: string } | undefined, contactName: string): string {
  return last?.kind === "user" ? "You" : last?.kind === "text" ? contactName : "";
}

/** General plus each child topic, so General's who stays on General when a child is open. */
export function topicSpeakerKeys(generalKey: string, topics: readonly { key: string }[]): string[] {
  return [generalKey, ...topics.map((topic) => topic.key)];
}

/** lastLineT5 over a thread's own blocks. */
export function lastSpeakerWho(blocks: readonly Pick<Block, "kind">[], contactName: string): string {
  return topicSenderPrefix(blocks.findLast((block) => block.kind === "user" || block.kind === "text"), contactName);
}

import type { Block } from "../thread/model";

/** Preview lastLineT5: You for a person line, otherwise the contact who said it. */
export function lastSpeakerWho(blocks: readonly Pick<Block, "kind">[], contactName: string): string {
  const last = blocks.findLast((block) => block.kind === "user" || block.kind === "text");
  return last?.kind === "user" ? "You" : last?.kind === "text" ? contactName : "";
}

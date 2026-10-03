// How the thread lays its blocks out: consecutive steps share one Steps fold, and each Trunk turn's first
// reply carries the gutter face (DESIGN-SPEC §4.2.2 gutter rule).
import type { Block } from "./model";

type Step = Extract<Block, { kind: "step" }>;

export type Item =
  | { type: "block"; block: Block; index: number; firstReply: boolean }
  | { type: "steps"; key: string; steps: Step[] };

/** Groups blocks for drawing. `index` is the block's place in the list the actions read. */
export function layout(blocks: readonly Block[], offset = 0): Item[] {
  const items: Item[] = [];
  let replied = false;
  blocks.forEach((block, i) => {
    if (block.kind === "user") {
      replied = false;
    }
    if (block.kind === "step") {
      const last = items[items.length - 1];
      if (last?.type === "steps") {
        last.steps.push(block);
      } else {
        items.push({ type: "steps", key: `steps:${block.key}`, steps: [block] });
      }
      return;
    }
    const firstReply = block.kind === "text" && !replied;
    if (block.kind === "text") {
      replied = true;
    }
    items.push({ type: "block", block, index: offset + i, firstReply });
  });
  return items;
}

/** The blocks of the turn a block belongs to: from after the user message before it to the next user message. */
export function turnOf(blocks: readonly Block[], index: number): Block[] {
  let start = index;
  while (start > 0 && blocks[start - 1].kind !== "user") start -= 1;
  let end = index;
  while (end + 1 < blocks.length && blocks[end + 1].kind !== "user") end += 1;
  return blocks.slice(start, end + 1);
}

/** The pending approvals the run hasn't drawn as a card yet (raised before this connection, or by a plugin). */
export function shownApprovalIds(blocks: readonly Block[]): Set<string> {
  return new Set(blocks.filter((b): b is Extract<Block, { kind: "approval" }> => b.kind === "approval").map((b) => b.approval.id));
}

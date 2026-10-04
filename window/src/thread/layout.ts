// How the thread lays its blocks out: consecutive steps share one Steps fold, and each Trunk turn's first
// item carries the gutter face, as the approved design draws it: the Steps fold when the turn starts with steps,
// else the first reply.
import type { Block } from "./model";

type Step = Extract<Block, { kind: "step" }>;

export type Item =
  | { type: "block"; block: Block; index: number; firstReply: boolean; face: boolean }
  | { type: "steps"; key: string; steps: Step[]; face: boolean };

/** Groups blocks for drawing. `index` is the block's place in the list the actions read. */
export function layout(blocks: readonly Block[], offset = 0): Item[] {
  const items: Item[] = [];
  let replied = false;
  let faced = false;
  blocks.forEach((block, i) => {
    if (block.kind === "user") {
      replied = false;
      faced = false;
    }
    if (block.kind === "step") {
      const last = items[items.length - 1];
      if (last?.type === "steps") {
        last.steps.push(block);
      } else {
        items.push({ type: "steps", key: `steps:${block.key}`, steps: [block], face: !faced });
        faced = true;
      }
      return;
    }
    const firstReply = block.kind === "text" && !replied;
    const face = firstReply && !faced;
    if (block.kind === "text") {
      replied = true;
      faced = true;
    }
    items.push({ type: "block", block, index: offset + i, firstReply, face });
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

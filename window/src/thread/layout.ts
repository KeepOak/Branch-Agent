// How the thread lays its blocks out: consecutive steps share one Steps fold, and each Trunk turn's first
// item carries the gutter face, as the approved design draws it: the Steps fold when the turn starts with steps,
// else the first reply. A new user message or a new run always starts a new fold (preview stepsPB18 / threads.fixPB18).
import type { Block } from "./model";
import { isInternalStep } from "./internal-steps";

type Step = Extract<Block, { kind: "step" }>;

/** The run a step belongs to (`outputKey` is `${runId}:${step.key}` from projectRun / history). */
export function stepRunId(step: Step): string | undefined {
  const key = step.outputKey;
  if (!key) return undefined;
  const suffix = `:${step.key}`;
  return key.endsWith(suffix) ? key.slice(0, -suffix.length) : undefined;
}

function sameStepRun(a: Step, b: Step): boolean {
  const left = stepRunId(a);
  const right = stepRunId(b);
  return !left || !right || left === right;
}

/** Browser, computer, screen or desktop rows the conversation's activity card groups. */
export function isComputerStep(block: Block): block is Step {
  return block.kind === "step" && /browser|computer|screen|desktop/i.test(block.tool);
}

export type Item =
  | { type: "block"; block: Block; index: number; firstReply: boolean; face: boolean }
  | { type: "steps"; key: string; steps: Step[]; face: boolean; run?: RunLine };

/** What a finished turn's Steps fold names: the reply's first line and how long the run took (the design's
 *  "Sorted 214 files · 5 steps · 1m 12s"). */
export type RunLine = { title: string; durationMs?: number };

/** Groups blocks for drawing. `index` is the block's place in the list the actions read. */
export function layout(blocks: readonly Block[], offset = 0): Item[] {
  const items: Item[] = [];
  // A steered note that came between two steps waits until the fold ends, so the turn keeps one Steps fold.
  let held: Item[] = [];
  let replied = false;
  let faced = false;
  // A user message (or a later step from another run) must not join the fold that just closed.
  let sealSteps = false;
  blocks.forEach((block, i) => {
    if (isInternalStep(block)) return;
    if (block.kind === "user") {
      replied = false;
      faced = false;
      sealSteps = true;
    }
    if (block.kind === "steer" && items.at(-1)?.type === "steps") {
      held.push({ type: "block", block, index: offset + i, firstReply: false, face: false });
      return;
    }
    // A Thinking row between two tool-call rounds of one run waits too, so the run's steps stay one fold.
    if (block.kind === "thinking" && items.at(-1)?.type === "steps" && !sealSteps) {
      held.push({ type: "block", block, index: offset + i, firstReply: false, face: false });
      return;
    }
    if (block.kind !== "step" && held.length) {
      items.push(...held);
      held = [];
    }
    if (block.kind === "step") {
      const last = items[items.length - 1];
      const canMerge = last?.type === "steps" && !sealSteps && sameStepRun(last.steps[0], block);
      if (canMerge) {
        last.steps.push(block);
      } else {
        items.push(...held);
        held = [];
        items.push({ type: "steps", key: `steps:${block.key}`, steps: [block], face: !faced, run: runLine(blocks, i) });
        faced = true;
      }
      sealSteps = false;
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
  return [...items, ...held];
}

/** The first line of a reply, as plain words: no Markdown marks, no closing full stop, at most 80 characters. */
export function titleOf(text: string): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const plain = line.replace(/^(#+|[-*+]|\d+[.)])\s+/, "").replace(/[*_`~]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[.:]$/, "").trim();
  return plain.length > 80 ? `${plain.slice(0, 79).trimEnd()}…` : plain;
}

/** The finished turn after the steps starting at `from`: its reply's first line and its run's length, if it has a reply. */
function runLine(blocks: readonly Block[], from: number): RunLine | undefined {
  let title = "";
  for (let i = from + 1; i < blocks.length && blocks[i].kind !== "user"; i++) {
    const b = blocks[i];
    if (b.kind === "text" && !b.streaming && !title) title = titleOf(b.text);
    if (b.kind === "done") return title ? { title, durationMs: b.durationMs } : undefined;
  }
  return undefined;
}

/** The blocks of a turn: a user message starts its turn; reply blocks start after that user message. */
export function turnOf(blocks: readonly Block[], index: number): Block[] {
  let start = index;
  while (blocks[index].kind !== "user" && start > 0 && blocks[start - 1].kind !== "user") start -= 1;
  let end = index;
  while (end + 1 < blocks.length && blocks[end + 1].kind !== "user") end += 1;
  return blocks.slice(start, end + 1);
}

/** The pending approvals the run hasn't drawn as a card yet (raised before this connection, or by a plugin). */
export function shownApprovalIds(blocks: readonly Block[]): Set<string> {
  return new Set(blocks.filter((b): b is Extract<Block, { kind: "approval" }> => b.kind === "approval").map((b) => b.approval.id));
}

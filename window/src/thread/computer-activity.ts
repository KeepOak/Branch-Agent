// Turn-scoped computer/browser actions, matching the preview: each conversation turn has its own
// acts card (spec-v23 `actsCuR218` after that turn's `steps` / `stepsPB18`), never one card for the
// whole thread.
import type { Block } from "./model";

export type ComputerStep = Extract<Block, { kind: "step" }>;

/** Browser, computer, screen or desktop tool rows the activity card groups. */
export function isComputerStep(block: Block): block is ComputerStep {
  return block.kind === "step" && /browser|computer|screen|desktop/i.test(block.tool);
}

/** The run a step belongs to (`outputKey` is `${runId}:${step.key}` from projectRun / history). */
export function stepRunId(step: ComputerStep): string | undefined {
  const key = step.outputKey;
  if (!key) return undefined;
  const suffix = `:${step.key}`;
  return key.endsWith(suffix) ? key.slice(0, -suffix.length) : undefined;
}

/**
 * Groups computer/browser steps so a new user message or a new run always starts a new card.
 * Other blocks stay in place; they only close the current group.
 */
export function computerActivityTurns(blocks: readonly Block[]): ComputerStep[][] {
  const turns: ComputerStep[][] = [];
  let current: ComputerStep[] = [];
  let run: string | undefined;
  const flush = (): void => {
    if (current.length) turns.push(current);
    current = [];
    run = undefined;
  };
  for (const block of blocks) {
    if (block.kind === "user") {
      flush();
      continue;
    }
    if (!isComputerStep(block)) continue;
    const next = stepRunId(block);
    if (current.length && next && run && next !== run) flush();
    current.push(block);
    run = next ?? run;
  }
  flush();
  return turns;
}

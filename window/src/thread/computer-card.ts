import type { Block, StepStatus } from "./model";

/** The four states of the preview's `computerCard` (design/spec-v23). */
export type ComputerCardState = "working" | "yours" | "stopped" | "done";

/** Which conversation-card state to show: you driving, live work, a stop, or finished. */
export function computerCardState(input: {
  running: boolean;
  status: StepStatus;
  controlling: boolean;
  stopped: boolean;
}): ComputerCardState {
  if (input.controlling) return "yours";
  if (input.running && input.status === "running") return "working";
  if (input.stopped || input.status === "failed" || input.status === "denied") return "stopped";
  return "done";
}

/** A turn the person or the engine stopped (the thread's Done line carries `stopped`). */
export function runWasStopped(blocks: readonly Block[]): boolean {
  return blocks.some((block) => block.kind === "done" && block.stopped === true);
}

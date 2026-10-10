import { stepRunId } from "./layout";
import type { Block, StepStatus } from "./model";

type Step = Extract<Block, { kind: "step" }>;
type Done = Extract<Block, { kind: "done" }>;

/** The four states of the preview's `computerCard` (design/spec-v23). */
export type ComputerCardState = "working" | "yours" | "stopped" | "done";

/** Which conversation-card state to show: you driving, live work, a stop, or finished. */
export function computerCardState(input: {
  running: boolean;
  status: StepStatus;
  controlling: boolean;
  stopped: boolean;
}): ComputerCardState {
  if (input.stopped || input.status === "failed" || input.status === "denied") return "stopped";
  if (input.status === "running" && input.running) return input.controlling ? "yours" : "working";
  return "done";
}

/** The stage and the conversation card share take-over through this event (`branch:*` like the others). */
export const COMPUTER_CONTROL_EVENT = "branch:computer-control";

/** Tell the conversation card (and an open stage) whether the person is driving. */
export function announceComputerControl(controlling: boolean): void {
  window.dispatchEvent(new CustomEvent(COMPUTER_CONTROL_EVENT, { detail: { controlling } }));
}

/** Follow take-over from the stage or the conversation card. */
export function listenComputerControl(onControl: (controlling: boolean) => void): () => void {
  const handler = (event: Event) => {
    const controlling = (event as CustomEvent<{ controlling?: boolean }>).detail?.controlling;
    if (typeof controlling === "boolean") onControl(controlling);
  };
  window.addEventListener(COMPUTER_CONTROL_EVENT, handler);
  return () => window.removeEventListener(COMPUTER_CONTROL_EVENT, handler);
}

/** Done lines that belong to these steps' run (Thread passes steps only; pair them here). */
export function turnDoneLines(steps: readonly Block[], all: readonly Block[]): Done[] {
  const ids = new Set(
    steps
      .filter((block): block is Step => block.kind === "step")
      .map((step) => stepRunId(step))
      .filter((id): id is string => Boolean(id)),
  );
  if (!ids.size) return [];
  return all.filter((block): block is Done => block.kind === "done" && Boolean(block.runId) && ids.has(block.runId));
}

/** A turn the person or the engine stopped (that turn's own Done line, not an earlier one). */
export function runWasStopped(blocks: readonly Block[]): boolean {
  const stepIds = new Set(
    blocks
      .filter((block): block is Step => block.kind === "step")
      .map((step) => stepRunId(step))
      .filter((id): id is string => Boolean(id)),
  );
  const dones = blocks.filter((block): block is Done => block.kind === "done");
  if (stepIds.size) return dones.some((done) => done.stopped === true && Boolean(done.runId) && stepIds.has(done.runId));
  return dones.at(-1)?.stopped === true;
}

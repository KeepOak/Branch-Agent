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
  if (input.stopped || input.status === "failed" || input.status === "denied") return "stopped";
  if (!input.running) return "done";
  if (input.controlling) return "yours";
  if (input.status === "running") return "working";
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

/** A turn the person or the engine stopped (the thread's Done line carries `stopped`). */
export function runWasStopped(blocks: readonly Block[]): boolean {
  return blocks.some((block) => block.kind === "done" && block.stopped === true);
}

// The onboarding "Try it with examples" action (Models.tsx): ask the engine for the example Trunks it carries
// (trunks.template.starters) and read them with readExamples. The command palette and the Trunks page call
// startTryExamples, which is that same call, and the Trunks page draws the offer. Opening the conversation
// hands the default Trunk's main session to the window, which shows the examples greeting.
import { useSyncExternalStore } from "react";
import { EXAMPLES_REASON, mainSessionOf, readExamples, WAITS_FOR, type Example } from "./model";

export { EXAMPLES_REASON };
export const TRY_EXAMPLES_METHOD = WAITS_FOR.examples;

export type ExampleRequester = (method: string, params?: unknown) => Promise<unknown>;

/** The onboarding call: list the example Trunks this engine carries. */
export async function loadExampleTrunks(request: ExampleRequester): Promise<Example[]> {
  return readExamples(await request(TRY_EXAMPLES_METHOD, {}));
}

export function examplesErrorText(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Couldn’t load the examples. ${detail}`;
}

/** The line under the offer, the same words onboarding uses once the list has loaded. */
export function examplesHint(count: number): string {
  return count
    ? "Example Trunks Branch can make for you. Add a model any time in Settings › Accounts & usage."
    : "This engine has no example Trunks yet. You can still look around, and add a model any time in Settings › Accounts & usage.";
}

/** The default Trunk's main conversation, where the examples greeting is shown. */
export function examplesConversationKey(defaultId: string, mainKey: string): string | null {
  return defaultId ? mainSessionOf(defaultId, mainKey) : null;
}

/** The Trunks page asks the window to open this conversation in examples mode. */
export const EXAMPLES_READY_EVENT = "branch:examples-ready";

export type TryExamplesState =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "ready"; examples: Example[] }
  | { status: "error"; message: string };

let state: TryExamplesState = { status: "idle" };
const listeners = new Set<() => void>();

function emit(next: TryExamplesState) {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function tryExamplesState(): TryExamplesState {
  return state;
}

export function subscribeTryExamples(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tests start from idle. The running app keeps the offer until the next try. */
export function resetTryExamples(): void {
  emit({ status: "idle" });
}

export function useTryExamples(): TryExamplesState {
  return useSyncExternalStore(subscribeTryExamples, tryExamplesState, tryExamplesState);
}

/** Palette and Trunks page: the onboarding action, kept so the Trunks page can draw the offer. */
export function startTryExamples(request: ExampleRequester): void {
  if (state.status === "busy") return;
  emit({ status: "busy" });
  void loadExampleTrunks(request).then(
    (examples) => emit({ status: "ready", examples }),
    (error: unknown) => emit({ status: "error", message: examplesErrorText(error) }),
  );
}

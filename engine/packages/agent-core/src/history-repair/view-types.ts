// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/properties/base.py (atlas AGENT-LOOP-0093). Converted to TypeScript; events keep payloads opaque to invariant enforcement.
export interface ViewEvent {
  id: string;
  kind: "message" | "action" | "observation" | "condensation" | "request" | "summary";
  convertible: boolean;
  toolCallId?: string;
  llmResponseId?: string;
  thinking?: boolean;
  forgotten?: string[];
  summary?: string | null;
  offset?: number | null;
  source?: string;
  message?: unknown;
}
export interface ViewProperty {
  enforce(view: ViewEvent[], all: ViewEvent[]): Set<string>;
  manipulationIndices(view: ViewEvent[]): Set<number>;
}
export const complete = (events: ViewEvent[]): Set<number> => new Set(Array.from({ length: events.length + 1 }, (_, i) => i));
export const subset = <T>(a: Set<T>, b: Set<T>): boolean => [...a].every(v => b.has(v));

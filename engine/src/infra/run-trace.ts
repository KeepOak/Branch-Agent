// One line per step of an agent message: accepted, run started, first token, then final or failed.
// Every line carries the run id, so "the agent ignored me" can be placed at the step it stopped at.
// Lines hold only ids, the agent id and short codes. They never hold message text or error text.
import { createSubsystemLogger } from "../logging/subsystem.js";

export type RunTraceStep = "accept" | "run-start" | "first-token" | "final" | "failed";

type TraceSink = (line: string) => void;

const log = createSubsystemLogger("run-trace");
let sink: TraceSink = (line) => log.info(line);
const MAX_TRACKED_RUNS = 512;
const firstTokenSeen = new Set<string>();

/** Tests replace the sink; production writes through the engine logger. */
export function setRunTraceSinkForTest(next: TraceSink | undefined): void {
  sink = next ?? ((line) => log.info(line));
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:@-]{1,80}$/;

function field(name: string, value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? `${name}=${value}` : undefined;
}

export function traceRunStep(
  runId: string,
  step: RunTraceStep,
  fields: { agent?: unknown; code?: unknown } = {},
): void {
  const parts = [
    `trace id=${runId}`,
    `step=${step}`,
    field("agent", fields.agent),
    field("code", fields.code),
  ];
  sink(parts.filter((part): part is string => part !== undefined).join(" "));
}

/** Maps one run event to its trace step. Only the first assistant event of a run is a first token. */
export function traceAgentRunEvent(event: {
  runId: string;
  stream: string;
  data: Record<string, unknown>;
  agentId?: string;
}): void {
  try {
    if (event.stream === "lifecycle") {
      traceLifecycle(event);
      return;
    }
    if (event.stream === "assistant" && !firstTokenSeen.has(event.runId)) {
      if (firstTokenSeen.size >= MAX_TRACKED_RUNS) {
        firstTokenSeen.clear();
      }
      firstTokenSeen.add(event.runId);
      traceRunStep(event.runId, "first-token", { agent: event.agentId });
    }
  } catch {
    // Tracing must never stop a run.
  }
}

function traceLifecycle(event: {
  runId: string;
  data: Record<string, unknown>;
  agentId?: string;
}): void {
  const phase = event.data.phase;
  if (phase === "start") {
    traceRunStep(event.runId, "run-start", { agent: event.agentId });
  } else if (phase === "end") {
    traceRunStep(event.runId, "final", { agent: event.agentId });
  } else if (phase === "error") {
    traceRunStep(event.runId, "failed", { agent: event.agentId, code: event.data.code });
  }
}

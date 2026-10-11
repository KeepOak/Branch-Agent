// One line per step of an agent message: accepted, run started, first token, then final or failed.
// Every line carries the run id, so "the agent ignored me" can be placed at the step it stopped at.
// Lines hold only ids, the agent id and a closed set of error codes. They never hold message text
// or error text, and an unknown code is written as "other".
import { ErrorCodes } from "../../packages/gateway-protocol/src/index.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type RunTraceStep = "accept" | "run-start" | "first-token" | "final" | "failed";

type TraceSink = (line: string) => void;

const log = createSubsystemLogger("run-trace");
let sink: TraceSink = (line) => log.info(line);
/** Runs whose first token was already traced. Oldest entries go first, so a run keeps its entry while it is recent. */
const MAX_TRACKED_RUNS = 512;
const firstTokenRuns = new Map<string, true>();
const KNOWN_CODES: ReadonlySet<string> = new Set<string>(Object.values(ErrorCodes));
const MAX_CODE_LENGTH = 40;
// Run ids are UUIDs or "run-" names. Anything else is not written, so free text cannot ride in on an id.
const RUN_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|run-[a-z0-9-]{1,40})$/i;
const SAFE_ID = /^[A-Za-z0-9_.:@-]{1,80}$/;

/** Tests replace the sink; production writes through the engine logger. */
export function setRunTraceSinkForTest(next: TraceSink | undefined): void {
  sink = next ?? ((line) => log.info(line));
}

/** A run id comes from the caller's request, so it is checked too. A value that fails the pattern is logged as "invalid". */
function runIdField(runId: unknown): string {
  return typeof runId === "string" && RUN_ID.test(runId) ? runId : "invalid";
}

/** Agent ids are configured names and pass the identifier pattern; anything else is left out. */
function agentField(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ID.test(value) ? `agent=${value}` : undefined;
}

/** A known gateway error code is written as is. Any other code is written as "other", so no free text reaches the log. */
export function traceCode(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === "string" && value.length <= MAX_CODE_LENGTH && KNOWN_CODES.has(value)
    ? `code=${value}`
    : "code=other";
}

export function traceRunStep(
  runId: string,
  step: RunTraceStep,
  fields: { agent?: unknown; code?: unknown } = {},
): void {
  const parts = [
    `trace id=${runIdField(runId)}`,
    `step=${step}`,
    agentField(fields.agent),
    traceCode(fields.code),
  ];
  sink(parts.filter((part): part is string => part !== undefined).join(" "));
}

/**
 * Returns true the first time a run reaches its first token. Every call moves the run to the newest
 * position, so a run that is still streaming is never the one evicted; the oldest idle run goes first.
 */
function markFirstToken(runId: string): boolean {
  const seen = firstTokenRuns.has(runId);
  firstTokenRuns.delete(runId);
  if (!seen && firstTokenRuns.size >= MAX_TRACKED_RUNS) {
    const oldest = firstTokenRuns.keys().next().value;
    if (oldest !== undefined) {
      firstTokenRuns.delete(oldest);
    }
  }
  firstTokenRuns.set(runId, true);
  return !seen;
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
    if (event.stream === "assistant" && markFirstToken(event.runId)) {
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
    firstTokenRuns.delete(event.runId);
  } else if (phase === "error") {
    traceRunStep(event.runId, "failed", { agent: event.agentId, code: event.data.code });
    firstTokenRuns.delete(event.runId);
  }
}

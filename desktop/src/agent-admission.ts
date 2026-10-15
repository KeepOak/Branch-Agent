// Private #951 part 2: an update is promoted only once the new engine actually admits its agents, not when its
// listener binds. /readyz answers 200 while agents still wait for their database inspection (it lists every refused
// agent in agentDatabases), and /startupz stays "starting" until that inspection ends. Together they say whether every
// agent is admitted. An update whose agents are still refused after the probation is rolled back automatically.

/** How long a swapped-in engine may keep refusing agents before the update is rolled back (tests: environment). */
export const ADMISSION_ROLLBACK_AFTER_MS = 10 * 60_000;
/** How often the new engine's admission is read during the probation. */
export const ADMISSION_POLL_MS = 5_000;

/** What the engine says about its agents. `refused`: every agent it refuses now, pending inspection or failed. */
export type AgentAdmission = { admitted: boolean; refused: string[]; startup: "started" | "inspecting" | "starting" };

type ProbedChild = { exitCode: number | null; signalCode: NodeJS.Signals | string | null };

async function probeJson(port: number, path: string, timeoutMs: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.json().catch(() => ({})) as unknown;
  return { status: res.status, body: body && typeof body === "object" ? body as Record<string, unknown> : {} };
}

/**
 * Reads the engine's agent admission on `port` (a local probe, so the engine includes its details). Undefined when
 * it does not answer. Agents in `knownRefused` (already refused by the engine before the update) never count.
 */
export async function readAgentAdmission(port: number, knownRefused: ReadonlySet<string> = new Set(), timeoutMs = 2_000): Promise<AgentAdmission | undefined> {
  try {
    const startupz = await probeJson(port, "/startupz", timeoutMs);
    const readyz = await probeJson(port, "/readyz", timeoutMs);
    const listed = Array.isArray(readyz.body.agentDatabases) ? readyz.body.agentDatabases as unknown[] : [];
    const refused = [...new Set(listed.map(entry => (entry as { agentId?: unknown } | null)?.agentId)
      .filter((id): id is string => typeof id === "string" && !knownRefused.has(id)))].sort();
    const startup = startupz.status === 200 ? "started"
      : startupz.body.pendingReason === "agent-database-inspection" ? "inspecting" : "starting";
    // Still inspecting is fine only when every agent it inspects was already refused before the update.
    return { admitted: refused.length === 0 && startup !== "starting", refused, startup };
  } catch {
    return undefined;
  }
}

export type AdmissionOutcome = {
  /** "refused": some agent was still refused when the budget ran out; the caller rolls the update back. */
  outcome: "admitted" | "refused" | "exited" | "stopped";
  refused: string[];
  waitedMs: number;
};

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); }
  signal?.addEventListener("abort", done, { once: true });
});

/**
 * Polls the new engine until every agent is admitted, the engine exits, `signal` aborts, or `rollbackAfterMs`
 * runs out with agents still refused (or the engine never answering).
 */
export async function waitForAgentAdmission(params: {
  port: () => number;
  child: ProbedChild;
  rollbackAfterMs: number;
  knownRefused?: ReadonlySet<string>;
  pollMs?: number;
  signal?: AbortSignal;
}): Promise<AdmissionOutcome> {
  const started = Date.now();
  const pollMs = params.pollMs ?? ADMISSION_POLL_MS;
  let refused: string[] = [];
  for (;;) {
    if (params.signal?.aborted) return { outcome: "stopped", refused, waitedMs: Date.now() - started };
    if (params.child.exitCode !== null || params.child.signalCode !== null) return { outcome: "exited", refused, waitedMs: Date.now() - started };
    const admission = await readAgentAdmission(params.port(), params.knownRefused, Math.max(1, Math.min(2_000, pollMs)));
    if (params.signal?.aborted) return { outcome: "stopped", refused, waitedMs: Date.now() - started };
    if (admission?.admitted) return { outcome: "admitted", refused: [], waitedMs: Date.now() - started };
    refused = admission ? admission.refused : ["(engine not answering)"];
    if (admission?.startup === "starting" && refused.length === 0) refused = ["(engine still starting)"];
    const waitedMs = Date.now() - started;
    if (waitedMs >= params.rollbackAfterMs) return { outcome: "refused", refused, waitedMs };
    await sleep(Math.max(0, Math.min(pollMs, params.rollbackAfterMs - waitedMs)), params.signal);
  }
}

/**
 * The probation after an update swapped engines: promote the update once every agent is admitted, or roll it back
 * automatically (the Undo path) when any agent is still refused at the deadline. An engine that exits is left to the
 * crash supervisor, and a stopped probation (quit, another update) does neither.
 */
export async function superviseUpdateAdmission(params: {
  label: string;
  wait: () => Promise<AdmissionOutcome>;
  promote: (outcome: AdmissionOutcome) => Promise<void> | void;
  rollback: (outcome: AdmissionOutcome) => Promise<void>;
  log: (line: string) => void;
}): Promise<AdmissionOutcome> {
  const result = await params.wait();
  const seconds = Math.round(result.waitedMs / 1000);
  if (result.outcome === "admitted") {
    params.log(`update ${params.label}: every agent admitted after ${seconds} s; promoting the new engine`);
    await params.promote(result);
  } else if (result.outcome === "refused") {
    params.log(`update ${params.label}: agents still refused ${seconds} s after the swap (${result.refused.join(", ")}); rolling back to the previous build`);
    try { await params.rollback(result); }
    catch (error) { params.log(`update ${params.label}: automatic rollback failed: ${String(error)}`); }
  } else {
    params.log(`update ${params.label}: admission watch ended (${result.outcome}) after ${seconds} s`);
  }
  return result;
}

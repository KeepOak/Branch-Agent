// Gateway requests that write a session outside its command lane wait here while a previous engine still holds
// that session's handoff lease (process/session-handoff-lease-gate.ts). That covers the session RPCs (patch, reset,
// delete, rewind, move, files, goals, ...), chat.send's user-turn transcript write before it queues the run, and
// in-process dispatch such as a subagent announcing into its parent. Work that runs in the lane (turns,
// compaction, cron and heartbeat runs) is gated by the lane itself.
//
// A remote client gives up after 30 s, so its request waits at most SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS and is
// then refused as retryable: a write the caller was told failed never runs later. The wait happens before the
// request is authorized, so nothing it decides is based on facts from before the previous engine finished.
import { ErrorCodes, errorShape } from "../../packages/gateway-protocol/src/index.js";
import { resolveSessionLane } from "../agents/embedded-agent-runner/lanes.js";
import {
  listLeasedSessionLanes,
  SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS,
  SessionHandoffLeaseTimeoutError,
  waitForSessionHandoffLease,
} from "../process/session-handoff-lease-gate.js";
import { DEFAULT_AGENT_ID } from "../routing/session-key.js";
import { sessionMutationTargetFields } from "./session-method-policy.js";
import { resolveDirectSessionTargets } from "./session-sharing-target-input.js";
import { canonicalizeSessionKeyForAgent } from "./session-store-key.js";

type ErrorShape = ReturnType<typeof errorShape>;

export type SessionHandoffLeaseRequestWait =
  | { kind: "run" }
  /** The caller went away while waiting: there is nobody to answer. */
  | { kind: "aborted" }
  | { kind: "refused"; error: ErrorShape };

/** How long a refused caller should wait before it tries again. */
export const SESSION_HANDOFF_LEASE_RETRY_AFTER_MS = 5_000;

/** Methods that name a session in their target fields but only read it. */
const SESSION_TARGET_READS = new Set(["sessions.messages.subscribe", "progressCard.get"]);

/** Methods that may write the sessions they name (the shared session method policy, minus reads). */
export function isSessionHandoffGatedMethod(method: string): boolean {
  if (SESSION_TARGET_READS.has(method)) return false;
  return method === "sessions.patchMany" || sessionMutationTargetFields(method).length > 0;
}

function laneCandidates(key: string, agentId: string | undefined): string[] {
  const lanes = [resolveSessionLane(key)];
  try {
    lanes.push(
      resolveSessionLane(canonicalizeSessionKeyForAgent(agentId ?? DEFAULT_AGENT_ID, key)),
    );
  } catch {
    // An unparseable key still matches by its raw lane and alias below.
  }
  return lanes;
}

/**
 * The leased lanes a request for `method` with `params` would write. Matching is generous: a request names a
 * session by its stored key, an alias ("main") or its id, while runs use the stored key's lane, and an extra wait
 * costs little where a missed match would let two engines write one session.
 */
export function findSessionHandoffLeasedLanes(
  method: string,
  params: unknown,
  leasedLanes: readonly string[],
): string[] {
  if (leasedLanes.length === 0 || !isSessionHandoffGatedMethod(method)) return [];
  const exact = new Set<string>();
  const aliasSuffixes: string[] = [];
  for (const { sessionKey, agentId } of resolveDirectSessionTargets(method, params)) {
    const key = sessionKey.trim();
    if (!key) continue;
    for (const lane of laneCandidates(key, agentId)) exact.add(lane);
    // An unscoped alias may belong to any agent: match every lane that ends in it.
    if (!key.toLowerCase().startsWith("agent:")) aliasSuffixes.push(`:${key.toLowerCase()}`);
  }
  const sessionId = (params as { sessionId?: unknown } | null | undefined)?.sessionId;
  if (typeof sessionId === "string" && sessionId.trim()) exact.add(resolveSessionLane(sessionId));
  return leasedLanes.filter(
    (lane) =>
      exact.has(lane) || aliasSuffixes.some((suffix) => lane.toLowerCase().endsWith(suffix)),
  );
}

function leaseRefusal(method: string, lane: string): SessionHandoffLeaseRequestWait {
  return {
    kind: "refused",
    error: errorShape(
      ErrorCodes.UNAVAILABLE,
      "This conversation is still finishing on the previous engine; try again in a few seconds.",
      {
        retryable: true,
        retryAfterMs: SESSION_HANDOFF_LEASE_RETRY_AFTER_MS,
        details: { reason: "session-handoff-lease", method, lane },
      },
    ),
  };
}

async function waitForLeasedLanes(
  method: string,
  lanes: readonly string[],
  opts: { signal?: AbortSignal; shutdownSignal?: AbortSignal; maxWaitMs?: number },
): Promise<SessionHandoffLeaseRequestWait> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(),
    Math.max(1, opts.maxWaitMs ?? SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS),
  );
  timer.unref?.();
  const signals = [timeout.signal, opts.signal, opts.shutdownSignal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const stop = AbortSignal.any(signals);
  let waitingOn = lanes[0] ?? "";
  try {
    for (const lane of lanes) {
      waitingOn = lane;
      if (stop.aborted) throw stop.reason;
      await waitForSessionHandoffLease(lane, stop);
    }
    return { kind: "run" };
  } catch (error) {
    if (opts.signal?.aborted) return { kind: "aborted" };
    if (opts.shutdownSignal?.aborted) {
      return {
        kind: "refused",
        error: errorShape(ErrorCodes.UNAVAILABLE, `${method} unavailable during gateway shutdown`, {
          retryable: true,
        }),
      };
    }
    // Our own bound, or the gate's (SessionHandoffLeaseTimeoutError): either way the session is still held.
    if (timeout.signal.aborted || error instanceof SessionHandoffLeaseTimeoutError) {
      return leaseRefusal(method, waitingOn);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Undefined when the request may run now: it writes no session, or no previous engine holds the sessions it names.
 * Otherwise resolves once every such session was released (`run`), or when the wait is cut short: `aborted` when
 * the caller's `signal` fired, `refused` (retryable UNAVAILABLE) on shutdown or after `maxWaitMs`
 * (default SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS).
 */
export function waitForSessionHandoffLeasesBeforeRequest(opts: {
  method: string;
  params: unknown;
  signal?: AbortSignal;
  shutdownSignal?: AbortSignal;
  maxWaitMs?: number;
}): Promise<SessionHandoffLeaseRequestWait> | undefined {
  if (!isSessionHandoffGatedMethod(opts.method)) return undefined;
  const lanes = findSessionHandoffLeasedLanes(opts.method, opts.params, listLeasedSessionLanes());
  if (lanes.length === 0) return undefined;
  return waitForLeasedLanes(opts.method, lanes, opts);
}

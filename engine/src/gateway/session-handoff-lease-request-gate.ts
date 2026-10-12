// Gateway requests that write a session outside its command lane wait here while a previous engine still holds
// that session's handoff lease (process/session-handoff-lease-gate.ts). That covers the session RPCs (patch, reset,
// delete, rewind, move, files, goals, ...), chat.send's user-turn transcript write before it queues the run, and
// in-process dispatch such as a subagent announcing into its parent. Work that runs in the lane (turns,
// compaction, cron and heartbeat runs) is gated by the lane itself.
//
// A remote client gives up after 30 s, so its request waits at most SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS and is
// then refused as retryable: a write the caller was told failed never runs later. A client that gives up sooner
// (callGateway's 10 s default) or reloads closes its socket, and that ends the wait without running the write. The wait happens before the
// request is authorized, so nothing it decides is based on facts from before the previous engine finished.
import { ErrorCodes, errorShape } from "../../packages/gateway-protocol/src/index.js";
import { resolveSessionLane } from "../agents/embedded-agent-runner/lanes.js";
import {
  listLeasedSessionLanes,
  SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS,
  SessionHandoffLeaseTimeoutError,
  waitForSessionHandoffLease,
} from "../process/session-handoff-lease-gate.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";
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

/**
 * Methods that name a session in their target fields but never write it: reads, and Stop. A run the previous
 * engine still finishes is not this engine's to stop, so Stop answers at once instead of waiting to fail.
 */
const UNGATED_SESSION_TARGET_METHODS = new Set([
  "sessions.messages.subscribe",
  "progressCard.get",
  "chat.abort",
  "sessions.abort",
  "sessions.processes.stop",
]);

/**
 * Session writes the shared method policy does not list: reactions (the session's reaction store and a session
 * event), an in-place transcript rewrite (#404), and group rename and delete (they rewrite every member session's
 * entry). Reactions and context name their session by `sessionKey`; group members are any session.
 */
const EXTRA_GATED_SESSION_WRITES = new Set([
  "sessions.patchMany",
  "session.reactions.set",
  "session.context.set",
  "sessions.groups.rename",
  "sessions.groups.delete",
]);

/** Methods that may write the sessions they name (the shared session method policy, minus reads and Stop). */
export function isSessionHandoffGatedMethod(method: string): boolean {
  if (UNGATED_SESSION_TARGET_METHODS.has(method)) return false;
  return EXTRA_GATED_SESSION_WRITES.has(method) || sessionMutationTargetFields(method).length > 0;
}

type RequestRecord = {
  key?: unknown;
  parentSessionKey?: unknown;
  agentId?: unknown;
  sessionId?: unknown;
  to?: unknown;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The sessions a request names. Creating a session writes its parent, and an existing session it adopts. */
function requestSessionTargets(
  method: string,
  params: unknown,
): Array<{ sessionKey: string; agentId?: string }> {
  if (method !== "sessions.create") return resolveDirectSessionTargets(method, params);
  const record = (params ?? {}) as RequestRecord;
  const agentId = readString(record.agentId);
  return [readString(record.parentSessionKey), readString(record.key)].flatMap((sessionKey) =>
    sessionKey ? [{ sessionKey, ...(agentId ? { agentId } : {}) }] : [],
  );
}

/**
 * Where a write that names no session lands, by method (traced in each handler): nowhere held (a new session, or no
 * session write), the agent's main session, or a session derived from something else (a delivery target, a group's
 * members), which may be any session.
 */
function sessionlessTarget(method: string, record: RequestRecord): "none" | "main" | "any" {
  switch (method) {
    case "agent":
      // No key: a fresh session, unless an owner (its main session) or a recipient (its route) is named.
      if (readString(record.to)) return "any";
      return readString(record.agentId) ? "main" : "none";
    case "sessions.create":
    case "plugins.sessionAction":
    case "talk.voice.set":
      return "none";
    case "wake":
    case "tools.invoke":
    case "talk.client.create":
    case "talk.session.create":
    case "talk.session.steer":
      return "main";
    default:
      return "any";
  }
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

/** The leased lanes of a main session: the named agent's, or any agent's, and the global session. */
function mainSessionLanes(
  leasedLanes: readonly string[],
  agentId: string | undefined,
  mainKey: string | undefined,
): string[] {
  const key = (mainKey?.trim() || "main").toLowerCase();
  const exact = agentId ? `session:agent:${normalizeAgentId(agentId)}:${key}` : undefined;
  return leasedLanes.filter((lane) => {
    const lowered = lane.toLowerCase();
    if (lowered === "session:global") return true;
    return exact
      ? lowered === exact
      : lowered.startsWith("session:agent:") && lowered.endsWith(`:${key}`);
  });
}

export type SessionHandoffLeaseMatchOptions = {
  /** The configured main session key (`session.mainKey`, default "main"). */
  mainKey?: string;
  /** The stored key of the session a request names only by `sessionId`, when it could be found. */
  sessionIdKey?: string;
};

/**
 * The leased lanes a request for `method` with `params` would write. Matching is generous: a request names a
 * session by its stored key, an alias ("main") or its id, while runs use the stored key's lane, and an extra wait
 * costs little where a missed match would let two engines write one session.
 */
export function findSessionHandoffLeasedLanes(
  method: string,
  params: unknown,
  leasedLanes: readonly string[],
  options: SessionHandoffLeaseMatchOptions = {},
): string[] {
  if (leasedLanes.length === 0 || !isSessionHandoffGatedMethod(method)) return [];
  const record = (params ?? {}) as RequestRecord;
  const targets = requestSessionTargets(method, params);
  const sessionId = readString(record.sessionId);
  if (options.sessionIdKey) targets.push({ sessionKey: options.sessionIdKey });
  if (targets.length === 0 && !sessionId) {
    const target = sessionlessTarget(method, record);
    if (target === "none") return [];
    if (target === "main") {
      return mainSessionLanes(leasedLanes, readString(record.agentId), options.mainKey);
    }
    return [...leasedLanes];
  }
  const exact = new Set<string>();
  const aliasSuffixes: string[] = [];
  for (const { sessionKey, agentId } of targets) {
    const key = sessionKey.trim();
    if (!key) continue;
    for (const lane of laneCandidates(key, agentId)) exact.add(lane);
    // An unscoped alias may belong to any agent: match every lane that ends in it.
    if (!key.toLowerCase().startsWith("agent:")) aliasSuffixes.push(`:${key.toLowerCase()}`);
  }
  // A run on a session with no key runs in its id's lane.
  if (sessionId) exact.add(resolveSessionLane(sessionId));
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
  opts: {
    signal?: AbortSignal;
    connectionSignal?: AbortSignal;
    shutdownSignal?: AbortSignal;
    maxWaitMs?: number;
  },
): Promise<SessionHandoffLeaseRequestWait> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(),
    Math.max(1, opts.maxWaitMs ?? SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS),
  );
  timer.unref?.();
  const signals = [timeout.signal, opts.signal, opts.connectionSignal, opts.shutdownSignal].filter(
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
    // The caller went away (cancelled, or its socket closed after a client-side timeout or a reload): it has
    // recorded a failure, so the write must never run now.
    if (opts.signal?.aborted || opts.connectionSignal?.aborted) return { kind: "aborted" };
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
 * the caller's `signal` fired or its connection closed (`connectionSignal`), `refused` (retryable UNAVAILABLE) on
 * shutdown or after `maxWaitMs` (default SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS). An in-process caller's own
 * deadline is not cancelling: its `maxWaitMs` is what is left of that deadline as the wait starts.
 */
export function waitForSessionHandoffLeasesBeforeRequest(opts: {
  method: string;
  params: unknown;
  signal?: AbortSignal;
  connectionSignal?: AbortSignal;
  shutdownSignal?: AbortSignal;
  maxWaitMs?: number;
  /** The configured main session key, for writes that land in the main session. */
  mainKey?: () => string | undefined;
  /** Finds the stored key of a session named only by its id (leases are taken on key lanes). */
  resolveSessionIdKey?: (sessionId: string, agentId?: string) => Promise<string | undefined>;
}): Promise<SessionHandoffLeaseRequestWait> | undefined {
  if (!isSessionHandoffGatedMethod(opts.method)) return undefined;
  const leased = listLeasedSessionLanes();
  if (leased.length === 0) return undefined;
  const record = (opts.params ?? {}) as RequestRecord;
  const sessionId = readString(record.sessionId);
  const namesKey = requestSessionTargets(opts.method, opts.params).length > 0;
  const match = (sessionIdKey?: string) =>
    findSessionHandoffLeasedLanes(opts.method, opts.params, leased, {
      mainKey: opts.mainKey?.(),
      ...(sessionIdKey ? { sessionIdKey } : {}),
    });
  if (sessionId && !namesKey && opts.resolveSessionIdKey) {
    const resolve = opts.resolveSessionIdKey;
    return (async () => {
      const key = await resolve(sessionId, readString(record.agentId)).catch(() => undefined);
      const lanes = match(key);
      return lanes.length > 0
        ? await waitForLeasedLanes(opts.method, lanes, opts)
        : { kind: "run" };
    })();
  }
  const lanes = match();
  if (lanes.length === 0) return undefined;
  return waitForLeasedLanes(opts.method, lanes, opts);
}

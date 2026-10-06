// Combine active-run views without making either lifecycle owner depend on its consumers.
import {
  getActiveReplyRunCount,
  listActiveReplyRunSessionKeys,
  listActiveReplyRunSessionIds,
  resolveActiveReplyRunSessionId,
} from "../../auto-reply/reply/reply-run-registry.registry.js";
import {
  ACTIVE_EMBEDDED_RUNS,
  ACTIVE_EMBEDDED_RUNS_BY_RUN_ID,
  ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY,
  ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_FILE,
} from "./run-state.js";

/** Counts active embedded runs while including auto-reply registry runs for shared sessions. */
export function getActiveEmbeddedRunCount(): number {
  let activeCount = ACTIVE_EMBEDDED_RUNS.size;
  for (const sessionId of listActiveReplyRunSessionIds()) {
    if (!ACTIVE_EMBEDDED_RUNS.has(sessionId)) {
      activeCount += 1;
    }
  }
  return Math.max(activeCount, getActiveReplyRunCount());
}

/** An accepted Stop can retain its handle for terminal cleanup without remaining user work. */
export function isEmbeddedRunStopped(runId: string): boolean {
  const handle = ACTIVE_EMBEDDED_RUNS_BY_RUN_ID.get(runId);
  return handle?.isAborted?.() === true || handle?.isStopped?.() === true;
}

export function listActiveEmbeddedUserRuns(): Array<{ runId: string; sessionKey: string }> {
  const runs: Array<{ runId: string; sessionKey: string }> = [];
  for (const [sessionKey, sessionId] of ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY) {
    const handle = ACTIVE_EMBEDDED_RUNS.get(sessionId);
    if (handle?.runId && !handle.isAborted?.() && !handle.isStopped?.()) {
      runs.push({ runId: handle.runId, sessionKey });
    }
  }
  return runs;
}

/** Lists active embedded-run session keys from both embedded and auto-reply registries. */
export function listActiveEmbeddedRunSessionKeys(): string[] {
  return [
    ...new Set([
      ...ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.keys(),
      ...listActiveReplyRunSessionKeys(),
    ]),
  ].toSorted((a, b) => a.localeCompare(b));
}

/** Lists active embedded-run session ids from all embedded-run lookup maps. */
export function listActiveEmbeddedRunSessionIds(): string[] {
  return [
    ...new Set([
      ...ACTIVE_EMBEDDED_RUNS.keys(),
      ...ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.values(),
      ...ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_FILE.values(),
      ...listActiveReplyRunSessionIds(),
    ]),
  ].toSorted((a, b) => a.localeCompare(b));
}

/** Resolves the current session id for an active run after resets or compaction. */
export function resolveActiveEmbeddedRunSessionId(sessionKey: string): string | undefined {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) {
    return undefined;
  }
  return (
    resolveActiveReplyRunSessionId(normalizedSessionKey) ??
    ACTIVE_EMBEDDED_RUN_SESSION_IDS_BY_KEY.get(normalizedSessionKey)
  );
}

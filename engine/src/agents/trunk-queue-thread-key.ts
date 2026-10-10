// The thread a queued job runs in. Kept apart from trunk-queue.ts (which owns the state file) so run-end code can
// recognize a job thread without loading the queue store.

const QUEUE_THREAD_SEGMENT = /^queue-[0-9a-f-]{36}-[0-9a-f]{8}$/u;

/** The new thread one claim attempt sends its brief to: agent:<agentId>:queue-<jobId>-<claim prefix>. */
export function formatTrunkQueueThreadKey(agentId: string, jobId: string, claimId: string): string {
  return `agent:${agentId}:queue-${jobId}-${claimId.slice(0, 8)}`;
}

/**
 * True for the thread of a queued job, the way formatTrunkQueueThreadKey writes it. A job thread is a Trunk's own
 * top-level thread, not a subagent: nothing is nested under it.
 */
export function isTrunkQueueThreadKey(sessionKey: string | undefined): boolean {
  const segments = sessionKey?.trim().toLowerCase().split(":") ?? [];
  return (
    segments.length === 3 &&
    segments[0] === "agent" &&
    segments[1] !== "" &&
    QUEUE_THREAD_SEGMENT.test(segments[2] ?? "")
  );
}

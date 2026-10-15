import { readAgentDatabaseAdmissionRefusal } from "../../../state/agent-database-admission.js";
import { SUBAGENT_ENDED_REASON_COMPLETE } from "./subagent-lifecycle-events.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

export const shouldSuspendPendingFinalDelivery = (entry: SubagentRunRecord) =>
  entry.expectsCompletionMessage === true &&
  entry.endedReason === SUBAGENT_ENDED_REASON_COMPLETE &&
  entry.execution.outcome?.status === "ok";

type DeferredCleanupDecision =
  | {
      kind: "defer-descendants";
      delayMs: number;
    }
  | {
      kind: "give-up";
      reason: "expiry" | "permanent_failure";
      retryCount?: number;
    }
  | {
      kind: "retry";
      retryCount: number;
      resumeDelayMs?: number;
    };

/** Required-delivery retries renew their window; optional delivery expires from completion. */
export function resolveAnnounceDeliveryDeadline(
  entry: SubagentRunRecord,
  now: number,
  expiryMs: number,
): number {
  const delivery = entry.expectsCompletionMessage === true ? entry.delivery : undefined;
  return (
    delivery?.deadlineAt ?? (delivery?.windowStartedAt ?? entry.execution.endedAt ?? now) + expiryMs
  );
}

/**
 * #967: true while the requester's agent is still being admitted after a Gateway start. Its
 * session refuses work until then ("has not completed startup inspection"); on a slow disk that
 * can outlast the whole delivery window, so the window must not run out while it waits.
 */
export function isRequesterAwaitingAdmission(
  entry: Pick<SubagentRunRecord, "requesterAgentId">,
  options: { env?: NodeJS.ProcessEnv } = {},
): boolean {
  if (!entry.requesterAgentId) {
    return false;
  }
  try {
    return (
      readAgentDatabaseAdmissionRefusal(entry.requesterAgentId, options)?.code ===
      "agent-database-inspection-pending"
    );
  } catch {
    return false;
  }
}

/**
 * #967: while the requester waits for admission its pending result stays queued in the registry,
 * and its delivery window restarts from now, so the parent gets a full window once admitted.
 */
export function holdDeliveryWindowForAdmission(
  delivery: { deadlineAt?: number },
  now: number,
  windowMs: number,
): void {
  delivery.deadlineAt = Math.max(delivery.deadlineAt ?? 0, now + windowMs);
}

export function resolveDeferredCleanupDecision(params: {
  entry: SubagentRunRecord;
  now: number;
  /** The requester is still being admitted: its delivery waits instead of expiring (#967). */
  requesterAwaitingAdmission?: boolean;
  activeDescendantRuns: number;
  announceExpiryMs: number;
  announceCompletionHardExpiryMs: number;
  deferDescendantDelayMs: number;
  resolveAnnounceRetryDelayMs: (retryCount: number) => number;
}): DeferredCleanupDecision {
  const isCompletionMessageFlow = params.entry.expectsCompletionMessage === true;
  const expiryMs = isCompletionMessageFlow
    ? params.announceCompletionHardExpiryMs
    : params.announceExpiryMs;
  const expiryExceeded =
    params.requesterAwaitingAdmission !== true &&
    params.now >= resolveAnnounceDeliveryDeadline(params.entry, params.now, expiryMs);
  if (isCompletionMessageFlow && params.activeDescendantRuns > 0) {
    if (expiryExceeded) {
      return { kind: "give-up", reason: "expiry" };
    }
    return { kind: "defer-descendants", delayMs: params.deferDescendantDelayMs };
  }

  const retryCount = (params.entry.delivery?.attemptCount ?? 0) + 1;
  if (params.entry.delivery?.disposition === "permanent_failure" || expiryExceeded) {
    return {
      kind: "give-up",
      reason:
        params.entry.delivery?.disposition === "permanent_failure" ? "permanent_failure" : "expiry",
      retryCount,
    };
  }

  const persistedNextAttemptAt = params.entry.delivery?.nextAttemptAt;
  const nextAttemptAt =
    typeof persistedNextAttemptAt === "number" && persistedNextAttemptAt > params.now
      ? persistedNextAttemptAt
      : params.now + params.resolveAnnounceRetryDelayMs(retryCount);

  return {
    kind: "retry",
    retryCount,
    resumeDelayMs: nextAttemptAt - params.now,
  };
}

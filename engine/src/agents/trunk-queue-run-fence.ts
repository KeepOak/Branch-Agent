import { randomUUID } from "node:crypto";
import { errorText, isTrunkUnavailableError, rec } from "./trunk-queue-status.js";
import type { TrunkQueueGateway, TrunkQueueItem } from "./trunk-queue-store.js";

// Fences a claim by its run: the run's status, whether the gateway still has it, and the gateway epoch that made it.

/** Identifies this gateway process. A claim from another epoch was made by a process that has since exited. */
export const GATEWAY_EPOCH = randomUUID();

/**
 * The run a claim attempt starts. Its id is the chat idempotency key, so it is known from the claim alone and a
 * reaper can ask the gateway whether that exact run has ended.
 */
export function queueRunId(id: string, claimId: string): string {
  return `trunk-queue-${id}-${claimId}`;
}

const ENDED_RUN_STATUSES = new Set(["ok", "error", "aborted"]);

/** The gateway no longer has this run: it finished long ago, or its record was lost. */
function isRunNotFoundError(error: unknown): boolean {
  return /agent run was not found/.test(errorText(error));
}

/**
 * What the gateway says about the claim's run: its status, "gone" when the record is missing, or undefined when the
 * Trunk is not ready to answer.
 */
async function observeRun(
  gw: TrunkQueueGateway,
  row: TrunkQueueItem,
): Promise<{ status: string | undefined } | "gone" | undefined> {
  try {
    const result = rec(
      await gw.request("agent.wait", {
        runId: queueRunId(row.id, row.claim_id ?? ""),
        timeoutMs: 0,
      }),
    );
    return { status: typeof result.status === "string" ? result.status : undefined };
  } catch (error) {
    if (isRunNotFoundError(error)) {
      return "gone";
    }
    if (isTrunkUnavailableError(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Whether a reaper may free this claim. A claim from an earlier gateway epoch cannot still be running, so it is
 * freed whatever the answer. Within the current epoch it is freed only when its run has ended (a terminal status) or
 * the gateway no longer has the run. Pending, timed-out or unknown keeps it held.
 */
export async function claimMayRelease(
  gw: TrunkQueueGateway,
  row: TrunkQueueItem,
): Promise<boolean> {
  if (!row.claim_id) {
    return false;
  }
  if (row.gateway_epoch !== GATEWAY_EPOCH) {
    return true;
  }
  const observed = await observeRun(gw, row);
  if (observed === "gone") {
    return true;
  }
  return (
    observed !== undefined &&
    observed.status !== undefined &&
    ENDED_RUN_STATUSES.has(observed.status)
  );
}

/**
 * Stops a claim whose run has been silent past the hard cap. The abort is confirmed by the run's own status before the
 * claim is freed. Returns "stopped" when the run is confirmed ended or gone, otherwise "unconfirmed".
 */
export async function stopSilentClaim(
  gw: TrunkQueueGateway,
  row: TrunkQueueItem,
): Promise<"stopped" | "unconfirmed"> {
  if (!row.claim_id || !row.claimed_by) {
    return "unconfirmed";
  }
  try {
    await gw.request("sessions.abort", {
      key: row.thread_key,
      runId: queueRunId(row.id, row.claim_id),
      agentId: row.claimed_by,
    });
  } catch (error) {
    if (!isRunNotFoundError(error)) {
      return "unconfirmed";
    }
  }
  const observed = await observeRun(gw, row);
  if (observed === "gone") {
    return "stopped";
  }
  return observed !== undefined &&
    observed.status !== undefined &&
    ENDED_RUN_STATUSES.has(observed.status)
    ? "stopped"
    : "unconfirmed";
}

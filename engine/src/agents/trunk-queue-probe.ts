// Probes of a Trunk's live state through the gateway: whether it has a run going, and whether it is idle.
import { isTrunkUnavailableError, rec, type Rec } from "./trunk-queue-status.js";
import type { TrunkQueueGateway } from "./trunk-queue-store.js";

/** Live sessions requested per query. The query selects running sessions before the limit applies. */
const LIVE_SESSION_LIMIT = 500;
/** A session row counts as live when it reports a run in progress. */
function isLiveRow(row: Rec): boolean {
  return (
    row.hasActiveRun === true ||
    row.status === "running" ||
    (typeof row.activeWriterRunId === "string" && row.activeWriterRunId !== "")
  );
}

/**
 * Live sessions of one Trunk, selected before pagination so the limit cannot hide a running session. A page
 * that comes back full is treated as live, so an unseen run is never released by mistake.
 */
async function liveSessionRows(gw: TrunkQueueGateway, agentId: string): Promise<Rec[] | "full"> {
  const rows = rec(
    await gw.request("sessions.list", {
      agentId,
      activeOnly: true,
      limit: LIVE_SESSION_LIMIT,
    }),
  ).sessions;
  const list = Array.isArray(rows) ? rows.map(rec) : [];
  return list.length >= LIVE_SESSION_LIMIT ? "full" : list;
}

/** A Trunk is working while any of its threads has a run: the same test trunks_list uses. */
export async function isTrunkWorking(gw: TrunkQueueGateway, agentId: string): Promise<boolean> {
  const rows = await liveSessionRows(gw, agentId);
  return rows === "full" || rows.some(isLiveRow);
}

/** Whether the Trunk has a live run, or undefined when it is not ready to answer. Other errors still throw. */
export async function probeWorking(
  gw: TrunkQueueGateway,
  agentId: string,
): Promise<boolean | undefined> {
  try {
    return await isTrunkWorking(gw, agentId);
  } catch (error) {
    if (isTrunkUnavailableError(error)) {
      return undefined;
    }
    throw error;
  }
}

/** Whether one claim's own thread has a live run. Matched on the exact stored thread key. */
export async function isClaimThreadLive(
  gw: TrunkQueueGateway,
  agentId: string,
  threadKey: string,
): Promise<boolean> {
  const rows = await liveSessionRows(gw, agentId);
  return rows === "full" || rows.some((row) => row.key === threadKey && isLiveRow(row));
}

const IDLE_POLL_MS = 500;

/** True once the Trunk has no running thread, checking again every IDLE_POLL_MS for up to waitMs. */
export async function waitForTrunkIdle(
  gw: TrunkQueueGateway,
  agentId: string,
  waitMs: number,
): Promise<boolean> {
  for (let waited = 0; ; waited += IDLE_POLL_MS) {
    if (!(await isTrunkWorking(gw, agentId))) {
      return true;
    }
    if (waited + IDLE_POLL_MS > waitMs) {
      return false;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, IDLE_POLL_MS);
    });
  }
}

/**
 * Puts back claims that have had no run activity for STALE_CLAIM_MS. The recorded start/end time is only a
 * hint: a claim is released only when its Trunk also has no live run now, so a run lasting longer than
 * STALE_CLAIM_MS keeps its job. The gateway is called only when some claim is past that time.
 */

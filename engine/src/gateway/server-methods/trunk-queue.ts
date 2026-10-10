// Gateway side of the Trunk job queue (agents/trunk-queue.ts): the MCP queue_* tools call these methods, and the
// agent-event subscription calls onTrunkRunLifecycle so an idle Trunk picks up the next job when its run ends.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import { isQueueEligibleTrunk, isTrunkStartupPending } from "../../agents/trunk-queue-policy.js";
import {
  addQueueItem,
  closeQueueClaimForThread,
  listQueueItems,
  markQueueItemDone,
  pickUpQueuedWork,
  queueItemStatus,
  reconcileTrunkQueue,
  releaseQueueItem,
  releaseStaleQueueClaims,
  touchQueueClaim,
  wakeIdleTrunks,
  type TrunkQueueGateway,
} from "../../agents/trunk-queue.js";
import type { BranchConfig } from "../../config/types.branch.js";
import type { GatewayRequestHandlers } from "./types.js";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The gateway calling itself, as an outside agent's trunk_send does (contacts.ts uses the same client). */
const localGateway: TrunkQueueGateway = {
  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const { callGateway } = await import("../call.js");
    return await callGateway<T>({ method, params, timeoutMs: 30_000 });
  },
};

/** How long a run end waits for its own run to stop counting as active before pickup gives up. */
const RUN_END_IDLE_WAIT_MS = 30_000;

/**
 * Run start or end in a Trunk's thread: keep its claim fresh. A clean end completes the job and an error puts it
 * back; then an idle eligible Trunk takes the next job. A run in any other thread leaves the claim alone.
 */
export async function onTrunkRunLifecycle(params: {
  agentId: string;
  terminal: boolean;
  threadKey?: string;
  outcome?: "completed" | "failed";
  cfg?: BranchConfig;
  gateway?: TrunkQueueGateway;
}): Promise<void> {
  if (params.threadKey) {
    touchQueueClaim(params.threadKey);
  }
  if (params.terminal && params.threadKey && params.outcome) {
    closeQueueClaimForThread(params.threadKey, params.outcome);
  }
  if (params.terminal && isQueueEligibleTrunk(params.agentId, params.cfg)) {
    await pickUpQueuedWork({
      agentId: params.agentId,
      gateway: params.gateway ?? localGateway,
      idleWaitMs: RUN_END_IDLE_WAIT_MS,
    });
  }
}

/** Trunks eligible for queued work that are past startup: a Trunk still preparing cannot answer a session query. */
async function readyEligibleAgentIds(
  gateway: TrunkQueueGateway,
  cfg: BranchConfig | undefined,
): Promise<string[]> {
  const rows = rec(await gateway.request("agents.list", {})).agents;
  return (Array.isArray(rows) ? rows.map(rec) : [])
    .filter((row) => !isTrunkStartupPending(row))
    .map((row) => text(row.id))
    .filter((id) => id !== "" && isQueueEligibleTrunk(id, cfg));
}

/** Gives the top queued job to each idle eligible Trunk, after a card is added or put back. */
export function wakeEligibleTrunks(
  cfg: BranchConfig | undefined,
  log: (message: string) => void,
): void {
  void (async () => {
    const agentIds = await readyEligibleAgentIds(localGateway, cfg);
    await wakeIdleTrunks({ agentIds, gateway: localGateway });
  })().catch((error: unknown) => log(`trunk queue wake failed: ${String(error)}`));
}

/** How often the gateway reconciles the queue, so an idle Trunk takes a job without a run end or a nudge. */
export const TRUNK_QUEUE_SWEEP_MS = 15_000;

/** The one live sweep in this process, if any. A second start while it runs is a no-op. */
let activeSweep: { signal: AbortSignal; timer: ReturnType<typeof setInterval> } | undefined;

/**
 * Starts the periodic reconcile for this process. Idempotent: while a sweep is running, further starts do nothing,
 * so overlapping gateway starts never run two sweeps. The sweep stops on abort and a later start may begin again.
 * A pass that fails (a Trunk still starting, say) is logged, and the next pass retries. A pass never overlaps the
 * one before it. Returns whether this call started a sweep.
 */
export function startTrunkQueueSweep(params: {
  getConfig: () => BranchConfig | undefined;
  log: (message: string) => void;
  signal: AbortSignal;
  gateway?: TrunkQueueGateway;
  intervalMs?: number;
}): boolean {
  if (params.signal.aborted || (activeSweep && !activeSweep.signal.aborted)) {
    return false;
  }
  const gateway = params.gateway ?? localGateway;
  let passRunning = false;
  const timer = setInterval(() => {
    if (passRunning) {
      return;
    }
    passRunning = true;
    void reconcileTrunkQueue({
      gateway,
      agentIds: () => readyEligibleAgentIds(gateway, params.getConfig()),
    })
      .catch((error: unknown) => params.log(`trunk queue sweep failed: ${String(error)}`))
      .finally(() => {
        passRunning = false;
      });
  }, params.intervalMs ?? TRUNK_QUEUE_SWEEP_MS);
  timer.unref();
  const sweep = { signal: params.signal, timer };
  activeSweep = sweep;
  params.signal.addEventListener(
    "abort",
    () => {
      clearInterval(timer);
      if (activeSweep === sweep) {
        activeSweep = undefined;
      }
    },
    { once: true },
  );
  return true;
}

export const trunkQueueHandlers: GatewayRequestHandlers = {
  "trunks.queue.add": async ({ params, respond, context }) => {
    const p = rec(params);
    const title = text(p.title);
    const briefText = text(p.brief_text);
    const priority = p.priority === undefined ? 0 : p.priority;
    if (!title || !briefText || typeof priority !== "number" || !Number.isFinite(priority)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "A title, brief_text and numeric priority are required.",
        ),
      );
      return;
    }
    const item = addQueueItem({ title, brief_text: briefText, priority });
    respond(true, { item: { ...item, status: queueItemStatus(item) } });
    wakeEligibleTrunks(context.getRuntimeConfig(), (message) => context.logGateway.warn(message));
  },
  "trunks.queue.list": async ({ respond, context }) => {
    // A failed run-activity check releases nothing; the list still shows every job.
    await releaseStaleQueueClaims({ gateway: localGateway }).catch((error: unknown) =>
      context.logGateway.warn(`trunk queue stale-claim check failed: ${String(error)}`),
    );
    respond(true, { items: listQueueItems() });
  },
  "trunks.queue.done": async ({ params, respond, context }) => {
    const item = markQueueItemDone(text(rec(params).id));
    if (!item) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "No queued job has that id."),
      );
      return;
    }
    respond(true, { item: { ...item, status: queueItemStatus(item) } });
    // The Trunk that held this job is free now; if it is idle it takes the next one.
    const agentId = item.claimed_by;
    if (agentId && isQueueEligibleTrunk(agentId, context.getRuntimeConfig())) {
      void pickUpQueuedWork({ agentId, gateway: localGateway }).catch((error: unknown) =>
        context.logGateway.warn(`trunk queue pickup failed: ${String(error)}`),
      );
    }
  },
  "trunks.queue.release": async ({ params, respond, context }) => {
    const before = releaseQueueItem(text(rec(params).id));
    if (!before) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "No queued job has that id."),
      );
      return;
    }
    respond(true, {
      released: Boolean(before.claimed_by && !before.done_at),
      released_from: before.claimed_by ?? null,
    });
    // A released job is claimable again, so an idle eligible Trunk may take it now.
    wakeEligibleTrunks(context.getRuntimeConfig(), (message) => context.logGateway.warn(message));
  },
};

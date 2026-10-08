// Gateway side of the Trunk job queue (agents/trunk-queue.ts): the MCP queue_* tools call these methods, and the
// agent-event subscription calls onTrunkRunLifecycle so an idle Trunk picks up the next job when its run ends.
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  addQueueItem,
  listQueueItems,
  markQueueItemDone,
  pickUpQueuedWork,
  queueItemStatus,
  releaseQueueItem,
  touchQueueClaim,
  type TrunkQueueGateway,
} from "../../agents/trunk-queue.js";
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

/** Run start or end of a Trunk: keep its claim fresh, and on run end hand an idle Trunk the next job. */
export async function onTrunkRunLifecycle(params: {
  agentId: string;
  terminal: boolean;
  gateway?: TrunkQueueGateway;
}): Promise<void> {
  touchQueueClaim(params.agentId);
  if (params.terminal) {
    await pickUpQueuedWork({ agentId: params.agentId, gateway: params.gateway ?? localGateway });
  }
}

export const trunkQueueHandlers: GatewayRequestHandlers = {
  "trunks.queue.add": async ({ params, respond }) => {
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
  },
  "trunks.queue.list": async ({ respond }) => {
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
    if (agentId) {
      void pickUpQueuedWork({ agentId, gateway: localGateway }).catch((error: unknown) =>
        context.logGateway.warn(`trunk queue pickup failed: ${String(error)}`),
      );
    }
  },
  "trunks.queue.release": async ({ params, respond }) => {
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
  },
};

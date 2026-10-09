import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { readToolStringParam, ToolInputError } from "./common.js";
import {
  callAgentToolGatewayRequest,
  type AgentToolGatewayRequestCaller,
} from "./in-process-gateway.js";
import { resolveSessionToolContext } from "./sessions-helpers.js";
import { sendFailure } from "./sessions-send-helpers.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";
import type { SessionsSendToolOptions } from "./sessions-send-tool.types.js";

export type TrunkMessageToolOptions = SessionsSendToolOptions & {
  /** Test seam: builds the underlying sessions_send tool. */
  createSend?: (options: SessionsSendToolOptions) => AnyAgentTool;
  /** Test seam: the agent-to-agent denial for a sender and target, or undefined when allowed. */
  agentToAgentDenial?: (params: {
    senderAgentId: string;
    targetAgentId: string;
  }) => string | undefined;
};

type SendOutcome = { details?: { status?: unknown; error?: unknown } } | undefined;

type ActiveSessionRow = {
  key?: unknown;
  createdActor?: { type?: unknown };
  spawnedBy?: unknown;
  parentSessionKey?: unknown;
  subagentRole?: unknown;
};

const TrunkMessageSchema = Type.Object(
  {
    agentId: Type.String({ minLength: 1, maxLength: 64 }),
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const NO_STEERABLE_RUN = /no active run that accepts steering/i;

/** The mailbox thread one Trunk keeps for messages from another, so it never mixes with the owner's chat. */
export function trunkMailboxKey(targetAgentId: string, senderAgentId: string): string {
  return `agent:${targetAgentId}:trunk:${senderAgentId}`;
}

/**
 * Steerable means a Trunk-owned thread that this sender may write into: a Trunk task thread, or the sender's
 * own mailbox on the target. The owner's main chat, human-created rows and other senders' mailboxes never qualify.
 * Cron roots are excluded by the sessions.list filters; an agent-created row that is none of the above is
 * still not steerable unless it is a task thread (createdActor "agent").
 */
export function isTrunkOwnedThread(
  row: ActiveSessionRow,
  targetAgentId: string,
  senderAgentId: string,
): boolean {
  const key = typeof row.key === "string" ? row.key : "";
  if (!key || key === `agent:${targetAgentId}:main`) {
    return false;
  }
  if (
    row.spawnedBy !== undefined ||
    row.parentSessionKey !== undefined ||
    row.subagentRole !== undefined
  ) {
    return false;
  }
  if (key.startsWith(`agent:${targetAgentId}:trunk:`)) {
    // Another sender's mailbox on the same target is somebody else's conversation: never steer into it.
    return key === trunkMailboxKey(targetAgentId, senderAgentId);
  }
  return row.createdActor?.type === "agent";
}

function steerRefused(outcome: unknown): boolean {
  if (outcome instanceof Error) {
    return NO_STEERABLE_RUN.test(outcome.message);
  }
  const details = (outcome as SendOutcome)?.details;
  return (
    details?.status === "error" &&
    typeof details.error === "string" &&
    NO_STEERABLE_RUN.test(details.error)
  );
}

function defaultAgentToAgentDenial(
  options: TrunkMessageToolOptions,
  params: { senderAgentId: string; targetAgentId: string },
): string | undefined {
  const { a2aPolicy } = resolveSessionToolContext({
    agentId: params.senderAgentId,
    agentSessionKey: options.agentSessionKey,
    config: options.config,
  });
  if (!a2aPolicy.enabled) {
    return "Agent-to-agent messaging is disabled. Set tools.agentToAgent.enabled=true to allow cross-agent sends.";
  }
  if (!a2aPolicy.isAllowed(params.senderAgentId, params.targetAgentId)) {
    return "Agent-to-agent messaging denied by tools.agentToAgent.allow.";
  }
  return undefined;
}

/**
 * Message another Trunk without a second parallel run and without writing into the owner's live chat.
 * - An active Trunk-owned thread: steer that run.
 * - Target busy only in the owner's chat, or the steer was refused while it stayed busy: queue a
 *   system notice in the sender's mailbox. Nothing starts and nothing is injected into the chat.
 * - Target idle: start a followup turn in the sender's mailbox.
 * sessions_send does the delivery, provenance and custody; this only chooses the mode.
 */
export function createTrunkMessageTool(options: TrunkMessageToolOptions = {}): AnyAgentTool {
  const gatewayCall: AgentToolGatewayRequestCaller =
    options.callGateway ?? callAgentToolGatewayRequest;
  const createSend = options.createSend ?? createSessionsSendTool;
  const send = createSend(options);
  const denialFor =
    options.agentToAgentDenial ?? ((params) => defaultAgentToAgentDenial(options, params));

  const activeRows = async (agentId: string, signal?: AbortSignal) => {
    const result = await gatewayCall<{ sessions?: ActiveSessionRow[] }>({
      method: "sessions.list",
      params: {
        agentId,
        activeOnly: true,
        excludeSubagents: true,
        excludeCron: true,
        excludeSystem: true,
        limit: 20,
      },
      ...(signal ? { signal } : {}),
    });
    return result.sessions ?? [];
  };

  const trySteer = async (
    toolCallId: string,
    sessionKey: string,
    text: string,
    signal: AbortSignal | undefined,
  ) => {
    try {
      const outcome = await send.execute(
        toolCallId,
        { sessionKey, message: text, mode: "steer", timeoutSeconds: 0 },
        signal,
      );
      return steerRefused(outcome) ? undefined : outcome;
    } catch (error) {
      if (steerRefused(error)) {
        return undefined;
      }
      throw error;
    }
  };

  return {
    label: "Trunk Message",
    name: "trunk_message",
    displaySummary: "Message another Trunk: joins its active task, or is queued for its mailbox.",
    description:
      "Send a message to another Trunk. If it is working on a Trunk task, the message joins that run. If it is idle, the message starts a turn in its mailbox for you. If it is busy in its owner's chat, the message is queued for its mailbox and read on its next turn there. It never joins the owner's chat and never starts a second parallel run. Use this to ask for a reviewer or hand off work.",
    parameters: TrunkMessageSchema,
    execute: async (toolCallId, args, signal) => {
      const params = args as Record<string, unknown>;
      const targetAgentId = readToolStringParam(params, "agentId", { required: true });
      const text = readToolStringParam(params, "text", { required: true });
      const senderAgentId = options.agentId;
      if (!senderAgentId) {
        throw new ToolInputError("trunk_message needs a Trunk identity for the sender");
      }
      if (targetAgentId === senderAgentId) {
        throw new ToolInputError(
          "trunk_message goes to another Trunk; write in your own thread instead",
        );
      }
      const denial = denialFor({ senderAgentId, targetAgentId });
      if (denial) {
        return sendFailure("forbidden", denial);
      }

      const active = await activeRows(targetAgentId, signal);
      const steerable = active.find(
        (row) =>
          typeof row.key === "string" && isTrunkOwnedThread(row, targetAgentId, senderAgentId),
      );
      if (steerable && typeof steerable.key === "string") {
        const steered = await trySteer(toolCallId, steerable.key, text, signal);
        if (steered) {
          return steered;
        }
      }
      // Busy after a refusal or with only the owner's chat running: queue, never start a parallel run.
      const busy = steerable
        ? (await activeRows(targetAgentId, signal)).length > 0
        : active.length > 0;

      const mailbox = trunkMailboxKey(targetAgentId, senderAgentId);
      await gatewayCall({
        method: "sessions.create",
        params: { key: mailbox, agentId: targetAgentId },
        ...(signal ? { signal } : {}),
      }).catch(() => undefined); // Already exists after the first message; sessions_send reports any real miss.
      return await send.execute(
        toolCallId,
        {
          sessionKey: mailbox,
          message: text,
          mode: busy ? "notify" : "followup",
          timeoutSeconds: 0,
        },
        signal,
      );
    },
  };
}

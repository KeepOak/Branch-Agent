import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { readToolStringParam, ToolInputError } from "./common.js";
import {
  callAgentToolGatewayRequest,
  type AgentToolGatewayRequestCaller,
} from "./in-process-gateway.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";
import type { SessionsSendToolOptions } from "./sessions-send-tool.types.js";

export type TrunkMessageToolOptions = SessionsSendToolOptions & {
  /** Test seam: builds the underlying sessions_send tool. */
  createSend?: (options: SessionsSendToolOptions) => AnyAgentTool;
};

const TrunkMessageSchema = Type.Object(
  {
    agentId: Type.String({ minLength: 1, maxLength: 64 }),
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** The mailbox thread one Trunk keeps for messages from another, so it never mixes with the owner's chat. */
export function trunkMailboxKey(targetAgentId: string, senderAgentId: string): string {
  return `agent:${targetAgentId}:trunk:${senderAgentId}`;
}

type GatewaySessionRows = { sessions?: { key?: string }[] };

/**
 * Message another Trunk without ever starting a second run inside it.
 * - Target has an active run anywhere: steer that run (the message joins it, nothing new starts).
 * - Target is idle: deliver a followup into its mailbox thread for this sender.
 * sessions_send does the delivery, provenance and custody; this only chooses the mode.
 */
export function createTrunkMessageTool(options: TrunkMessageToolOptions = {}): AnyAgentTool {
  const gatewayCall: AgentToolGatewayRequestCaller =
    options.callGateway ?? callAgentToolGatewayRequest;
  const createSend = options.createSend ?? createSessionsSendTool;
  const send = createSend(options);
  return {
    label: "Trunk Message",
    name: "trunk_message",
    displaySummary: "Message another Trunk: queued into its active work, or a new turn if idle.",
    description:
      "Send a message to another Trunk. If it is working, the message joins its current run (never a second parallel run). If it is idle, it gets a new turn in its mailbox for you. Use this to ask for a reviewer or hand off work.",
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
      const active = await gatewayCall<GatewaySessionRows>({
        method: "sessions.list",
        params: { agentId: targetAgentId, activeOnly: true, limit: 5 },
        ...(signal ? { signal } : {}),
      });
      const activeKey = active.sessions?.find((row) => typeof row.key === "string")?.key;
      if (activeKey) {
        return await send.execute(
          toolCallId,
          { sessionKey: activeKey, message: text, mode: "steer", timeoutSeconds: 0 },
          signal,
        );
      }
      const mailbox = trunkMailboxKey(targetAgentId, senderAgentId);
      await gatewayCall({
        method: "sessions.create",
        params: { key: mailbox, agentId: targetAgentId },
        ...(signal ? { signal } : {}),
      }).catch(() => undefined); // Already exists after the first message; sessions_send reports any real miss.
      return await send.execute(
        toolCallId,
        { sessionKey: mailbox, message: text, mode: "followup", timeoutSeconds: 0 },
        signal,
      );
    },
  };
}

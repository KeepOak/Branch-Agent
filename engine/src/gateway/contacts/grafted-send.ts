import type { BranchConfig } from "../../config/types.branch.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { enqueueGraftWork } from "./graft-work.js";
import {
  listOutsideAgents,
  outsideAgentMayMessage,
  outsideAgentRefusal,
} from "./outside-agents.js";

/** A joined Branch's Trunk as a contact key, a2a:<branch>--<trunk>. Not a session on this gateway. */
const JOINED_TEAMMATE_KEY = /^a2a:branch-[a-z0-9-]+--[a-z0-9-]+$/;

export const NOT_LINKED_MESSAGE = "That teammate isn't linked anymore. Link the Branch again.";
export const DISCONNECTED_MESSAGE =
  "That teammate was disconnected on this Branch. Link the Branch again to bring it back.";

export function isJoinedTeammateKey(sessionKey: string): boolean {
  return JOINED_TEAMMATE_KEY.test(sessionKey);
}

export type GraftedSendResult =
  | { ok: true; id: string }
  | { ok: false; code: "INVALID_REQUEST" | "FORBIDDEN"; message: string };

/**
 * Queues a message for a joined Branch's Trunk. Each refusal names the check that failed, so a person
 * (and the agent that relays it) knows whether to link the Branch again or re-enable it.
 */
export function queueGraftedTeammateSend(input: {
  target: string;
  text: string;
  sourceSessionKey: string;
  idempotencyKey?: string;
  cfg: BranchConfig;
}): GraftedSendResult {
  const target = input.target.replace(/^a2a:/, "");
  const text = input.text.trim();
  const sourceAgentId = parseAgentSessionKey(input.sourceSessionKey)?.agentId;
  if (!target || !text || !sourceAgentId) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message: "A local Trunk, grafted target and message are required.",
    };
  }
  const records = listOutsideAgents();
  const trunk = records.find((row) => row.id === target && row.kind === "trunk");
  const branch = records.find((row) => row.id === trunk?.via && row.kind === "branch");
  if (!trunk?.trunkId || !trunk.deviceId || !branch || branch.deviceId !== trunk.deviceId) {
    return { ok: false, code: "INVALID_REQUEST", message: NOT_LINKED_MESSAGE };
  }
  if (outsideAgentRefusal(trunk) || outsideAgentRefusal(branch)) {
    return { ok: false, code: "INVALID_REQUEST", message: DISCONNECTED_MESSAGE };
  }
  if (!outsideAgentMayMessage(input.cfg, sourceAgentId, target)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Agent-to-agent messaging denied by agentToAgent policy.",
    };
  }
  const job = enqueueGraftWork({
    deviceId: trunk.deviceId,
    trunkId: trunk.trunkId,
    text,
    sourceSessionKey: input.sourceSessionKey,
    sourceAgentId,
    idempotencyKey: input.idempotencyKey,
  });
  return { ok: true, id: job.id };
}

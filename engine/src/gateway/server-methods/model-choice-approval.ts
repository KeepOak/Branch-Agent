// One approve card for a Trunk-made model change, on the Branch Agent change approval manager.
import { randomUUID } from "node:crypto";
import type { ModelChoiceDecision } from "../../agents/model-choice.js";
import { getGatewayToolCallerIdentity } from "../../agents/tools/gateway-caller-context.js";
import { sha256Hex } from "../../infra/crypto-digest.js";
import type { ExecApprovalDecision } from "../../infra/exec-approvals.js";
import {
  SYSTEM_AGENT_APPROVAL_DECISIONS,
  SYSTEM_AGENT_APPROVAL_TIMEOUT_MS,
  type SystemAgentApprovalRequestPayload,
} from "../../infra/system-agent-approvals.js";
import { buildRequestedApprovalEvent, handlePendingApprovalRequest } from "./approval-shared.js";
import type { GatewayRequestContext } from "./types.js";

export const MODEL_CHOICE_APPROVAL_TITLE = "Switch model";

/** Resolves after the person decides; anything but allow (deny, expiry, closure) is a deny. */
export async function requestModelChoiceApproval(params: {
  context: GatewayRequestContext;
  question: string;
}): Promise<ModelChoiceDecision | "unavailable"> {
  const manager = params.context.systemAgentApprovalManager;
  if (!manager) {
    return "unavailable";
  }
  const caller = getGatewayToolCallerIdentity();
  const id = randomUUID();
  const request: SystemAgentApprovalRequestPayload = {
    title: MODEL_CHOICE_APPROVAL_TITLE,
    description: params.question,
    command: params.question,
    proposalHash: sha256Hex(`model-choice\0${id}\0${params.question}`),
    allowedDecisions: SYSTEM_AGENT_APPROVAL_DECISIONS,
    agentId: caller?.agentId ?? null,
    sessionKey: caller?.sessionKey ?? null,
    sessionId: `model-choice-${id}`,
    turnSourceChannel: caller?.turnSourceChannel ?? null,
    turnSourceTo: caller?.turnSourceTo ?? null,
    turnSourceAccountId: caller?.turnSourceAccountId ?? null,
    turnSourceThreadId: caller?.turnSourceThreadId ?? null,
    runId: caller?.operationalRunInstance?.runId ?? null,
  };
  const record = manager.create(request, SYSTEM_AGENT_APPROVAL_TIMEOUT_MS, `model-choice:${id}`);
  if (caller?.approvalSignals?.length) {
    record.approvalSignals = caller.approvalSignals;
  }
  await manager.register(record, SYSTEM_AGENT_APPROVAL_TIMEOUT_MS);
  const requestEvent = buildRequestedApprovalEvent(record, "system-agent");
  let decided: ExecApprovalDecision | null = null;
  await handlePendingApprovalRequest({
    manager,
    record,
    respond: () => undefined,
    context: params.context,
    requestEventName: "branch.approval.requested",
    requestEvent,
    twoPhase: true,
    approvalKind: "system-agent",
    deliverRequest: async () => {
      try {
        return (await params.context.forwardSystemAgentApprovalRequest?.(requestEvent)) ?? false;
      } catch (error) {
        params.context.logGateway?.error?.(
          `Model change approval chat delivery failed: ${String(error)}`,
        );
        return false;
      }
    },
    keepPendingWithoutRoute: true,
    requireDeliveryRoute: false,
    afterDecision: (decision) => {
      decided = decision;
    },
    afterDecisionErrorLabel: "Model change approval failed",
  });
  return decided === "allow-once" ? "allow" : "deny";
}

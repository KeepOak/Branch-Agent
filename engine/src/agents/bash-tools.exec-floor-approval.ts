// Approval request for always-ask floor hits that do not pass through the gateway allowlist
// (atlas SAFETY-0020): input written into a running session, and sandbox runs that can reach
// host paths. Only an explicit allow-once lets the input or the command through; a deny, a
// timeout or an unreachable approval route refuses it.
import { randomUUID } from "node:crypto";
import {
  formatExecHardlineFloorWarning,
  type HardlineFinding,
} from "../infra/exec-hardline-floor.js";
import {
  registerExecApprovalRequestForHostOrThrow,
  resolveRegisteredExecApprovalDecision,
} from "./bash-tools.exec-approval-request.js";

export type ExecFloorApprovalParams = {
  command: string;
  finding: HardlineFinding;
  /** Where the command came from, shown to the approver. */
  source: string;
  workdir?: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  approvalReviewerDeviceIds?: string[];
};

export type ExecFloorApprovalOutcome = { approved: true } | { approved: false; reason: string };

/** Ask once for a sandbox floor hit (the sandbox has no approval path of its own); throws on deny. */
export async function assertExecFloorApproved(params: ExecFloorApprovalParams): Promise<void> {
  const outcome = await requestExecFloorApproval(params);
  if (!outcome.approved) {
    throw new Error(
      `exec denied: ${formatExecHardlineFloorWarning(params.finding)} Approval was not granted (${outcome.reason}).`,
    );
  }
}

/** Ask the owner once for a floor hit; allow-always is never offered. */
export async function requestExecFloorApproval(
  params: ExecFloorApprovalParams,
): Promise<ExecFloorApprovalOutcome> {
  try {
    const registration = await registerExecApprovalRequestForHostOrThrow({
      approvalId: randomUUID(),
      command: params.command,
      workdir: params.workdir,
      host: "gateway",
      security: "full",
      ask: "always",
      unavailableDecisions: ["allow-always"],
      warningText: `${formatExecHardlineFloorWarning(params.finding)} Source: ${params.source}.`,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      runId: params.runId,
      toolCallId: params.toolCallId,
      ...(params.approvalReviewerDeviceIds?.length
        ? { approvalReviewerDeviceIds: params.approvalReviewerDeviceIds }
        : {}),
    });
    const decision = await resolveRegisteredExecApprovalDecision({
      approvalId: registration.id,
      preResolvedDecision: registration.finalDecision,
    });
    return decision === "allow-once"
      ? { approved: true }
      : { approved: false, reason: decision ?? "no decision" };
  } catch (err) {
    return {
      approved: false,
      reason: `approval unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

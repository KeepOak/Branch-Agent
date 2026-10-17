// Full-access approval bypass for the exec tool, with the always-ask floor for catastrophic
// commands (atlas SAFETY-0020): a floor hit on a host run disables the bypass and forces ask=always.
// A sandbox run skips the floor only when the sandbox cannot write to host paths.
import type { ExecAsk, ExecSecurity } from "../infra/exec-approvals-core.js";
import {
  detectExecHardlineFloor,
  formatExecHardlineFloorWarning,
  type HardlineFinding,
} from "../infra/exec-hardline-floor.js";
import { assertExecFloorApproved } from "./bash-tools.exec-floor-approval.js";
import type { ExecToolDefaults } from "./bash-tools.exec-types.js";

export function resolveExecApprovalBypass(params: {
  command: string;
  host: string;
  ask: ExecAsk;
  warnings: string[];
  bypassHostApprovalFloors: boolean;
  elevatedMode: string;
  modePolicy: { security: ExecSecurity; ask: ExecAsk };
  approvalPolicy?: { security?: ExecSecurity; ask?: ExecAsk };
  /** The sandbox mounts host paths read-write, so a sandbox run can still damage the host. */
  sandboxHostWritable?: boolean;
}): { ask: ExecAsk; bypassApprovals: boolean; floor: HardlineFinding | null } {
  // A sandbox with no writable host mount cannot damage the host, like upstream containers.
  const skipFloor = params.host === "sandbox" && params.sandboxHostWritable !== true;
  const floor = skipFloor ? null : detectExecHardlineFloor(params.command);
  if (floor) {
    params.warnings.push(formatExecHardlineFloorWarning(floor));
    return { ask: "always", bypassApprovals: false, floor };
  }
  const { modePolicy, approvalPolicy } = params;
  const hostAllows =
    (approvalPolicy?.security ?? "full") === "full" && (approvalPolicy?.ask ?? "off") === "off";
  const modeAllows = modePolicy.security === "full" && modePolicy.ask === "off";
  // Explicit full-session authority is the sole exception to host approval floors.
  const bypassApprovals =
    (params.bypassHostApprovalFloors && modePolicy.ask === "off") ||
    (params.elevatedMode === "full" && modeAllows && hostAllows);
  return { ask: bypassApprovals ? "off" : params.ask, bypassApprovals, floor: null };
}

/**
 * resolveExecApprovalBypass plus the sandbox floor prompt. A sandbox run has no approval path of
 * its own, so when host paths are mounted read-write a floor hit asks through the gateway here and
 * throws unless the owner allows it once.
 */
export async function resolveExecApprovalBypassWithFloor(
  params: Omit<
    Parameters<typeof resolveExecApprovalBypass>[0],
    "sandboxHostWritable" | "bypassHostApprovalFloors"
  > & {
    floorContext: { defaults?: ExecToolDefaults; agentId?: string; toolCallId?: string };
  },
): Promise<{ ask: ExecAsk; bypassApprovals: boolean }> {
  const { floorContext, ...rest } = params;
  const { defaults } = floorContext;
  const resolved = resolveExecApprovalBypass({
    ...rest,
    bypassHostApprovalFloors: defaults?.bypassHostApprovalFloors === true,
    sandboxHostWritable: defaults?.sandbox?.hostPathsWritable === true,
  });
  if (params.host === "sandbox" && resolved.floor) {
    await assertExecFloorApproved({
      command: params.command,
      finding: resolved.floor,
      source: "sandbox run with host paths mounted read-write",
      agentId: floorContext.agentId,
      sessionKey: defaults?.sessionKey,
      sessionId: defaults?.sessionId,
      runId: defaults?.runId,
      toolCallId: floorContext.toolCallId,
      approvalReviewerDeviceIds: defaults?.approvalReviewerDeviceId
        ? [defaults.approvalReviewerDeviceId]
        : undefined,
    });
  }
  return { ask: resolved.ask, bypassApprovals: resolved.bypassApprovals };
}

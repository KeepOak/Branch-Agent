// Full-access approval bypass for the exec tool, with the always-ask floor for catastrophic
// commands (atlas SAFETY-0020): a floor hit on a host run disables the bypass and forces ask=always.
import type { ExecAsk, ExecSecurity } from "../infra/exec-approvals-core.js";
import {
  detectExecHardlineFloor,
  formatExecHardlineFloorWarning,
} from "../infra/exec-hardline-floor.js";

export function resolveExecApprovalBypass(params: {
  command: string;
  host: string;
  ask: ExecAsk;
  warnings: string[];
  bypassHostApprovalFloors: boolean;
  elevatedMode: string;
  modePolicy: { security: ExecSecurity; ask: ExecAsk };
  approvalPolicy?: { security?: ExecSecurity; ask?: ExecAsk };
}): { ask: ExecAsk; bypassApprovals: boolean } {
  // Sandboxed runs cannot damage the host, so they skip the floor like upstream containers.
  const floor = params.host === "sandbox" ? null : detectExecHardlineFloor(params.command);
  if (floor) {
    params.warnings.push(formatExecHardlineFloorWarning(floor));
    return { ask: "always", bypassApprovals: false };
  }
  const { modePolicy, approvalPolicy } = params;
  const hostAllows =
    (approvalPolicy?.security ?? "full") === "full" && (approvalPolicy?.ask ?? "off") === "off";
  const modeAllows = modePolicy.security === "full" && modePolicy.ask === "off";
  // Explicit full-session authority is the sole exception to host approval floors.
  const bypassApprovals =
    (params.bypassHostApprovalFloors && modePolicy.ask === "off") ||
    (params.elevatedMode === "full" && modeAllows && hostAllows);
  return { ask: bypassApprovals ? "off" : params.ask, bypassApprovals };
}

import type { BranchConfig } from "../config/types.branch.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { AcpRuntimeError } from "./runtime/errors.js";

const ACP_DISABLED_MESSAGE = "ACP is disabled by policy (`acp.enabled=false`).";
const ACP_DISPATCH_DISABLED_MESSAGE =
  "ACP dispatch is disabled by policy (`acp.dispatch.enabled=false`).";

export function isAcpEnabledByPolicy(cfg: BranchConfig): boolean {
  return cfg.acp?.enabled !== false;
}

export function resolveAcpDispatchPolicyMessage(cfg: BranchConfig): string | null {
  if (!isAcpEnabledByPolicy(cfg)) {
    return ACP_DISABLED_MESSAGE;
  }
  return cfg.acp?.dispatch?.enabled === false ? ACP_DISPATCH_DISABLED_MESSAGE : null;
}

export function resolveAcpDispatchPolicyError(cfg: BranchConfig): AcpRuntimeError | null {
  const message = resolveAcpDispatchPolicyMessage(cfg);
  if (!message) {
    return null;
  }
  return new AcpRuntimeError("ACP_DISPATCH_DISABLED", message);
}

/** Returns the runtime error for explicit ACP turns when ACP itself is disabled. */
export function resolveAcpExplicitTurnPolicyError(cfg: BranchConfig): AcpRuntimeError | null {
  if (isAcpEnabledByPolicy(cfg)) {
    return null;
  }
  return new AcpRuntimeError("ACP_DISPATCH_DISABLED", ACP_DISABLED_MESSAGE);
}

function isAcpAgentAllowedByPolicy(cfg: BranchConfig, agentId: string): boolean {
  const allowed = (cfg.acp?.allowedAgents ?? [])
    .map((entry) => normalizeAgentId(entry))
    .filter(Boolean);
  if (allowed.length === 0) {
    return true;
  }
  return allowed.includes(normalizeAgentId(agentId));
}

export function resolveAcpAgentPolicyError(
  cfg: BranchConfig,
  agentId: string,
): AcpRuntimeError | null {
  if (isAcpAgentAllowedByPolicy(cfg, agentId)) {
    return null;
  }
  return new AcpRuntimeError(
    "ACP_SESSION_INIT_FAILED",
    `ACP agent "${normalizeAgentId(agentId)}" is not allowed by policy.`,
  );
}

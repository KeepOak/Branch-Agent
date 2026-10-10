import type { BranchToolsOptions } from "../branch-tools.types.js";
import { resolveExecDefaults } from "../exec-defaults.js";

export type AgentFullAccessSource = Pick<
  BranchToolsOptions,
  "config" | "execSession" | "execOverrides" | "fsPolicy"
>;

/** Full access: host exec with security full, no approval asks, and no workspace-only file limit. */
export function resolveAgentFullAccess(
  params: AgentFullAccessSource & { agentId: string; sessionKey?: string },
): boolean {
  const execPolicy = resolveExecDefaults({
    cfg: params.config,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
    sessionEntry: params.execSession,
    execOverrides: params.execOverrides,
  });
  return (
    params.fsPolicy?.workspaceOnly !== true &&
    execPolicy.effectiveHost !== "sandbox" &&
    execPolicy.security === "full" &&
    execPolicy.ask === "off"
  );
}

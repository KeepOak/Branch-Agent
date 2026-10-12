import type { BranchStateDatabaseOptions } from "../state/branch-state-db-contract.js";
import { loadExecApprovalsReadOnlyAsync } from "./exec-approvals-store.js";
import type { McpToolGrant } from "./exec-approvals.types.js";

export type { McpToolGrant } from "./exec-approvals.types.js";

/** Snapshot exact-agent grants at thread/registration preparation, never on tool calls. */
export async function loadMcpToolGrants(
  agentId: string,
  options?: Pick<BranchStateDatabaseOptions, "path" | "env">,
): Promise<readonly McpToolGrant[]> {
  return agentId === "*"
    ? []
    : ((await loadExecApprovalsReadOnlyAsync(options)).agents?.[agentId]?.mcpTools ?? []);
}

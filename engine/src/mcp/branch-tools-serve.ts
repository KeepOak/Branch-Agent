/**
 * Standalone MCP server for selected built-in Branch Agent tools.
 *
 * Run via: node --import tsx src/mcp/branch-tools-serve.ts
 * Or: bun src/mcp/branch-tools-serve.ts
 */
import { pathToFileURL } from "node:url";
import { resolveRequesterToolPolicies } from "../agents/requester-tool-policy.js";
import { isToolAllowedByPolicies } from "../agents/tool-policy-match.js";
import { AUTOMATIONS_TOOL_NAME } from "../agents/tools/automations-tool-name.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { createCronTool } from "../agents/tools/cron-tool.js";
import { createSystemAgentTool } from "../agents/tools/system-agent-tool.js";
import type { SystemAgentToolOptions } from "../agents/tools/system-agent-tool.js";
import { getRuntimeConfig } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { formatErrorMessage } from "../infra/errors.js";
import {
  BRANCH_TOOLS_MCP_AGENT_SESSION_KEY_ENV,
  resolveToolsMcpAgentSessionKey as resolveBranchToolsMcpAgentSessionKey,
  resolveToolsMcpAgentId,
  resolveToolsMcpSessionContext,
} from "./agent-session-env.js";
import {
  resolveBranchToolsMcpSystemAgentApproval,
  resolveBranchToolsMcpSystemAgentSurface,
  resolveBranchToolsMcpToolSelection,
  type BranchToolsMcpToolId,
} from "./branch-tools-serve-config.js";
import { connectToolsMcpServerToStdio, createToolsMcpServer } from "./tools-stdio-server.js";

export {
  BRANCH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV,
  BRANCH_TOOLS_MCP_TOOLS_ENV,
} from "./branch-tools-serve-config.js";

export { BRANCH_TOOLS_MCP_AGENT_SESSION_KEY_ENV } from "./agent-session-env.js";

export { resolveBranchToolsMcpAgentSessionKey };

export function resolveBranchToolsForMcp(
  params: {
    agentSessionKey?: string;
    agentId?: string;
    tools?: BranchToolsMcpToolId[];
    systemAgentSurface?: SystemAgentToolOptions["surface"];
    config?: BranchConfig;
  } = {},
): AnyAgentTool[] {
  const selection = params.tools ?? resolveBranchToolsMcpToolSelection();
  const agentSessionKey = (
    params.agentSessionKey ?? resolveBranchToolsMcpAgentSessionKey()
  )?.trim();
  const tools = selection.map((tool) => {
    if (tool === "branch") {
      return createSystemAgentTool({
        agentId: params.agentId,
        surface: params.systemAgentSurface ?? resolveBranchToolsMcpSystemAgentSurface(),
        ...resolveBranchToolsMcpSystemAgentApproval(),
      });
    }
    if (!agentSessionKey) {
      throw new Error(`${BRANCH_TOOLS_MCP_AGENT_SESSION_KEY_ENV} is required`);
    }
    const context = resolveToolsMcpSessionContext({ agentSessionKey, agentId: params.agentId });
    return createCronTool({
      agentSessionKey,
      agentId: context.agentId,
      // Same host-config resolution as plugin-tools-serve: the advertised cron
      // surface must reflect this deployment's cron.triggers.enabled gate.
      config: params.config ?? getRuntimeConfig(),
      creatorToolAllowlist: [{ name: AUTOMATIONS_TOOL_NAME }],
    });
  });
  if (!agentSessionKey) {
    return tools;
  }
  const requesterPolicies = resolveRequesterToolPolicies({
    config: params.config ?? getRuntimeConfig(),
    agentId: params.agentId,
    sessionKey: agentSessionKey,
    senderPolicyMode: "never",
  });
  return tools.filter((tool) =>
    isToolAllowedByPolicies(tool.name, [
      requesterPolicies.groupPolicy,
      requesterPolicies.senderPolicy,
      requesterPolicies.subagentPolicy,
      requesterPolicies.inheritedToolPolicy,
    ]),
  );
}

async function serveBranchToolsMcp(): Promise<void> {
  const server = createToolsMcpServer({
    name: "branch-tools",
    tools: resolveBranchToolsForMcp({ agentId: resolveToolsMcpAgentId() }),
  });
  await connectToolsMcpServerToStdio(server);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  serveBranchToolsMcp().catch((err: unknown) => {
    process.stderr.write(`branch-tools-serve: ${formatErrorMessage(err)}\n`);
    process.exit(1);
  });
}

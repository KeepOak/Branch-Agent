import { normalizeToolPolicyName } from "../tool-policy.js";

/** Transport prefix CLI harnesses use for loopback Branch Agent MCP tool names. */
const BRANCH_MCP_TOOL_PREFIX = "mcp__branch__";
const GEMINI_BRANCH_MCP_TOOL_PREFIX = "mcp_branch_";

/** Strips the loopback MCP transport prefix so observers see gateway tool names. */
export function stripBranchMcpToolPrefix(toolName: string): string {
  return toolName.startsWith(BRANCH_MCP_TOOL_PREFIX)
    ? toolName.slice(BRANCH_MCP_TOOL_PREFIX.length)
    : toolName.startsWith(GEMINI_BRANCH_MCP_TOOL_PREFIX)
      ? toolName.slice(GEMINI_BRANCH_MCP_TOOL_PREFIX.length)
      : toolName;
}

/** Match provider-native names against the canonical tool hook and policy ids. */
export function normalizeCliToolName(toolName: string): string {
  return normalizeToolPolicyName(
    toolName.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2"),
  );
}

/** Keeps only explicit runtime caps for backend-owned exact translation. */
export function resolveCliRuntimeToolsAllow(
  toolsAllow?: string[],
  _toolsAllowIsDefault?: boolean,
): string[] | undefined {
  if (toolsAllow === undefined) {
    return undefined;
  }
  return toolsAllow.some((toolName) => normalizeToolPolicyName(toolName) === "*")
    ? undefined
    : toolsAllow;
}

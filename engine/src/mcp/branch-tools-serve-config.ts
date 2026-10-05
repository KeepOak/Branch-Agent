/**
 * Shared contract between the branch-tools MCP stdio entry and the callers
 * that inject it into CLI harness runs. Keep this module free of MCP SDK and
 * tool-runtime imports so CLI-runner prepare paths can build server configs
 * without loading the server.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { normalizeCsvOrLooseStringList } from "@branch/normalization-core/string-normalization";
import type { SystemAgentToolOptions } from "../agents/tools/system-agent-tool.js";
import { resolveBranchPackageRootSync } from "../infra/branch-root.js";
import type { BundleMcpConfig } from "../plugins/bundle-mcp.js";

export const BRANCH_TOOLS_MCP_TOOLS_ENV = "BRANCH_TOOLS_MCP_TOOLS";
export const BRANCH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV =
  "BRANCH_TOOLS_MCP_SYSTEM_AGENT_SURFACE";
export const BRANCH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV =
  "BRANCH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED";
export const BRANCH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV =
  "BRANCH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL";
// Delegation and chat consent are mutually exclusive. Keep both in the existing
// per-turn transport value so native transcript resume identity stays stable.
const APPROVAL_ARMED_OPERATOR_ONLY_VALUE = "operator-only";

const BRANCH_TOOLS_MCP_TOOL_IDS = ["cron", "branch"] as const;
export type BranchToolsMcpToolId = (typeof BRANCH_TOOLS_MCP_TOOL_IDS)[number];

function isBranchToolsMcpToolId(value: string): value is BranchToolsMcpToolId {
  return (BRANCH_TOOLS_MCP_TOOL_IDS as readonly string[]).includes(value);
}

/** Parse the served tool selection; the default stays cron for acpx bridges. */
export function resolveBranchToolsMcpToolSelection(
  env: NodeJS.ProcessEnv = process.env,
): BranchToolsMcpToolId[] {
  const raw = env[BRANCH_TOOLS_MCP_TOOLS_ENV]?.trim();
  if (!raw) {
    return ["cron"];
  }
  const entries = normalizeCsvOrLooseStringList(raw);
  const selection = entries.filter(isBranchToolsMcpToolId);
  if (selection.length === 0 || selection.length !== entries.length) {
    throw new Error(
      `${BRANCH_TOOLS_MCP_TOOLS_ENV} must be a comma list of: ${BRANCH_TOOLS_MCP_TOOL_IDS.join(", ")}`,
    );
  }
  return selection;
}

/** Parse the Branch Agent surface for served branch tools; defaults to cli. */
export function resolveBranchToolsMcpSystemAgentSurface(
  env: NodeJS.ProcessEnv = process.env,
): SystemAgentToolOptions["surface"] {
  const raw = env[BRANCH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]?.trim();
  if (!raw || raw === "cli") {
    return "cli";
  }
  if (raw === "gateway") {
    return "gateway";
  }
  throw new Error(`${BRANCH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV} must be "cli" or "gateway"`);
}

/**
 * Reconstruct per-turn approval state for the served branch tool. The
 * stdio server runs out of process, so the host passes the armed bit and the
 * pending proposal hash through env; the host mirrors transitions back from
 * tool events (see mirrorSystemAgentToolStateFromEvents in agent-turn.ts).
 */
export function resolveBranchToolsMcpSystemAgentApproval(env: NodeJS.ProcessEnv = process.env): {
  approvalArmed: boolean;
  proposalRef: { current?: string };
  operatorApprovalOnly?: boolean;
} {
  const pendingProposal = env[BRANCH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV]?.trim();
  const armedValue = env[BRANCH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]?.trim();
  return {
    approvalArmed: armedValue === "1",
    proposalRef: pendingProposal ? { current: pendingProposal } : {},
    ...(armedValue === APPROVAL_ARMED_OPERATOR_ONLY_VALUE ? { operatorApprovalOnly: true } : {}),
  };
}

function resolveTsxImportSpecifier(): string {
  try {
    return createRequire(import.meta.url).resolve("tsx");
  } catch {
    return "tsx";
  }
}

function resolveBranchToolsServeCommand(): { command: string; args: string[] } {
  const packageRoot = resolveBranchPackageRootSync({
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
  });
  if (!packageRoot) {
    throw new Error("branch-tools MCP: could not resolve the Branch Agent package root");
  }
  const distEntry = path.join(packageRoot, "dist", "mcp", "branch-tools-serve.js");
  if (fs.existsSync(distEntry)) {
    return { command: process.execPath, args: [distEntry] };
  }
  const sourceEntry = path.join(packageRoot, "src", "mcp", "branch-tools-serve.ts");
  if (!fs.existsSync(sourceEntry)) {
    throw new Error(`branch-tools MCP: no serve entry under ${packageRoot}`);
  }
  // Bun executes TypeScript entries directly; Node source checkouts need tsx.
  if (process.versions.bun) {
    return { command: process.execPath, args: [sourceEntry] };
  }
  return {
    command: process.execPath,
    args: ["--import", resolveTsxImportSpecifier(), sourceEntry],
  };
}

/**
 * Branch Agent CLI-harness runs get exactly one MCP server: this stdio entry
 * serving the ring-zero branch tool. The server keeps the "branch" name
 * so backend tool pre-approvals (e.g. Claude's --allowedTools mcp__branch__*)
 * apply without per-backend argument surgery.
 */
export function buildSystemAgentToolsMcpServerConfig(
  options: SystemAgentToolOptions,
): BundleMcpConfig {
  const entry = resolveBranchToolsServeCommand();
  const pendingProposal = options.proposalRef?.current;
  return {
    mcpServers: {
      branch: {
        command: entry.command,
        args: options.agentId
          ? [...entry.args, "--branch-agent-id", options.agentId]
          : entry.args,
        env: {
          [BRANCH_TOOLS_MCP_TOOLS_ENV]: "branch" satisfies BranchToolsMcpToolId,
          [BRANCH_TOOLS_MCP_SYSTEM_AGENT_SURFACE_ENV]: options.surface,
          // Per-turn approval state travels with the per-run MCP config; the
          // host mirrors proposal transitions back from tool events.
          ...(options.operatorApprovalOnly === true
            ? {
                [BRANCH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]:
                  APPROVAL_ARMED_OPERATOR_ONLY_VALUE,
              }
            : options.approvalArmed === true
              ? { [BRANCH_TOOLS_MCP_SYSTEM_AGENT_APPROVAL_ARMED_ENV]: "1" }
              : {}),
          ...(pendingProposal
            ? { [BRANCH_TOOLS_MCP_SYSTEM_AGENT_PROPOSAL_ENV]: pendingProposal }
            : {}),
        },
      },
    },
  };
}

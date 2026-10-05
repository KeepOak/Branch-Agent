import {
  pinExecToolTarget,
  type CodexScheduledToolProjectionFactory,
} from "branch/plugin-sdk/codex-mcp-projection";
import { loadNodeExecAvailability } from "branch/plugin-sdk/node-selection-runtime";
import type { CodexPluginConfig } from "./config.js";
import { normalizeCodexDynamicToolName } from "./dynamic-tool-profile.js";

type BranchCodingToolsFactory =
  (typeof import("branch/plugin-sdk/agent-harness"))["createBranchCodingTools"];
type BranchDynamicTool = ReturnType<BranchCodingToolsFactory>[number];

export const CODEX_NODE_EXEC_DYNAMIC_TOOL_NAME = "node_exec";
export const CODEX_GATEWAY_EXEC_DYNAMIC_TOOL_NAME = "gateway_exec";
export const CODEX_GATEWAY_PROCESS_DYNAMIC_TOOL_NAME = "gateway_process";
const CODEX_DISABLED_NATIVE_SHELL_DYNAMIC_TOOLS = new Set([
  "exec",
  "process",
  "sandbox_exec",
  "sandbox_process",
  CODEX_GATEWAY_EXEC_DYNAMIC_TOOL_NAME,
  CODEX_GATEWAY_PROCESS_DYNAMIC_TOOL_NAME,
  CODEX_NODE_EXEC_DYNAMIC_TOOL_NAME,
]);

const PROCESS_FOLLOWUP_TEXT =
  "Use process (list/poll/log/write/send-keys/submit/paste/kill/clear/remove) for follow-up.";

export function isCodexDynamicToolExcluded(
  config: Pick<CodexPluginConfig, "codexDynamicToolsExclude">,
  names: readonly string[],
): boolean {
  const normalizedNames = new Set(names.map((name) => normalizeCodexDynamicToolName(name)));
  return (config.codexDynamicToolsExclude ?? []).some((name) =>
    normalizedNames.has(normalizeCodexDynamicToolName(name)),
  );
}

/** Shared only by the runtime and registered catalogs of one attempt. */
export type NodeExecAvailabilityRef = { current?: ReturnType<typeof loadNodeExecAvailability> };

export async function createNodeExecAliasDynamicTool(
  execTool: BranchDynamicTool,
  node?: string,
  discoverySignal?: AbortSignal,
  availabilityRef?: NodeExecAvailabilityRef,
): Promise<BranchDynamicTool | undefined> {
  const pinnedNode = node?.trim();
  const availability = await (availabilityRef
    ? (availabilityRef.current ??= loadNodeExecAvailability(discoverySignal))
    : loadNodeExecAvailability(discoverySignal));
  discoverySignal?.throwIfAborted();
  if (!availability.isAvailable(pinnedNode)) {
    return undefined;
  }
  const pinnedTool = pinExecToolTarget(execTool, {
    host: "node",
    ...(pinnedNode ? { node: pinnedNode } : {}),
  });
  return {
    ...pinnedTool,
    name: CODEX_NODE_EXEC_DYNAMIC_TOOL_NAME,
    description: pinnedNode
      ? "Run a shell command to completion on the Branch Agent configured remote node for this session. This tool always uses Branch Agent host=node internally and follows the existing node exec approval and allowlist policy. Remote-node background follow-up is unavailable. Use Codex's native shell for local app-server work when it is available."
      : "Run a shell command to completion on a Branch Agent remote node. The sole connected node that can execute commands is selected automatically; select by name or id when several can. This tool always uses Branch Agent host=node internally and follows the existing node exec approval and allowlist policy. Remote-node background follow-up is unavailable. Use Codex's native shell for local app-server work when it is available.",
    execute: withProcessFollowupText(
      pinnedTool,
      "Remote-node background follow-up is unavailable. Wait for the command to complete.",
    ),
  };
}

export function createGatewayExecProjection(
  createProjection: CodexScheduledToolProjectionFactory,
  execTool: BranchDynamicTool,
  params: { processAliasAvailable: boolean; ask?: "always" },
): BranchDynamicTool {
  return createProjection(execTool, {
    kind: "exec",
    name: CODEX_GATEWAY_EXEC_DYNAMIC_TOOL_NAME,
    description:
      "Run a shell command through Branch Agent on the Gateway host for Branch-managed Gateway environment access, including Secret Store agent-readable environment values and protected egress sentinels. Native Codex shell remains preferred for ordinary local work. This tool always uses Branch Agent host=gateway internally and follows Gateway exec approval and allowlist policy.",
    followupText: params.processAliasAvailable
      ? "Use gateway_process (list/poll/log/write/send-keys/submit/paste/kill/clear/remove) for follow-up."
      : "Background session follow-up is unavailable because gateway_process is not exposed. Rerun without background=true and set yieldMs high enough to wait for completion.",
    ...(params.ask ? { ask: params.ask } : {}),
  });
}

export function createGatewayProcessProjection(
  createProjection: CodexScheduledToolProjectionFactory,
  processTool: BranchDynamicTool,
): BranchDynamicTool {
  return createProjection(processTool, {
    kind: "process",
    name: CODEX_GATEWAY_PROCESS_DYNAMIC_TOOL_NAME,
    description:
      "Manage background shell sessions in the existing per-session Branch Agent process scope: list, poll, log, write, send-keys, submit, paste, kill, clear, or remove. Use for gateway_exec follow-up; use native Codex shell session handling for ordinary local work.",
  });
}

export function createSandboxExecProjection(execTool: BranchDynamicTool): BranchDynamicTool {
  return {
    ...execTool,
    name: "sandbox_exec",
    description:
      "Run a shell command through Branch Agent's configured sandbox backend for this session. Use when Branch Agent sandboxing is active or when a command must execute in the sandbox backend, such as an SSH-backed sandbox or Docker container-path bind layout. Use Codex's native shell only when no Branch Agent sandbox is active and native Code Mode is available.",
    execute: withProcessFollowupText(
      execTool,
      "Use sandbox_process (list/poll/log/write/send-keys/submit/paste/kill/clear/remove) for follow-up.",
    ),
  };
}

function withProcessFollowupText(
  tool: BranchDynamicTool,
  followupText: string,
): BranchDynamicTool["execute"] {
  return async (toolCallId, args, signal, onUpdate) => {
    const result = await tool.execute(toolCallId, args, signal, onUpdate);
    return {
      ...result,
      content: result.content.map((item) =>
        item.type === "text"
          ? Object.assign({}, item, {
              text: item.text.replace(PROCESS_FOLLOWUP_TEXT, followupText),
            })
          : item,
      ),
    };
  };
}

export function createSandboxProcessProjection(
  processTool: BranchDynamicTool,
): BranchDynamicTool {
  return {
    ...processTool,
    name: "sandbox_process",
    description:
      "Manage background shell sessions through Branch Agent's configured sandbox backend for this session: list, poll, log, write, send-keys, submit, paste, kill, clear, or remove. Use only for sandbox follow-up; use Codex's native shell session handling only when no Branch Agent sandbox is active and native Code Mode is available.",
  };
}

/** Keeps replacement shell tools direct even when model metadata mandates Codex Code Mode. */
export function placeDisabledNativeShellToolsInDirectNamespace<
  T extends { name: string; catalogMode?: string },
>(tools: T[], nativeToolSurfaceEnabled: boolean | undefined): T[] {
  if (nativeToolSurfaceEnabled !== false) {
    return tools;
  }
  for (const tool of tools) {
    if (CODEX_DISABLED_NATIVE_SHELL_DYNAMIC_TOOLS.has(normalizeCodexDynamicToolName(tool.name))) {
      // Runtime tools can carry non-enumerable policy metadata and prototype behavior.
      // Preserve the prepared object identity while changing only its Codex catalog placement.
      tool.catalogMode = "direct-only";
    }
  }
  return tools;
}

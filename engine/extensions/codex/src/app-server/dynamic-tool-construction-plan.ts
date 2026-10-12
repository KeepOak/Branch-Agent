import type { resolveSandboxContext } from "branch/plugin-sdk/agent-harness-runtime";
import { isCodexPairedNodeRemoteExecPlacementSandbox } from "./config.js";

type BranchCodingToolsOptions = NonNullable<
  Parameters<(typeof import("branch/plugin-sdk/agent-harness"))["createBranchCodingTools"]>[0]
>;
type BranchSandboxContext = Awaited<ReturnType<typeof resolveSandboxContext>>;

/** Keeps node filesystem and process ownership on its native exec-server. */
export function resolveCodexToolConstructionPlan(
  sandbox: BranchSandboxContext | undefined,
  nativeToolSurfaceEnabled: boolean | undefined,
  requireWorkspaceOnly: boolean | undefined,
): BranchCodingToolsOptions["toolConstructionPlan"] {
  const nodeExecution =
    isCodexPairedNodeRemoteExecPlacementSandbox(sandbox) && sandbox?.backendId === "node";
  if (!nodeExecution && !requireWorkspaceOnly) {
    return undefined;
  }
  if (nodeExecution && !nativeToolSurfaceEnabled) {
    throw new Error(
      "Codex node execution requires its native exec-server tool surface; adjust the session tool policy and start a fresh attempt.",
    );
  }
  return {
    includeBaseCodingTools: !nodeExecution,
    includeShellTools: false,
    includeChannelTools: true,
    includeBranchTools: true,
    includePluginTools: true,
  };
}

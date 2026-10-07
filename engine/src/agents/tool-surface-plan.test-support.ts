import type { BranchConfig } from "../config/types.branch.js";
import { prepareAgentToolSurfacePresentation } from "./tool-surface-plan.js";

export function createToolSurfacePresentationForTest(
  config: BranchConfig = { tools: { codeMode: false, toolSearch: false } },
) {
  return prepareAgentToolSurfacePresentation({
    config,
    toolsEnabled: true,
    isRawModelRun: false,
    forceDirectMessageTool: false,
  });
}

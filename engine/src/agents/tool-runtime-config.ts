// Selects the resolved runtime snapshot for agent tool surfaces.
import {
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
  selectApplicableRuntimeConfig,
} from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";

export function resolveAgentRuntimeToolConfig(
  inputConfig?: BranchConfig,
): BranchConfig | undefined {
  return selectApplicableRuntimeConfig({
    inputConfig,
    runtimeConfig: getRuntimeConfigSnapshot(),
    runtimeSourceConfig: getRuntimeConfigSourceSnapshot(),
  });
}

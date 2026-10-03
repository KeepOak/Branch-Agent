/** Resolves the source config snapshot used for plugin activation policy decisions. */
import { getRuntimeConfigCapture } from "../config/runtime-config-capture-state.js";
import {
  getRuntimeConfigSnapshot,
  getRuntimeConfigSourceSnapshot,
} from "../config/runtime-snapshot.js";
import type { BranchConfig } from "../config/types.branch.js";

/** Resolves the source config used for plugin activation policy decisions. */
export function resolvePluginActivationSourceConfig(params: {
  config?: BranchConfig;
  activationSourceConfig?: BranchConfig;
}): BranchConfig {
  if (params.activationSourceConfig !== undefined) {
    return params.activationSourceConfig;
  }
  const captured = getRuntimeConfigCapture(params.config);
  if (captured) {
    return captured.source;
  }
  const sourceSnapshot = getRuntimeConfigSourceSnapshot();
  if (sourceSnapshot && params.config === getRuntimeConfigSnapshot()) {
    return sourceSnapshot;
  }
  return params.config ?? {};
}

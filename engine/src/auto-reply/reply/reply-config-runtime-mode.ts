import type { BranchConfig } from "../../config/types.branch.js";

// Reply completeness is process-local metadata. Keep it off config objects so
// frozen runtime snapshots and identity-keyed caches remain valid.
const replyConfigRuntimeModes = new WeakMap<BranchConfig, "fast" | "full">();

export function markReplyConfigRuntimeMode<T extends BranchConfig>(
  config: T,
  runtimeMode: "fast" | "full",
): T {
  replyConfigRuntimeModes.set(config, runtimeMode);
  return config;
}

export function isCompleteReplyConfig(config: unknown): config is BranchConfig {
  return Boolean(
    config && typeof config === "object" && replyConfigRuntimeModes.has(config as BranchConfig),
  );
}

export function usesFullReplyRuntime(config: unknown): boolean {
  if (!config || typeof config !== "object") {
    return false;
  }
  const mode = replyConfigRuntimeModes.get(config as BranchConfig);
  return mode === "full";
}

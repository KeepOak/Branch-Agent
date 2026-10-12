import type { BranchConfig } from "../../config/types.branch.js";

/** Commits a non-interactive onboard config update with pending plugin records handled first. */
export async function commitNonInteractiveOnboardConfig(params: {
  nextConfig: BranchConfig;
  baseConfig: BranchConfig;
  baseHash?: string;
  reset?: boolean;
}): Promise<BranchConfig> {
  const { writeWizardConfigFile } = await import("../../wizard/setup.shared.js");
  // Ordinary onboard reruns must preserve existing agents.entries / bindings.
  // Only explicit --reset may allow a config size drop; see openclaw#84692.
  return (
    await writeWizardConfigFile(params.nextConfig, {
      mergeBase: params.baseConfig,
      allowConfigSizeDrop: params.reset === true,
      ...(params.baseHash !== undefined ? { baseHash: params.baseHash } : {}),
    })
  ).nextConfig;
}

import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { isDiagnosticFlagEnabled } from "branch/plugin-sdk/diagnostic-flags";

const PROFILER_FLAGS = ["profiler", "codex.profiler"] as const;

export function isCodexAppServerProfilerEnabled(
  config?: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return PROFILER_FLAGS.some((flag) => isDiagnosticFlagEnabled(flag, config, env));
}

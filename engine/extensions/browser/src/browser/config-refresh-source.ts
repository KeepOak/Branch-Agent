import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  getRuntimeConfig,
  getRuntimeConfigSourceSnapshot,
} from "branch/plugin-sdk/runtime-config-snapshot";

export function loadBrowserConfigForRuntimeRefresh(): BranchConfig {
  return getRuntimeConfigSourceSnapshot() ?? getRuntimeConfig();
}

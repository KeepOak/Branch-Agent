import type { GatewayReloadMode } from "../config/types.gateway.js";
import type { BranchConfig } from "../config/types.branch.js";

export function resolveGatewayReloadSettings(
  cfg: BranchConfig,
  debounceMs = 300,
): { mode: GatewayReloadMode; debounceMs: number } {
  return { mode: cfg.gateway?.reload?.mode === "off" ? "off" : "hybrid", debounceMs };
}

// Gateway probe target resolver.
// Chooses local or remote probe mode from gateway config and URL availability.
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import type { BranchConfig } from "../config/types.branch.js";

// Probe target resolution converts configured gateway mode into the actual
// reachable target. Remote mode falls back to local probing when no remote URL
// exists so startup diagnostics can explain the missing URL.
export type GatewayProbeTargetResolution = {
  gatewayMode: "local" | "remote";
  mode: "local" | "remote";
  remoteUrlMissing: boolean;
};

export function resolveGatewayProbeTarget(cfg: BranchConfig): GatewayProbeTargetResolution {
  const gatewayMode = cfg.gateway?.mode === "remote" ? "remote" : "local";
  const remoteUrlRaw = normalizeOptionalString(cfg.gateway?.remote?.url) ?? "";
  const remoteUrlMissing = gatewayMode === "remote" && !remoteUrlRaw;
  return {
    gatewayMode,
    mode: gatewayMode === "remote" && !remoteUrlMissing ? "remote" : "local",
    remoteUrlMissing,
  };
}

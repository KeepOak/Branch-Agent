/** Availability check for exposing ACP runtime spawning to tools and clients. */
import type { BranchConfig } from "../../config/types.branch.js";
import { isAcpEnabledByPolicy } from "../policy.js";
import { getAcpRuntimeBackend, isAcpRuntimeBackendHealthy } from "./registry.js";

/** Returns whether ACP runtime spawning is allowed and the selected backend is healthy enough. */
export function isAcpRuntimeSpawnAvailable(params: {
  config?: BranchConfig;
  sandboxed?: boolean;
  backendId?: string;
}): boolean {
  if (params.sandboxed === true) {
    return false;
  }
  if (params.config && !isAcpEnabledByPolicy(params.config)) {
    return false;
  }
  const backend = getAcpRuntimeBackend(params.backendId ?? params.config?.acp?.backend);
  return backend !== null && isAcpRuntimeBackendHealthy(backend);
}

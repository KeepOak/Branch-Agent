import { normalizeAgentId } from "@branch/normalization-core/agent-id";
import { tryResolveLegacyDataOwnerAgentId } from "../agents/agent-scope-config.js";
import {
  getRetainedLegacyDefaultAgentId,
  setRetainedLegacyDefaultAgentId,
} from "./legacy.default-agent-owner-state.js";
import type { BranchConfig } from "./types.branch.js";

export function retainLegacyDefaultAgentId(
  config: BranchConfig,
  agentId: string | undefined,
): BranchConfig {
  setRetainedLegacyDefaultAgentId(config, agentId ? normalizeAgentId(agentId) : undefined);
  return config;
}

export function inheritLegacyDefaultAgentId(
  source: BranchConfig,
  target: BranchConfig,
): BranchConfig {
  return retainLegacyDefaultAgentId(target, tryGetLegacyDefaultAgentId(source));
}

export function tryGetLegacyDefaultAgentId(config: BranchConfig): string | undefined {
  return getRetainedLegacyDefaultAgentId(config);
}
export { tryResolveLegacyCompatibilityAgentId } from "../agents/agent-scope-config.js";

export function resolveSessionStoreCompatibilityAgentId(config: BranchConfig): string {
  const persistedAgentId = config.agents?.defaults?.sessionStore?.agentId?.trim();
  return persistedAgentId
    ? normalizeAgentId(persistedAgentId)
    : (tryResolveLegacyDataOwnerAgentId(config) ?? "main");
}

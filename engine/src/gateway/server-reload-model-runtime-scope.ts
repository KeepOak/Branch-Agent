import { isDeepStrictEqual } from "node:util";
import { collectConfiguredModelRefs } from "@branch/model-catalog-core/configured-model-refs";
import { refreshPreparedModelRuntimeSnapshots } from "../agents/prepared-model-runtime.js";
import { resolveChannelConfigActivationFacts } from "../config/channel-config-activation.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { isProviderAuthRelevantReloadPath } from "./config-reload-recovery.js";

/** Returns affected agent ids when every meaningful reload path is agent-entry-local. */
export function resolveReloadAgentIds(
  changedPaths: readonly string[],
): ReadonlySet<string> | undefined {
  if (changedPaths.length === 0) {
    return undefined;
  }
  const agentIds = new Set<string>();
  for (const path of changedPaths) {
    if (path === "meta" || path.startsWith("meta.")) {
      continue;
    }
    const match = /^agents\.entries\.([^.]+)(?:\.|$)/.exec(path);
    if (!match?.[1]) {
      return undefined;
    }
    agentIds.add(normalizeAgentId(match[1]));
  }
  return agentIds.size > 0 ? agentIds : undefined;
}

const AGENT_ENTRY_REF_PATH = /^agents\.entries\.([^.]+)\./;

function changedModelRefPaths(previousConfig: BranchConfig, nextConfig: BranchConfig): string[] {
  const index = (config: BranchConfig) =>
    new Map(collectConfiguredModelRefs(config).map((ref) => [ref.path, ref.value]));
  const previous = index(previousConfig);
  const next = index(nextConfig);
  return [...new Set([...previous.keys(), ...next.keys()])].filter(
    (path) => previous.get(path) !== next.get(path),
  );
}

/**
 * Narrows the prepared model runtime refresh to the Trunks a hot reload can affect.
 * Model-neutral paths (skills, MCP servers, tool policy, bindings, roster bookkeeping)
 * are advanced in place for every owner and never widen the refresh to unrelated Trunks,
 * whose admitted runs would otherwise lose their plugin generation mid-flight.
 * Returns undefined when every agent must be refreshed.
 */
export function resolveModelRuntimeRefreshAgentIds(params: {
  changedPaths: readonly string[];
  reloadPlugins: boolean;
  previousConfig: BranchConfig;
  nextConfig: BranchConfig;
}): ReadonlySet<string> | undefined {
  const bounded = resolveReloadAgentIds(params.changedPaths);
  if (bounded || params.reloadPlugins) {
    // A plugin generation swap replaces instances every prepared runtime borrows.
    return bounded;
  }
  const agentIds = resolveReloadAgentIds(
    params.changedPaths.filter(isProviderAuthRelevantReloadPath),
  );
  if (!agentIds) {
    return undefined;
  }
  for (const path of changedModelRefPaths(params.previousConfig, params.nextConfig)) {
    const agentId = AGENT_ENTRY_REF_PATH.exec(path)?.[1];
    if (!agentId || !agentIds.has(normalizeAgentId(agentId))) {
      return undefined;
    }
  }
  if (
    !isDeepStrictEqual(
      resolveChannelConfigActivationFacts(params.previousConfig),
      resolveChannelConfigActivationFacts(params.nextConfig),
    )
  ) {
    return undefined;
  }
  return agentIds;
}

export function refreshModelRuntimeAfterHotReload(params: {
  config: BranchConfig;
  agentIds: ReadonlySet<string> | undefined;
  pluginMetadataSnapshot: PluginMetadataSnapshot | undefined;
  isPublicationCurrent?: () => boolean;
}): Promise<void> {
  return refreshPreparedModelRuntimeSnapshots(params.config, {
    catalogMode: "static",
    joinSupersedingPublication: true,
    ...(params.isPublicationCurrent ? { isPublicationCurrent: params.isPublicationCurrent } : {}),
    allowGatewaySubagentBinding: true,
    ...(params.agentIds ? { agentIds: params.agentIds } : {}),
    ...(params.pluginMetadataSnapshot
      ? { pluginMetadataSnapshot: params.pluginMetadataSnapshot }
      : {}),
  });
}

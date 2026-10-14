import { PreparedModelRuntimePublicationSupersededError } from "../agents/prepared-model-runtime.errors.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";
import type { GatewayStartupTrace } from "./server-startup-trace.js";

const log = createSubsystemLogger("gateway/startup-model-runtime");

/** Startup publications a Gateway start repeats after newer publications left its agents unpublished. */
export const MAX_STARTUP_MODEL_PUBLICATION_ROUNDS = 5;

type StartupExternalAuthHydrationDeps = {
  listAgentIds: (cfg: BranchConfig) => string[];
  resolveAgentDir: (cfg: BranchConfig, agentId: string) => string;
  collectConfiguredRefs: (cfg: BranchConfig, agentId: string) => readonly { value: string }[];
  hydrate: (cfg: BranchConfig, agentDir: string, providers: readonly string[]) => void;
};

export async function hydrateConfiguredExternalCliAuth(params: {
  getConfig: () => BranchConfig;
  log: { warn: (msg: string) => void };
  deps?: StartupExternalAuthHydrationDeps | Promise<StartupExternalAuthHydrationDeps>;
}): Promise<BranchConfig> {
  const deps: StartupExternalAuthHydrationDeps =
    (await params.deps) ??
    (await Promise.all([
      import("../agents/agent-scope.js"),
      import("../agents/prepared-model-runtime.configured.js"),
      import("../agents/auth-profiles/store-runtime.js"),
      import("../agents/auth-profiles/external-cli-discovery.js"),
    ]).then(([scope, configured, store, external]) => ({
      listAgentIds: scope.listAgentIds,
      resolveAgentDir: scope.resolveAgentDir,
      collectConfiguredRefs: configured.collectPreparedModelRuntimeConfiguredRefs,
      hydrate: (cfg: BranchConfig, agentDir: string, providers: readonly string[]) => {
        const discovery = external.externalCliDiscoveryForProviders({ cfg, providers });
        if (discovery.mode === "none") {
          return;
        }
        store.ensureAuthProfileStore(agentDir, {
          config: cfg,
          externalCli: discovery,
          allowKeychainPrompt: false,
          readOnly: true,
          syncExternalCli: false,
        });
      },
    })));
  const cfg = params.getConfig();
  const hydratedDirs = new Set<string>();
  for (const agentId of deps.listAgentIds(cfg)) {
    const providers = deps.collectConfiguredRefs(cfg, agentId).flatMap(({ value }) => {
      const separator = value.indexOf("/");
      return separator > 0 ? [value.slice(0, separator)] : [];
    });
    const agentDir = deps.resolveAgentDir(cfg, agentId);
    if (providers.length === 0 || hydratedDirs.has(agentDir)) {
      continue;
    }
    hydratedDirs.add(agentDir);
    try {
      deps.hydrate(cfg, agentDir, providers);
    } catch (error) {
      params.log.warn(
        `startup external CLI auth hydration failed for agent ${agentId}: ${String(error)}`,
      );
    }
  }
  return cfg;
}

/**
 * Publishes the configured agents' model runtimes before the Gateway accepts work. An agent's startup
 * admission, a reload or an auth refresh may start a newer publication while this one builds; that
 * supersedes this one for every agent it covers. Superseded is not failed: wait out the newer
 * publication, then re-check, and publish again only if it left a configured agent unpublished.
 */
export async function publishConfiguredModelRuntimeSnapshots(params: {
  cfg: BranchConfig;
  getConfig?: () => BranchConfig | Promise<BranchConfig>;
  isCurrent?: () => boolean;
  pluginMetadataSnapshot?: PluginMetadataSnapshot;
  workspaceDir?: string;
  startupTrace?: GatewayStartupTrace;
}): Promise<void> {
  const { getPendingPreparedModelRuntimeReplacement, hasPublishedConfiguredModelRuntimes } =
    await import("../agents/prepared-model-runtime.js");
  for (let round = 1; ; round += 1) {
    try {
      await publishConfiguredModelRuntimeSnapshotsOnce(params);
      return;
    } catch (error) {
      if (
        !(error instanceof PreparedModelRuntimePublicationSupersededError) ||
        params.isCurrent?.() === false
      ) {
        throw error;
      }
      log.info(
        `startup model publication was superseded (${error.message}); waiting for the newer publication`,
      );
      for (
        let pending = getPendingPreparedModelRuntimeReplacement(), waited: Promise<void> | undefined;
        pending && pending !== waited;
        pending = getPendingPreparedModelRuntimeReplacement()
      ) {
        waited = pending;
        await pending.catch(() => undefined);
      }
      if (params.isCurrent?.() === false || hasPublishedConfiguredModelRuntimes()) {
        return;
      }
      if (round >= MAX_STARTUP_MODEL_PUBLICATION_ROUNDS) {
        throw error;
      }
      log.info("startup model publication left a configured agent unpublished; publishing again");
    }
  }
}

async function publishConfiguredModelRuntimeSnapshotsOnce(params: {
  cfg: BranchConfig;
  getConfig?: () => BranchConfig | Promise<BranchConfig>;
  isCurrent?: () => boolean;
  pluginMetadataSnapshot?: PluginMetadataSnapshot;
  workspaceDir?: string;
  startupTrace?: GatewayStartupTrace;
}): Promise<void> {
  const { refreshPreparedModelRuntimeSnapshots } =
    await import("../agents/prepared-model-runtime.js");
  if (params.isCurrent?.() === false) {
    return;
  }
  await refreshPreparedModelRuntimeSnapshots(params.getConfig ?? params.cfg, {
    gatewayLifecycle: true,
    startup: true,
    catalogMode: "static",
    allowGatewaySubagentBinding: true,
    ...(params.isCurrent ? { isPublicationCurrent: params.isCurrent } : {}),
    ...(params.pluginMetadataSnapshot
      ? { pluginMetadataSnapshot: params.pluginMetadataSnapshot }
      : {}),
    ...(params.workspaceDir ? { defaultWorkspaceDir: params.workspaceDir } : {}),
    ...(params.startupTrace
      ? {
          onBuildStats: (stats) =>
            params.startupTrace?.detail("sidecars.model-runtime-build", [
              ["agentCount", stats.agentCount],
              ["workspaceGroupCount", stats.workspaceGroupCount],
              ["configuredFactsGroupCount", stats.configuredFactsGroupCount],
              ["catalogSourceCount", stats.catalogSourceCount],
              ["credentialGroupCount", stats.credentialGroupCount],
              ["catalogGroupCount", stats.catalogGroupCount],
              ["runtimeRegistryCount", stats.runtimeRegistryCount],
              ["configuredRuntimeModelCount", stats.configuredRuntimeModelCount],
              ["generatedCatalogPluginCount", stats.generatedCatalogPluginCount],
              ["generatedCatalogReadCount", stats.generatedCatalogReadCount],
              ["workspaceFactsMs", stats.workspaceFactsMs],
              ["runtimePluginMs", stats.runtimePluginMs],
              ["pluginMetadataMs", stats.pluginMetadataMs],
              ["staticProviderCatalogMs", stats.staticProviderCatalogMs],
              ["ambientCredentialsMs", stats.ambientCredentialsMs],
              ["agentFactsMs", stats.agentFactsMs],
              ["configuredProjectionMs", stats.configuredProjectionMs],
              ["catalogSourceMs", stats.catalogSourceMs],
              ["registryMs", stats.registryMs],
              ["sourceConcurrencyLimitCount", stats.sourceConcurrencyLimit],
              ["fullCatalogConcurrencyLimitCount", stats.fullCatalogConcurrencyLimit],
            ]),
        }
      : {}),
  });
}

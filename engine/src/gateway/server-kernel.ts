import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { closePreparedModelRuntimeSnapshots } from "../agents/prepared-model-runtime.lifecycle.js";
import { readConfigFileSnapshotWithPluginMetadata } from "../config/io.js";
import { isNixMode, resolveIsConfigReadOnly } from "../config/paths.js";
import { captureConfigOverrideApplier } from "../config/runtime-overrides.js";
import {
  beginCronReceiptAuthorityClose,
  startCronReceiptAuthorityHost,
} from "../cron/store/receipt-authority-owner.js";
import { clearGatewayAgentCliShim } from "../infra/branch-cli-shim.js";
import { GatewayScheduler } from "../infra/gateway-scheduler.js";
import { ensureBranchCliOnPath } from "../infra/path-env.js";
import { createSubsystemLogger, runtimeForLogger } from "../logging/subsystem.js";
import { captureRemoteModelCatalogStartupSnapshot } from "../model-catalog/remote-overlay.js";
import {
  LegacyPluginSdkResourceHost,
  bindLegacyPluginSdkResourceHost,
} from "../plugins/legacy-sdk-resource-host.js";
import { retainGatewayPluginMetadata } from "../plugins/plugin-metadata-lifecycle.js";
import { hasRetainedPluginRuntimeCloseError } from "../plugins/runtime-close-error.js";
import { createPluginRegistryOwner } from "../plugins/runtime.js";
import { clearSecretsRuntimeSnapshotState } from "../secrets/runtime-state.js";
import { createLazyRuntimeMethodBinder, createLazyRuntimeModule } from "../shared/lazy-runtime.js";
import { getAgentDatabaseStartupAdmission } from "../state/agent-database-startup.js";
import { createGatewayControlUiRootLifecycle } from "./server-control-ui-root.js";
import { startGatewayCoreRuntime } from "./server-core-runtime.js";
import { GatewayHandoffFatalError } from "./server-handoff-error.js";
import { prepareGatewayKernelRequestRuntime } from "./server-kernel-request-runtime.js";
import { prepareGatewayLifecycle } from "./server-lifecycle.js";
import { registerGatewayModelCatalogPrivateAccess } from "./server-model-catalog-auth.js";
import type { GatewayServerOptions } from "./server-public.js";
import { prepareGatewayKernelState } from "./server-runtime-state-prepare.js";
import { rethrowGatewayStartupError } from "./server-shutdown.js";
import { prepareGatewayServerBootstrap } from "./server-startup-bootstrap.js";

const loadGatewayModelCatalogModule = createLazyRuntimeModule(
  () => import("./server-model-catalog.js"),
);
const bindGatewayModelCatalog = createLazyRuntimeMethodBinder(loadGatewayModelCatalogModule);

const log = createSubsystemLogger("gateway");
const logDiscovery = log.child("discovery");
const logTailscale = log.child("tailscale");
const logChannels = log.child("channels");
const logHealth = log.child("health");
const logCron = log.child("cron");
const logReload = log.child("reload");
const logHooks = log.child("hooks");
const logPlugins = log.child("plugins");
const logWsControl = log.child("ws");
const logSecrets = log.child("secrets");

export const gatewayKernelLogs = {
  log,
  logTailscale,
  logChannels,
  logHealth,
  logCron,
  logReload,
  logHooks,
  logWsControl,
};

const gatewayRuntime = runtimeForLogger(log);
const getChannelRuntime = createLazyRuntimeModule(() =>
  import("../plugins/runtime/runtime-channel.js").then(({ createRuntimeChannel }) =>
    createRuntimeChannel(),
  ),
);

const loadGatewayModelCatalog = bindGatewayModelCatalog((mod) => mod.loadGatewayModelCatalog);
const loadGatewayModelCatalogSnapshot = bindGatewayModelCatalog(
  (mod) => mod.loadGatewayModelCatalogSnapshot,
);
const readPreparedGatewayModelCatalog = bindGatewayModelCatalog(
  (mod) => mod.readPreparedGatewayModelCatalog,
);
const readPreparedGatewayModelCatalogBatch = bindGatewayModelCatalog(
  (mod) => mod.readPreparedGatewayModelCatalogBatch,
);
const loadPreparedGatewayModelCatalogSnapshot = bindGatewayModelCatalog(
  (mod) => mod.loadPreparedGatewayModelCatalogSnapshot,
);
const readPreparedGatewayModelCatalogOwnerSnapshot = bindGatewayModelCatalog(
  (mod) => mod.readPreparedGatewayModelCatalogOwnerSnapshot,
);

registerGatewayModelCatalogPrivateAccess(loadGatewayModelCatalogSnapshot, {
  loadDeferred: (params) => loadPreparedGatewayModelCatalogSnapshot(params),
  readPrepared: readPreparedGatewayModelCatalogOwnerSnapshot,
});

function formatRuntimeGatewayAuthTokenWarning(): string {
  const base =
    "Gateway auth token was missing. Generated a runtime token for this startup without changing config; restart will generate a different token.";
  if (!isNixMode && resolveIsConfigReadOnly()) {
    return `${base} Set gateway.auth.token in your external config source and redeploy.`;
  }
  if (!isNixMode) {
    return `${base} Persist one with \`branch config set gateway.auth.mode token\` and \`branch config set gateway.auth.token <token>\`.`;
  }
  return [
    base,
    "In Nix mode, set gateway.auth.token in your Nix-managed Branch Agent config and rebuild.",
    "For the first-party Nix flow, see https://github.com/openclaw/nix-openclaw#quick-start and https://docs.openclaw.ai/install/nix.",
  ].join(" ");
}

type GatewayKernelOptions = {
  deferEarlyRuntime?: boolean;
  sdkResourceHost?: LegacyPluginSdkResourceHost;
};
type GatewayStateLease = NonNullable<GatewayServerOptions["gatewayStateOwner"]> & {
  release?: () => Promise<void>;
};

/** Builds the Gateway kernel and internal dispatch surface without creating HTTP servers. */
export async function createGatewayKernel(
  port = 18789,
  opts: GatewayServerOptions = {},
  options: GatewayKernelOptions = {},
) {
  const prepared = await prepareGatewayKernel(port, opts, options);
  return prepared.activate();
}

/** Perform the read-only, owner-independent portion of kernel startup. */
export async function prepareGatewayKernel(
  port = 18789,
  opts: GatewayServerOptions = {},
  options: GatewayKernelOptions = {},
) {
  // Read the same snapshot activation would otherwise read. In particular, do not
  // run startup maintenance, construct the state runtime, or claim cron authority.
  const startupConfigSnapshotRead =
    opts.startupConfigSnapshotRead ??
    (await readConfigFileSnapshotWithPluginMetadata({ observe: false }));
  const cfg = captureConfigOverrideApplier()(startupConfigSnapshotRead.snapshot.config);
  const controlUiRoot = cfg.gateway?.controlUi?.root?.trim() || undefined;
  const preparedControlUiRootLifecycle = createGatewayControlUiRootLifecycle({
    controlUiRootOverride: controlUiRoot,
    controlUiEnabled: opts.controlUiEnabled ?? cfg.gateway?.controlUi?.enabled ?? true,
    gatewayRuntime,
    log,
  });
  const activationOptions = {
    ...opts,
    startupConfigSnapshotRead,
    preparedControlUiRootLifecycle,
  };
  let activated = false;
  return {
    activationOptions,
    async activate(stateLease: GatewayStateLease | undefined = opts.gatewayStateOwner) {
      if (activated) {
        throw new Error("Prepared Gateway kernel has already been activated");
      }
      // Reserve this preparation before the first await: concurrent callers must
      // never both bootstrap a state-owning kernel.
      activated = true;
      stateLease?.assertDatabaseAccess(
        (await import("../state/branch-state-db.paths.js")).resolveBranchStateSqlitePath(),
      );
      (await import("../process/session-handoff-lease-gate.js")).refreshSessionHandoffLeases();
      process.env.BRANCH_GATEWAY_PORT = String(port);
      const leasedOptions = {
        ...activationOptions,
        gatewayStateOwner: stateLease,
      };
      const scheduler = new GatewayScheduler();
      const sdkResourceHost = options.sdkResourceHost ?? new LegacyPluginSdkResourceHost();
      sdkResourceHost.bindScheduler(scheduler);
      let kernel: Awaited<ReturnType<typeof createGatewayKernelWithSdkHost>>;
      try {
        await preparedControlUiRootLifecycle.start();
        kernel = await sdkResourceHost.run(() =>
          createGatewayKernelWithSdkHost(port, leasedOptions, options, sdkResourceHost, scheduler),
        );
      } catch (error) {
        await preparedControlUiRootLifecycle.stop();
        throw error;
      }
      let deactivation: Promise<void> | undefined;
      return {
        ...kernel,
        deactivate: () =>
          (deactivation ??= (async () => {
            const deadline = Date.now() + 18_000;
            const beforeDeadline = async <T>(work: Promise<T>): Promise<T> => {
              const remaining = deadline - Date.now();
              if (remaining <= 0) {
                throw new GatewayHandoffFatalError(
                  "Gateway handoff deactivation exceeded 18 seconds",
                );
              }
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                return await Promise.race([
                  work,
                  new Promise<never>((_, reject) => {
                    timer = setTimeout(
                      () =>
                        reject(
                          new GatewayHandoffFatalError(
                            "Gateway handoff deactivation exceeded 18 seconds",
                          ),
                        ),
                      remaining,
                    );
                  }),
                ]);
              } finally {
                clearTimeout(timer);
              }
            };
            await beforeDeadline(sdkResourceHost.run(() => kernel.deactivate(deadline)));
            try {
              await beforeDeadline(Promise.resolve(stateLease?.release?.()));
            } catch (error) {
              if (error instanceof GatewayHandoffFatalError) {
                throw error;
              }
              // The lease release may fail before ownership transfers. In that
              // case this kernel is still the only engine and must take work again.
              try {
                stateLease?.assertDatabaseAccess(
                  (
                    await import("../state/branch-state-db.paths.js")
                  ).resolveBranchStateSqlitePath(),
                );
                await beforeDeadline(sdkResourceHost.run(() => kernel.restoreFailedStateRelease()));
              } catch (restoreError) {
                if (restoreError instanceof GatewayHandoffFatalError) {
                  throw restoreError;
                }
                throw new GatewayHandoffFatalError(
                  "Gateway handoff lost state ownership or could not restore serving",
                  { cause: new AggregateError([error, restoreError]) },
                );
              }
              throw error;
            }
            kernel.commitStateRelease();
          })().catch((error: unknown) => {
            deactivation = undefined;
            throw error;
          })),
        rollbackDeactivation: () => sdkResourceHost.run(() => kernel.rollbackDeactivation()),
        waitForDeactivatedRuns: () => kernel.waitForDeactivatedRuns(),
      };
    },
  };
}

async function createGatewayKernelWithSdkHost(
  port: number,
  opts: GatewayServerOptions,
  options: GatewayKernelOptions,
  sdkResourceHost: LegacyPluginSdkResourceHost,
  scheduler: GatewayScheduler,
) {
  // Listener and socket-free embedders share one generation for instance-owned state.
  const suppliedBootId = opts.bootId;
  if (
    suppliedBootId !== undefined &&
    (suppliedBootId.trim() !== suppliedBootId || !suppliedBootId || suppliedBootId.length > 96)
  ) {
    throw new Error("Gateway boot ID must contain 1 to 96 characters");
  }
  const bootId = suppliedBootId ?? randomUUID();
  // Capture before bootstrap yields or creates workers; later downloads publish through adoption.
  captureRemoteModelCatalogStartupSnapshot();
  // Retain cancellation before bootstrap owns resources or an update replaces its chunk.
  const { cancelPreparedModelRuntimeRefresh } = await import("../agents/prepared-model-runtime.js");
  ensureBranchCliOnPath();
  const pluginMetadata = retainGatewayPluginMetadata(scheduler, async () => {
    cancelPreparedModelRuntimeRefresh();
  });
  let pluginRegistryOwner: ReturnType<typeof createPluginRegistryOwner> | undefined;
  let lifecycleRuntime: Awaited<ReturnType<typeof prepareGatewayLifecycle>> | undefined;
  let kernelState: Awaited<ReturnType<typeof prepareGatewayKernelState>> | undefined;
  let closeStartupTrace: (() => void) | undefined;
  let startupError: unknown;
  try {
    const bootstrap = await pluginMetadata.runBootstrap(() =>
      prepareGatewayServerBootstrap({
        port,
        opts,
        log,
        logSecrets,
        loadWorkerEnvironmentStartupModule: () => import("./server-worker-environment-startup.js"),
        formatRuntimeGatewayAuthTokenWarning,
      }),
    );
    closeStartupTrace = bootstrap.startupTrace.close;
    pluginRegistryOwner = createPluginRegistryOwner(
      bootstrap.pluginBootstrap.pluginRegistry,
      bootstrap.pluginBootstrap.pluginWorkspaceDir,
    );
    pluginMetadata.publish(bootstrap.pluginMetadataSnapshot);
    const preparedPluginRegistryOwner = pluginRegistryOwner;
    const runtime = await bootstrap.startupTrace.measure("gateway.kernel-state", () =>
      prepareGatewayKernelState({
        bootstrap,
        scheduler,
        bootId,
        pluginRegistryOwner: preparedPluginRegistryOwner,
        getPluginReloadStatus: () =>
          lifecycleRuntime?.kernel.pluginRuntimeGeneration.getReloadStatus(),
        port,
        opts,
        log,
        logChannels,
        logHooks,
        logPlugins,
        gatewayRuntime,
        resolveChannelRuntime: getChannelRuntime,
      }),
    );
    kernelState = runtime;
    bindLegacyPluginSdkResourceHost(runtime.resolvePluginGatewayContext, sdkResourceHost);
    // An in-place update may replace every hashed chunk before SIGTERM arrives.
    // Resolve and retain the complete shutdown graph while the install is healthy.
    const shutdownRuntime = await runtime.startupTrace.measure(
      "gateway.shutdown-runtime-import",
      async () => (await import("./server-shutdown.runtime.js")).prepareGatewayShutdownRuntime(),
    );
    const preparedLifecycleRuntime = await runtime.startupTrace.measure("gateway.lifecycle", () =>
      prepareGatewayLifecycle({
        runtime,
        sdkResourceHost,
        pluginMetadata,
        port,
        log,
        logCron,
        shutdownRuntime,
      }),
    );
    lifecycleRuntime = preparedLifecycleRuntime;
    const databaseStartupAdmission = getAgentDatabaseStartupAdmission();
    if (databaseStartupAdmission) {
      preparedLifecycleRuntime.registerGatewayLifetimeSidecars(databaseStartupAdmission.adopt());
    }
    // Retain teardown first. A timer turn lets I/O run before more cached imports.
    await delay(0, undefined, { signal: runtime.connectionWork.signal });
    runtime.connectionWork.signal.throwIfAborted();
    if (bootstrap.cfgAtStart.gateway?.tls?.enabled && !runtime.gatewayTls.enabled) {
      throw new Error(runtime.gatewayTls.error ?? "gateway tls: failed to enable");
    }
    const coreRuntime = await runtime.startupTrace.measure("gateway.core-runtime", () =>
      startGatewayCoreRuntime({
        lifecycleRuntime: preparedLifecycleRuntime,
        port,
        log,
        logDiscovery,
        logHealth,
        logChannels,
        loadGatewayModelCatalog,
        loadGatewayModelCatalogSnapshot,
        readPreparedGatewayModelCatalog,
        readPreparedGatewayModelCatalogBatch,
      }),
    );
    if (!options.deferEarlyRuntime) {
      await coreRuntime.startEarlyRuntime();
    }
    await pluginMetadata.waitForRetirement();
    const requestRuntime = await runtime.startupTrace.measure("gateway.request-runtime", () =>
      prepareGatewayKernelRequestRuntime({
        coreRuntime,
        log,
        logHealth,
        hostLifecycle: opts.hostLifecycle,
      }),
    );
    return { ...requestRuntime, activateCronAuthority: startCronReceiptAuthorityHost };
  } catch (error) {
    startupError = error;
  }
  return await rethrowGatewayStartupError(startupError, async () => {
    const prelude = pluginMetadata.beginClose();
    if (prelude) {
      beginCronReceiptAuthorityClose();
    }
    scheduler.beginClose();
    await prelude;
    if (lifecycleRuntime) {
      // The lifecycle releases metadata only after its required joins succeed.
      await lifecycleRuntime.closeOnStartupFailure();
    } else {
      closeStartupTrace?.();
      await kernelState?.mentionInbox.dispose();
      await scheduler.stop();
      await sdkResourceHost.drainWork();
      const cleanupErrors: unknown[] = [];
      const releaseMetadata = async (
        retireRegistry?: Parameters<typeof pluginMetadata.close>[1],
      ) => {
        try {
          await sdkResourceHost.close();
        } catch (cleanupError) {
          if (hasRetainedPluginRuntimeCloseError(cleanupError)) {
            throw cleanupError;
          }
          cleanupErrors.push(cleanupError);
        }
        return pluginMetadata.close(async (retire) => {
          await closePreparedModelRuntimeSnapshots();
          await retire();
          for (const cleanup of [clearGatewayAgentCliShim, clearSecretsRuntimeSnapshotState]) {
            try {
              cleanup();
            } catch (cleanupError) {
              cleanupErrors.push(cleanupError);
            }
          }
        }, retireRegistry);
      };
      try {
        await (pluginRegistryOwner
          ? pluginRegistryOwner.close(releaseMetadata)
          : releaseMetadata());
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      if (cleanupErrors.length === 1) {
        throw cleanupErrors[0];
      }
      if (cleanupErrors.length > 1) {
        throw new AggregateError(cleanupErrors, "Gateway startup cleanup failed", {
          cause: cleanupErrors[0],
        });
      }
    }
  });
}

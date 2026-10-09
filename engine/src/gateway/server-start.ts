import { flushCompileCache } from "node:module";
import { formatErrorMessage } from "../infra/errors.js";
import { LegacyPluginSdkResourceHost } from "../plugins/legacy-sdk-resource-host.js";
import { hasRetainedPluginRuntimeCloseError } from "../plugins/runtime-close-error.js";
import { createDeferredCore } from "../shared/deferred.js";
import { bumpSkillsSnapshotVersion } from "../skills/runtime/refresh-state.js";
import { prepareGatewayKernel, gatewayKernelLogs } from "./server-kernel.js";
import type { GatewayServer, GatewayServerOptions } from "./server-public.js";
import { createGatewayHttpTransport } from "./server-runtime-state.js";
import { rethrowGatewayStartupError, runGatewayCloseSteps } from "./server-shutdown.js";
import { finishGatewayStartup } from "./server-startup-finish.js";
import { beginMacOSSystemCaWarmupOnce } from "./system-ca-warmup.js";
import { assignTrunkCharactersAtStartup } from "./trunk-character-startup.js";

const { log, logTailscale, logChannels, logHealth, logCron, logReload, logHooks, logWsControl } =
  gatewayKernelLogs;
const POST_READY_WORK_START_DELAY_MS = 500;

export async function startGatewayServerCore(
  port = 18789,
  opts: GatewayServerOptions = {},
): Promise<GatewayServer> {
  const sdkResourceHost = new LegacyPluginSdkResourceHost();
  return await sdkResourceHost.run(() =>
    startGatewayServerWithSdkHost(port, opts, sdkResourceHost),
  );
}

async function startGatewayServerWithSdkHost(
  port: number,
  opts: GatewayServerOptions,
  sdkResourceHost: LegacyPluginSdkResourceHost,
): Promise<GatewayServer> {
  const { promise: postReadyWorkBarrier, resolve: releasePostReadyWork } = createDeferredCore();
  if (!opts.startupConfigSnapshotRead && !opts.updateCanary) {
    await assignTrunkCharactersAtStartup();
  }
  const preparedKernel = await prepareGatewayKernel(port, opts, {
    deferEarlyRuntime: true,
    sdkResourceHost,
  });
  const activationOptions = preparedKernel.activationOptions;
  const gatewayKernel = await preparedKernel.activate();
  // A Gateway restart must refresh restored skill catalogs, even in the same process.
  bumpSkillsSnapshotVersion({ reason: "manual" });
  if (!gatewayKernel.minimalTestGateway) {
    // Start the Keychain read early so it overlaps bootstrap; post-attach awaits the
    // shared promise before plugins can use TLS.
    void beginMacOSSystemCaWarmupOnce({ log });
  }
  let startupSettled: Promise<void>;
  const {
    beginClosePrelude,
    closeOnStartupFailure,
    prepareClose,
    terminalSessions,
    shutdownRuntime,
  } = gatewayKernel;
  try {
    const transport = await createGatewayHttpTransport({
      ...gatewayKernel.createHttpTransportOptions(),
      updateCanary: opts.updateCanary,
      ...(!gatewayKernel.minimalTestGateway && gatewayKernel.tailscaleMode !== "off"
        ? {
            prepareManagedTailscaleIngress: async (backend) => {
              const { startGatewayTailscaleExposure } = await import("./server-tailscale.js");
              const cleanup = await startGatewayTailscaleExposure({
                tailscaleMode: gatewayKernel.tailscaleMode,
                preserveFunnel: gatewayKernel.tailscaleConfig.preserveFunnel ?? false,
                port,
                backend,
                controlUiBasePath: gatewayKernel.controlUiBasePath,
                logTailscale,
              });
              // The server close handle is not published until this callback settles.
              // Startup failure therefore owns teardown before normal close can race it.
              gatewayKernel.kernel.setTailscaleCleanup(cleanup);
            },
          }
        : {}),
    });
    gatewayKernel.transportBridge.attach(transport);
    const startup = await finishGatewayStartup({
      kernelRuntime: { ...gatewayKernel, ...transport },
      port,
      opts: activationOptions,
      bootId: gatewayKernel.bootId,
      log,
      logHealth,
      logWsControl,
      logHooks,
      logChannels,
      logCron,
      logReload,
      waitForPostReadyWork: () => postReadyWorkBarrier,
    });
    startupSettled = startup.startupSettled;
  } catch (err) {
    // Failed startup must release work whose normal timer was never armed.
    releasePostReadyWork();
    return await rethrowGatewayStartupError(err, closeOnStartupFailure);
  }
  void startupSettled.then(
    () => {
      if (gatewayKernel.lifecycle.closePreludeStarted) {
        return;
      }
      // Node otherwise writes the entire cold-start cache inside process.exit(),
      // after the clean-close log and outside the desktop's asynchronous drain.
      // Publish it before deferred background work, not during a later quit.
      flushCompileCache();
      // Deferred sidecars must finish before the I/O window for background work begins.
      gatewayKernel.scheduler.schedule({
        id: "startup:post-ready-work",
        delayMs: POST_READY_WORK_START_DELAY_MS,
        run: releasePostReadyWork,
      });
    },
    // The caller owns deferred startup failure; close releases the background waiters.
    () => {},
  );

  let closePromise: Promise<void> | undefined;

  return {
    startupSettled,
    getTailscaleIngressEndpoint: gatewayKernel.transportBridge.getTailscaleIngressEndpoint,
    deactivate: () => sdkResourceHost.run(() => gatewayKernel.deactivate()),
    rollbackDeactivation: () => sdkResourceHost.run(() => gatewayKernel.rollbackDeactivation()),
    waitForDeactivatedRuns: () => gatewayKernel.waitForDeactivatedRuns(),
    close: (optsLocal) => {
      if (!closePromise) {
        closePromise = sdkResourceHost
          .run(async () => {
            const prelude = beginClosePrelude(optsLocal);
            releasePostReadyWork();
            await prelude;
            const close = await prepareClose(optsLocal);
            await runGatewayCloseSteps({
              owner: gatewayKernel,
              close,
              disposeTerminalSessions: () => terminalSessions.disposeAll(),
              runStopHooks: async () => {
                await shutdownRuntime.runGlobalGatewayStopSafely({
                  registry: gatewayKernel.pluginRuntime.registry,
                  event: { reason: optsLocal?.reason ?? "gateway stopping" },
                  ctx: { port },
                  onError: (error) =>
                    log.warn(`gateway_stop hook failed: ${formatErrorMessage(error)}`),
                });
              },
              onError: (message) => log.error(message),
            });
          })
          .catch((error: unknown) => {
            if (hasRetainedPluginRuntimeCloseError(error)) {
              closePromise = undefined;
            }
            throw error;
          });
      }
      return closePromise;
    },
  };
}

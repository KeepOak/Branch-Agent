import { resolveEmbeddedSessionLane } from "../agents/embedded-agent-runner/lanes.js";
import { beginRetryWaitHandoff } from "../agents/embedded-agent-runner/retry-handoff.js";
import { listLoadedChannelPluginsForRegistry } from "../channels/plugins/registry-loaded.js";
import { getRuntimeConfig } from "../config/io.js";
import { startCronMaintenance } from "../cron/maintenance.js";
import {
  beginCronReceiptAuthorityClose,
  drainCronReceiptAuthority,
  releaseCronReceiptAuthorityForHandoff,
  resumeCronReceiptAuthorityHostAfterFailedHandoff,
} from "../cron/store/receipt-authority-owner.js";
import {
  getActiveGatewayRootWorkCount,
  isGatewayRestartDraining,
  tryBeginGatewaySuspendAdmission,
} from "../process/gateway-work-admission.js";
import {
  holdSessionHandoffLeases,
  isSessionLaneBusy,
  listBusySessionLanes,
} from "../process/session-handoff-lease-holder.js";
import type { GatewayCronState } from "./server-cron.js";
import {
  HANDOFF_DEACTIVATION_BASE_MS,
  HANDOFF_RESTORE_MS,
  HANDOFF_SETTLE_WINDOW_MS,
  isGatewayHandoffDeadlineError,
  raceHandoffDeadline,
  settlesWithin,
} from "./server-handoff-deadline.js";
import { GatewayHandoffFatalError } from "./server-handoff-error.js";
import type { prepareGatewayKernelState } from "./server-runtime-state-prepare.js";
import type { GatewayShutdownRuntime } from "./server-shutdown.runtime.js";

/** Owns deactivation, retained session leases, and quiet-run retirement as one transaction. */
export function createGatewayRunHandoff(params: {
  runtime: Awaited<ReturnType<typeof prepareGatewayKernelState>>;
  shutdownRuntime: GatewayShutdownRuntime;
  getCron: () => GatewayCronState["cron"];
}) {
  const { runtime, shutdownRuntime } = params;
  const { channelManager, chatAbortControllers, pluginRuntime } = runtime;
  const { startChannels, stopChannel } = channelManager;
  let deactivation: Promise<void> | undefined;
  let handoffAdmission: ReturnType<typeof tryBeginGatewaySuspendAdmission>;
  let handoffLeases: ReturnType<typeof holdSessionHandoffLeases> | undefined;
  let retryWaitHandoff: ReturnType<typeof beginRetryWaitHandoff> | undefined;
  const restoreHandoffProducers = async () => {
    await resumeCronReceiptAuthorityHostAfterFailedHandoff();
    await params.getCron().start();
    startCronMaintenance(runtime.scheduler);
    await startChannels();
  };
  /**
   * Steps this engine down by `deadline` (#481). A step that overruns aborts the handoff instead of killing the
   * engine: the late step settles, the producers come back and this engine keeps serving; the update retries later.
   */
  const deactivate = (
    deadline = Date.now() + HANDOFF_DEACTIVATION_BASE_MS,
    budgetMs = Math.max(0, deadline - Date.now()),
  ) => {
    const beforeHandoffDeadline = <T>(work: Promise<T>, step: string, until = deadline) =>
      raceHandoffDeadline(work, until, budgetMs, step);
    return (deactivation ??= (async () => {
      // Close new roots, while admitted runs retain their dispatch context and
      // may start required follow-up work through their existing root custody.
      handoffAdmission = tryBeginGatewaySuspendAdmission(() => {});
      if (!handoffAdmission) {
        throw new Error("Gateway handoff could not fence new work");
      }
      retryWaitHandoff = beginRetryWaitHandoff(async (wait) => {
        const result = await shutdownRuntime.markRestartAbortedMainSessions({
          resolveGatewayContext: runtime.resolvePluginGatewayContext,
          cfg: getRuntimeConfig(),
          activeRuns: [wait],
          isActiveRun: () => wait.isCurrent(),
          onlyActiveRuns: true,
          retryAtMs: wait.deadlineAtMs,
          reason: "desktop step-boundary handoff",
        });
        if (result.marked === 0 && wait.isCurrent()) {
          throw new Error("Gateway could not persist the waiting run for handoff");
        }
      });
      await beforeHandoffDeadline(retryWaitHandoff.ready, "the waiting-run handoff");
      const busyLanes = () =>
        new Set(
          Array.from(chatAbortControllers.values(), (entry) =>
            resolveEmbeddedSessionLane(entry.sessionKey),
          ),
        );
      handoffLeases = holdSessionHandoffLeases({
        lanes: [...new Set([...listBusySessionLanes(), ...busyLanes()])],
        isBusy: (lane) => isSessionLaneBusy(lane) || busyLanes().has(lane),
        hasPendingWork: () => getActiveGatewayRootWorkCount() > 0,
        leaseNewLanes: true,
      });
      beginCronReceiptAuthorityClose();
      const stoppedChannels = await beforeHandoffDeadline(
        Promise.allSettled(
          listLoadedChannelPluginsForRegistry(pluginRuntime.registry).map((plugin) =>
            stopChannel(plugin.id),
          ),
        ),
        "channel stop",
      );
      const failedChannel = stoppedChannels.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failedChannel) {
        throw failedChannel.reason;
      }
      const cron = params.getCron();
      await beforeHandoffDeadline(
        cron.stopAndDrainForHandoff
          ? cron.stopAndDrainForHandoff()
          : cron.stopAndDrain
            ? cron.stopAndDrain()
            : Promise.resolve(cron.stop()),
        "cron drain",
      );
      await beforeHandoffDeadline(shutdownRuntime.stopCronMaintenance(), "cron maintenance stop");
      await beforeHandoffDeadline(drainCronReceiptAuthority(), "cron receipt drain");
      await beforeHandoffDeadline(releaseCronReceiptAuthorityForHandoff(), "cron receipt release");
      handoffLeases.seal();
      if (!handoffAdmission.commit()) {
        throw new Error("Gateway handoff admission was invalidated before state release");
      }
    })().catch(async (error: unknown) => {
      retryWaitHandoff?.stop();
      retryWaitHandoff = undefined;
      if (error instanceof GatewayHandoffFatalError) {
        throw error;
      }
      if (isGatewayHandoffDeadlineError(error)) {
        // The late step is still this engine's own work: wait for it to finish before restoring, so the restore
        // never races it. Only a step that never settles keeps admission fenced for the run loop to stop.
        if (!(await settlesWithin(error.settled, HANDOFF_SETTLE_WINDOW_MS))) {
          throw new GatewayHandoffFatalError(`${error.message}, but its step never settled`, {
            cause: error,
          });
        }
      }
      handoffLeases?.releaseAll();
      if (isGatewayRestartDraining()) {
        handoffAdmission = null;
        handoffLeases = undefined;
        deactivation = undefined;
        throw error;
      }
      let restored = false;
      try {
        // This engine still owns state on a failed handoff. Restore every
        // producer before reopening admission to new work.
        // The restore gets a fresh budget: the step-down deadline may already be spent.
        await beforeHandoffDeadline(
          restoreHandoffProducers(),
          "producer restore",
          Date.now() + HANDOFF_RESTORE_MS,
        );
        restored = true;
      } catch (restoreError) {
        if (restoreError instanceof GatewayHandoffFatalError) {
          throw restoreError;
        }
        throw new GatewayHandoffFatalError("Gateway handoff restoration failed", {
          cause: new AggregateError([error, restoreError]),
        });
      } finally {
        if (restored) {
          handoffAdmission?.release();
          handoffAdmission?.rollback();
        }
        handoffAdmission = null;
        handoffLeases = undefined;
        deactivation = undefined;
      }
      throw error;
    }));
  };
  const rollbackDeactivation = async () => {
    await deactivation;
    retryWaitHandoff?.stop();
    retryWaitHandoff = undefined;
    handoffLeases?.releaseAll();
    // Rollback is followed by a one-way restart fence in the run loop. Do not
    // briefly admit fresh work against the lock already given to a successor.
    handoffAdmission = null;
    handoffLeases = undefined;
    deactivation = undefined;
  };
  const restoreFailedStateRelease = async () => {
    await deactivation;
    retryWaitHandoff?.stop();
    retryWaitHandoff = undefined;
    handoffLeases?.releaseAll();
    let restored = false;
    try {
      await restoreHandoffProducers();
      restored = true;
    } catch (error) {
      throw new GatewayHandoffFatalError("Gateway handoff restoration failed", { cause: error });
    } finally {
      if (restored) {
        handoffAdmission?.release();
        handoffAdmission?.rollback();
      }
      handoffAdmission = null;
      handoffLeases = undefined;
      deactivation = undefined;
    }
  };
  const waitForDeactivatedRuns = async () => {
    await deactivation;
    if (!handoffLeases) {
      return { deadlineElapsed: false, expiresAt: undefined };
    }
    const leases = handoffLeases;
    const deadlineElapsed = await Promise.race([
      leases.released.then(() => false),
      leases.deadline,
    ]);
    // Read after the wait: a kept run's lease is renewed while it works (Private #1038).
    return { deadlineElapsed, expiresAt: leases.expiresAt };
  };
  return {
    deactivate,
    commitStateRelease: () => {
      // Preparing producers is reversible while this kernel still owns state.
      // Retire quiet runs only after the state lease has actually transferred.
      retryWaitHandoff?.commit();
    },
    restoreFailedStateRelease,
    rollbackDeactivation,
    waitForDeactivatedRuns,
    release() {
      handoffLeases?.releaseAll();
      handoffLeases = undefined;
      retryWaitHandoff?.stop();
      retryWaitHandoff = undefined;
    },
  };
}

import { resolveEmbeddedSessionLane } from "../agents/embedded-agent-runner/lanes.js";
import { beginRetryWaitHandoff } from "../agents/embedded-agent-runner/retry-handoff.js";
import { listLoadedChannelPluginsForRegistry } from "../channels/plugins/registry-loaded.js";
import { getRuntimeConfig } from "../config/io.js";
import { WRITER_QUEUES } from "../config/sessions/store-writer-state.js";
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
import { SQLITE_SESSION_WRITER_QUEUES } from "../state/branch-agent-write-admission.js";
import type { GatewayCronState } from "./server-cron.js";
import {
  type GatewayHandoffDeadline,
  HANDOFF_RESTORE_BUDGET_MS,
  resolveGatewayHandoffDeadline,
  runBeforeHandoffDeadline as beforeHandoffDeadline,
  runBeforeHardHandoffDeadline,
} from "./server-handoff-deadline.js";
import { GatewayHandoffFatalError } from "./server-handoff-error.js";
import type { prepareGatewayKernelState } from "./server-runtime-state-prepare.js";
import type { GatewayShutdownRuntime } from "./server-shutdown.runtime.js";

function countQueuedSessionWrites(): number {
  let queued = 0;
  for (const queues of [WRITER_QUEUES, SQLITE_SESSION_WRITER_QUEUES]) {
    for (const queue of queues.values()) {
      queued += queue.pending.length;
    }
  }
  return queued;
}

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
  /** Sizes the step-down budget from the work this engine must park right now. */
  const resolveDeactivationDeadline = () =>
    resolveGatewayHandoffDeadline({
      activeRuns: Math.max(chatAbortControllers.size, getActiveGatewayRootWorkCount()),
      queuedWrites: countQueuedSessionWrites(),
    });
  const deactivate = (deadline: GatewayHandoffDeadline = resolveDeactivationDeadline()) =>
    (deactivation ??= (async () => {
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
      await beforeHandoffDeadline(retryWaitHandoff.ready, deadline);
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
        deadline,
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
        deadline,
      );
      await beforeHandoffDeadline(shutdownRuntime.stopCronMaintenance(), deadline);
      await beforeHandoffDeadline(drainCronReceiptAuthority(), deadline);
      await beforeHandoffDeadline(releaseCronReceiptAuthorityForHandoff(), deadline);
      handoffLeases.seal();
      if (!handoffAdmission.commit()) {
        throw new Error("Gateway handoff admission was invalidated before state release");
      }
    })().catch(async (error: unknown) => {
      retryWaitHandoff?.stop();
      retryWaitHandoff = undefined;
      if (error instanceof GatewayHandoffFatalError) {
        // A step that overran and never settled may still settle. Keep admission
        // and leases fenced; the run loop must stop this owner instead of racing
        // a rollback. A step that overran but settled is a GatewayHandoffDeadlineError
        // and takes the restore path below, so this engine keeps serving.
        throw error;
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
        // An overrun step already used the step-down budget: restoring gets its own.
        await runBeforeHardHandoffDeadline(
          restoreHandoffProducers(),
          Math.max(deadline.deadline, Date.now() + HANDOFF_RESTORE_BUDGET_MS),
          "Gateway handoff restoration did not finish in time",
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
    const expiresAt = handoffLeases.expiresAt;
    const deadlineElapsed = await Promise.race([
      handoffLeases.released.then(() => false),
      handoffLeases.deadline,
    ]);
    return { deadlineElapsed, expiresAt };
  };
  return {
    deactivate,
    resolveDeactivationDeadline,
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

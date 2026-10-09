import { resolveAgentMaxConcurrent } from "../../config/agent-limits.js";
import type { BranchConfig } from "../../config/types.branch.js";
import type { GatewayRecoveryRuntime } from "../../gateway/server-instance-runtime.types.js";
import { waitForAbortSignal } from "../../infra/abort-signal.js";
import {
  getAgentEventLifecycleGeneration,
  isAgentEventLifecycleGenerationCurrent,
} from "../../infra/agent-events.js";
import { sleepWithAbort } from "../../infra/backoff.js";
import { runWithGatewayIndependentRootWorkAdmission } from "../../process/gateway-work-admission.js";
import { resolveGlobalSingleton } from "../../shared/global-singleton.js";
import { runWithMainSessionRecoveryAdmission } from "./main-session-recovery-admission.js";
import { createMainSessionRecoveryCapacity } from "./main-session-recovery-capacity.js";
import { getMainSessionRecoveryRetryCount } from "./main-session-recovery-state.js";
import type { MainSessionRecoveryStoreTarget } from "./main-session-recovery-store.js";
import { restartRecoveryStoreTargetKey } from "./main-session-restart-recovery-diagnostics.js";
import { markStartupOrphanedMainSessionsForRecovery } from "./main-session-restart-recovery-marking.js";
import {
  DEFAULT_RECOVERY_DELAY_MS,
  type ExhaustedRestartRecoveryTarget,
  type ExpectedRestartRecoveryTarget,
  mainSessionRecoveryLog,
  MAX_RECOVERY_RETRIES,
  RETRY_BACKOFF_MULTIPLIER,
  discoverRestartRecoveryStoreTargets,
  hasPendingRestartRecoveryAdmission,
} from "./main-session-restart-recovery-shared.js";
import {
  loadExpectedRestartRecoveryTarget,
  recoverStore,
} from "./main-session-restart-recovery-store.js";

type RecoveryCounts = {
  started: number;
  settled: number;
  failed: number;
  skipped: number;
  retryAtMs?: number;
};
const PENDING_ADMISSION_POLL_MS = 1_000;
const retryWaitObservers = resolveGlobalSingleton(
  Symbol.for("branch.restartRecoveryRetryWaitObservers"),
  () => new Set<(deadlineAtMs: number) => void>(),
);

/** Resolves true once none of these agents waits for startup database admission. */
async function waitForPendingAdmissions(params: {
  agentIds: readonly string[];
  stateDir?: string;
  signal: AbortSignal;
  shouldContinue: () => boolean;
  deadlineAtMs?: number;
}): Promise<boolean> {
  try {
    while (
      params.shouldContinue() &&
      hasPendingRestartRecoveryAdmission(params.agentIds, params.stateDir) &&
      (params.deadlineAtMs === undefined || Date.now() < params.deadlineAtMs)
    ) {
      await sleepWithAbort(
        Math.min(
          PENDING_ADMISSION_POLL_MS,
          Math.max(0, (params.deadlineAtMs ?? Infinity) - Date.now()),
        ),
        params.signal,
        { ref: false },
      );
    }
  } catch (error) {
    if (params.shouldContinue()) {
      throw error;
    }
  }
  return params.shouldContinue();
}

async function runRecoveryRetries(params: {
  initialDelayMs: number;
  maxRetries: number;
  retryDelayMs?: number;
  shouldContinue: () => boolean;
  signal?: AbortSignal;
  attempt: (finalAttempt: boolean) => Promise<boolean>;
  onError: (error: unknown, finalAttempt: boolean) => void | Promise<void>;
}): Promise<void> {
  let delayMs = params.initialDelayMs;
  for (let attempt = 1; attempt <= params.maxRetries && params.shouldContinue(); attempt += 1) {
    const finalAttempt = attempt === params.maxRetries;
    try {
      if (delayMs > 0) {
        await sleepWithAbort(delayMs, params.signal, { ref: false });
      }
      if (!params.shouldContinue() || (await params.attempt(finalAttempt))) {
        return;
      }
    } catch (error) {
      if (!params.shouldContinue()) {
        return;
      }
      await params.onError(error, finalAttempt);
      if (finalAttempt) {
        return;
      }
    }
    delayMs =
      delayMs > 0
        ? delayMs * RETRY_BACKOFF_MULTIPLIER
        : (params.retryDelayMs ?? DEFAULT_RECOVERY_DELAY_MS);
  }
}

export async function recoverRestartAbortedMainSessions(params: {
  cfg?: BranchConfig;
  onExhaustedTarget?: (target: ExhaustedRestartRecoveryTarget) => void;
  stateDir?: string;
  handledSessionKeys?: Set<string>;
  activeSessionIds?: Iterable<string>;
  activeSessionKeys?: Iterable<string>;
  excludedStoreTargets?: ReadonlySet<string>;
  lifecycleGeneration?: string;
  shouldContinue?: () => boolean;
  onPendingAdmission?: (agentId: string) => void;
  gatewayRuntime: GatewayRecoveryRuntime;
  recoveryCapacity?: ReturnType<typeof createMainSessionRecoveryCapacity>;
  terminalOnFailure?: boolean;
}): Promise<RecoveryCounts> {
  const result: RecoveryCounts = { started: 0, settled: 0, failed: 0, skipped: 0 };
  const handledSessionKeys = params.handledSessionKeys ?? new Set<string>();

  const targets = await discoverRestartRecoveryStoreTargets({
    ...params,
    statuses: ["running"],
  });
  const storeResults = await Promise.all(
    targets.map(async (target) => {
      if (
        params.shouldContinue?.() === false ||
        params.excludedStoreTargets?.has(restartRecoveryStoreTargetKey(target))
      ) {
        return { started: 0, settled: 0, failed: 0, skipped: 0 };
      }
      return await recoverStore({
        ...params,
        storePath: target.storePath,
        storeAgentId: target.agentId,
        handledSessionKeys,
        recoveryCapacity: params.recoveryCapacity,
        terminalOnFailure: params.terminalOnFailure,
      });
    }),
  );
  for (const storeResult of storeResults) {
    result.started += storeResult.started;
    result.settled += storeResult.settled;
    result.failed += storeResult.failed;
    result.skipped += storeResult.skipped;
    if ("retryAtMs" in storeResult && typeof storeResult.retryAtMs === "number") {
      result.retryAtMs = Math.min(result.retryAtMs ?? Infinity, storeResult.retryAtMs);
    }
  }

  if (result.started > 0 || result.settled > 0 || result.failed > 0) {
    mainSessionRecoveryLog.info(
      `main-session restart recovery startup complete: started=${result.started} settled=${result.settled} failed=${result.failed} skipped=${result.skipped}`,
    );
  }
  if (result.retryAtMs !== undefined) {
    for (const observe of retryWaitObservers) {
      observe(result.retryAtMs);
    }
  }
  return result;
}

/** Retries one exact durable Control UI row from its owning per-agent SQLite store. */
export async function retryRestartAbortedMainSessionRecovery(
  params: MainSessionRecoveryStoreTarget & {
    canonicalSessionKey?: string;
    cfg?: BranchConfig;
    expectedRecoveryRunId?: string;
    expectedRecoverySourceRunId?: string;
    expectedSessionId: string;
    stateDir?: string;
    gatewayRuntime: GatewayRecoveryRuntime;
  },
): Promise<RecoveryCounts> {
  return await recoverExpectedRestartRecovery({
    ...params,
    expectedTarget: {
      agentId: params.agentId,
      canonicalSessionKey: params.canonicalSessionKey,
      sessionId: params.expectedSessionId,
      sessionKey: params.sessionKey,
      claim:
        params.expectedRecoveryRunId && params.expectedRecoverySourceRunId
          ? { runId: params.expectedRecoveryRunId, sourceRunId: params.expectedRecoverySourceRunId }
          : undefined,
    },
  });
}

async function recoverExpectedRestartRecovery(
  params: MainSessionRecoveryStoreTarget & {
    cfg?: BranchConfig;
    expectedTarget: ExpectedRestartRecoveryTarget;
    lifecycleGeneration?: string;
    observationOnly?: boolean;
    shouldContinue?: () => boolean;
    stateDir?: string;
    gatewayRuntime: GatewayRecoveryRuntime;
  },
): Promise<RecoveryCounts> {
  const expected = params.expectedTarget;
  const loadExpected = () =>
    loadExpectedRestartRecoveryTarget({ expected, storePath: params.storePath });
  if (!loadExpected()) {
    return { started: 0, settled: 0, failed: 0, skipped: 0 };
  }
  return (
    (await runWithMainSessionRecoveryAdmission({
      ...params,
      canonicalSessionKey: expected.canonicalSessionKey,
      sessionId: expected.sessionId,
      isCurrent: () => Boolean(loadExpected()),
      run: (recoveryAdmission) =>
        recoverStore({
          ...params,
          shouldContinue: recoveryAdmission.shouldContinue,
          handledSessionKeys: new Set<string>(),
          recoveryAdmission,
        }),
    })) ?? { started: 0, settled: 0, failed: 0, skipped: 1 }
  );
}

export function scheduleRestartAbortedMainSessionRecoveryAfterOwnerRelease(
  params: MainSessionRecoveryStoreTarget & {
    delayMs?: number;
    getConfig: () => BranchConfig;
    getGatewayRuntime: () => GatewayRecoveryRuntime | undefined;
    maxRetries?: number;
    expectedSessionId: string;
    stateDir?: string;
  },
): void {
  const lifecycleGeneration = getAgentEventLifecycleGeneration();
  const shouldContinue = () => isAgentEventLifecycleGenerationCurrent(lifecycleGeneration);
  const recover = () =>
    runWithGatewayIndependentRootWorkAdmission(async () => {
      const gatewayRuntime = params.getGatewayRuntime();
      if (!gatewayRuntime) {
        throw new Error("Gateway recovery runtime is unavailable");
      }
      return await retryRestartAbortedMainSessionRecovery({
        ...params,
        cfg: params.getConfig(),
        gatewayRuntime,
      });
    }, "main-session:restart-recovery");
  void runRecoveryRetries({
    initialDelayMs: 0,
    maxRetries: params.maxRetries ?? MAX_RECOVERY_RETRIES,
    retryDelayMs: params.delayMs ?? DEFAULT_RECOVERY_DELAY_MS,
    shouldContinue,
    attempt: async (finalAttempt) => {
      const waiting = loadExpectedRestartRecoveryTarget({
        expected: {
          agentId: params.agentId,
          sessionId: params.expectedSessionId,
          sessionKey: params.sessionKey,
        },
        storePath: params.storePath,
      });
      if (waiting?.restartRecoveryRetryAtMs && waiting.restartRecoveryRetryAtMs > Date.now()) {
        await sleepWithAbort(waiting.restartRecoveryRetryAtMs - Date.now(), undefined, {
          ref: false,
        });
      }
      if (!shouldContinue()) {
        return true;
      }
      const result = await recover();
      const stillPending = loadExpectedRestartRecoveryTarget({
        expected: {
          agentId: params.agentId,
          sessionId: params.expectedSessionId,
          sessionKey: params.sessionKey,
        },
        storePath: params.storePath,
      });
      if (result.failed === 0 && (result.started > 0 || result.settled > 0 || !stillPending)) {
        return true;
      }
      if (
        finalAttempt &&
        getMainSessionRecoveryRetryCount(stillPending?.mainRestartRecovery) ===
          MAX_RECOVERY_RETRIES &&
        !stillPending?.mainRestartRecovery?.reservation
      ) {
        // The last ambiguous dispatch consumed the final durable charge. One
        // exact observation tombstones exhaustion without dispatching again.
        await recover();
      }
      return false;
    },
    onError: (error, finalAttempt) => {
      if (finalAttempt) {
        mainSessionRecoveryLog.warn(`main-session owner-release recovery failed: ${String(error)}`);
      }
    },
  });
}

export function scheduleRestartAbortedMainSessionRecovery(params: {
  delayMs?: number;
  getConfig: () => BranchConfig;
  maxRetries?: number;
  shouldContinue?: () => boolean;
  stateDir?: string;
  startupCheckedStorePaths?: Set<string>;
  waitForStart?: () => Promise<void>;
  gatewayRuntime: GatewayRecoveryRuntime;
}): { stop: () => Promise<void> } {
  const handledSessionKeys = new Set<string>();
  const lifecycleGeneration = getAgentEventLifecycleGeneration();
  const abortController = new AbortController();
  const shouldContinue = () =>
    !abortController.signal.aborted &&
    params.shouldContinue?.() !== false &&
    isAgentEventLifecycleGenerationCurrent(lifecycleGeneration);
  const startupRecoveryCutoffMs = Date.now();
  const recoveryCapacity = createMainSessionRecoveryCapacity({
    limit: resolveAgentMaxConcurrent(params.getConfig()),
  });
  const startupCheckedStorePaths = params.startupCheckedStorePaths ?? new Set<string>();
  // Agents still preparing their databases at startup are skipped, not checked.
  const pendingAdmissionAgentIds = new Set<string>();
  const onPendingAdmission = (agentId: string) => pendingAdmissionAgentIds.add(agentId);
  const runRecoveryAttempt = async (
    exhaustedTargets: Map<string, ExhaustedRestartRecoveryTarget>,
    finalAttempt: boolean,
  ): Promise<RecoveryCounts> => {
    return await runWithGatewayIndependentRootWorkAdmission(
      async () => {
        const cfg = params.getConfig();
        const marking = await markStartupOrphanedMainSessionsForRecovery({
          cfg,
          stateDir: params.stateDir,
          startupCheckedStorePaths,
          updatedBeforeMs: startupRecoveryCutoffMs,
          onPendingAdmission,
        });
        const result = await recoverRestartAbortedMainSessions({
          cfg,
          onExhaustedTarget: (target) => {
            exhaustedTargets.set(
              JSON.stringify([
                target.storePath,
                target.agentId,
                target.canonicalSessionKey ?? target.sessionKey,
              ]),
              target,
            );
          },
          stateDir: params.stateDir,
          handledSessionKeys,
          excludedStoreTargets: new Set(marking.failedTargets?.map(restartRecoveryStoreTargetKey)),
          lifecycleGeneration,
          shouldContinue,
          onPendingAdmission,
          gatewayRuntime: params.gatewayRuntime,
          recoveryCapacity,
          terminalOnFailure: finalAttempt,
        });
        result.failed += marking.failedTargets?.length ?? 0;
        return result;
      },
      "main-session:startup-recovery",
      abortController.signal,
    );
  };
  const reconcileExhaustedTargets = async (targets: Iterable<ExhaustedRestartRecoveryTarget>) => {
    const outcomes = await Promise.allSettled(
      [...targets].map((target) =>
        runWithGatewayIndependentRootWorkAdmission(
          async () =>
            recoverExpectedRestartRecovery({
              ...target,
              cfg: params.getConfig(),
              expectedTarget: target,
              lifecycleGeneration,
              observationOnly: true,
              shouldContinue,
              stateDir: params.stateDir,
              gatewayRuntime: params.gatewayRuntime,
            }),
          "main-session:target-recovery",
          abortController.signal,
        ),
      ),
    );
    for (const outcome of outcomes) {
      if (
        outcome.status === "rejected" &&
        !(
          abortController.signal.aborted &&
          (outcome.reason === abortController.signal.reason ||
            (outcome.reason instanceof Error &&
              outcome.reason.cause === abortController.signal.reason))
        )
      ) {
        mainSessionRecoveryLog.warn(
          `main-session exhaustion reconciliation failed: ${String(outcome.reason)}`,
        );
      }
    }
  };
  let exhaustedTargets = new Map<string, ExhaustedRestartRecoveryTarget>();
  let retryAtMs: number | undefined;
  let wake: (() => void) | undefined;
  const observeRetryWait = (deadlineAtMs: number) => {
    if (!shouldContinue()) {
      return;
    }
    retryAtMs = Math.min(retryAtMs ?? Infinity, deadlineAtMs);
    wake?.();
  };
  retryWaitObservers.add(observeRetryWait);
  const runRecoveryWave = async (initialDelayMs: number): Promise<void> => {
    await runRecoveryRetries({
      initialDelayMs,
      maxRetries: Math.max(1, params.maxRetries ?? MAX_RECOVERY_RETRIES),
      shouldContinue,
      signal: abortController.signal,
      attempt: async (finalAttempt) => {
        exhaustedTargets = new Map();
        // The scan replaces the previous timer, but notifications received
        // while it is in flight must survive its (possibly older) result.
        retryAtMs = undefined;
        const result = await runRecoveryAttempt(exhaustedTargets, finalAttempt);
        if (result.retryAtMs !== undefined) {
          retryAtMs = Math.min(retryAtMs ?? Infinity, result.retryAtMs);
        }
        if (result.failed === 0) {
          return true;
        }
        if (finalAttempt && exhaustedTargets.size > 0) {
          await reconcileExhaustedTargets(exhaustedTargets.values());
        }
        return false;
      },
      onError: async (err, finalAttempt) => {
        if (finalAttempt) {
          mainSessionRecoveryLog.warn(`main-session restart recovery gave up: ${String(err)}`);
          await reconcileExhaustedTargets(exhaustedTargets.values());
        } else {
          mainSessionRecoveryLog.warn(`main-session restart recovery failed: ${String(err)}`);
        }
      },
    });
  };
  const run = Promise.resolve().then(async () => {
    if (params.waitForStart) {
      await Promise.race([params.waitForStart(), waitForAbortSignal(abortController.signal)]);
    }
    await runRecoveryWave(params.delayMs ?? DEFAULT_RECOVERY_DELAY_MS);
    // Waiting is outside root admission, so neither a distant retry nor another update waits for it.
    // Rescan each agent once its startup admission settles; otherwise its
    // interrupted runs stay "running" with nothing left to resume them.
    while (shouldContinue()) {
      // The predecessor can reach a retry after startup recovery has finished.
      // Lease-release recovery publishes its deadline here without holding a root.
      const changed = new Promise<void>((resolve) => {
        wake = resolve;
      });
      const waitController = new AbortController();
      const waitSignal = AbortSignal.any([abortController.signal, waitController.signal]);
      let waiting: Promise<unknown>;
      if (pendingAdmissionAgentIds.size > 0) {
        waiting = waitForPendingAdmissions({
          agentIds: [...pendingAdmissionAgentIds],
          stateDir: params.stateDir,
          signal: waitSignal,
          shouldContinue: () => shouldContinue() && !waitSignal.aborted,
          deadlineAtMs: retryAtMs,
        });
      } else if (retryAtMs !== undefined) {
        waiting = sleepWithAbort(Math.max(0, retryAtMs - Date.now()), waitSignal, { ref: false });
      } else {
        waiting = changed;
      }
      try {
        await Promise.race([waiting, changed]);
      } catch (error) {
        if (shouldContinue()) {
          throw error;
        }
        return;
      } finally {
        wake = undefined;
        waitController.abort();
        await waiting.catch(() => {});
      }
      if (!shouldContinue()) {
        return;
      }
      pendingAdmissionAgentIds.clear();
      await runRecoveryWave(0);
    }
  });
  return {
    stop: async () => {
      // Restart recovery belongs to its startup generation; stale timers must
      // never claim a session after that gateway begins draining.
      abortController.abort();
      retryWaitObservers.delete(observeRetryWait);
      wake?.();
      await run;
    },
  };
}

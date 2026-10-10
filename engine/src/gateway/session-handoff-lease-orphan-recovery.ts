// After a successor's startup orphan scan, a predecessor may still hold conversations
// under handoff leases. If that predecessor dies or its lease expires later, those
// conversations would stay "running" until the next restart. This hook recovers them
// with the same owner checks as startup, and leaves still-held lanes alone.
import { markOrphanedMainSessionForRecovery } from "../agents/main-session-recovery/main-session-restart-recovery-marking.js";
import {
  discoverRestartRecoveryStoreTargets,
  mainSessionRecoveryLog,
} from "../agents/main-session-recovery/main-session-restart-recovery-shared.js";
import { loadSessionEntry } from "../config/sessions/session-accessor.js";
import type { BranchConfig } from "../config/types.branch.js";
import { SESSION_LANE_PREFIX } from "../process/session-handoff-lease-files.js";
import { onSessionHandoffLaneReleased } from "../process/session-handoff-lease-gate.js";
import { isSubagentSessionKey, resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { runStartupSessionMigration } from "./server-startup-session-migration.js";

export type SessionHandoffLeaseOrphanRecovery = {
  stop: () => void;
};

type RecoveryLog = {
  info?: (message: string) => void;
  warn: (message: string) => void;
};

function sessionKeyFromLane(lane: string): string | undefined {
  if (!lane.startsWith(SESSION_LANE_PREFIX)) {
    return undefined;
  }
  return lane.slice(SESSION_LANE_PREFIX.length);
}

export async function recoverReleasedHandoffLeaseOrphans(params: {
  cfg?: BranchConfig;
  releasedLanes?: readonly string[];
  stateDir?: string;
  log?: RecoveryLog;
  shouldContinue?: () => boolean;
}): Promise<{ marked: number; skipped: number }> {
  if (params.shouldContinue?.() === false) {
    return { marked: 0, skipped: 0 };
  }
  const releasedKeys = [
    ...new Set(
      (params.releasedLanes ?? [])
        .map(sessionKeyFromLane)
        .filter((sessionKey): sessionKey is string => sessionKey !== undefined),
    ),
  ];
  if (releasedKeys.length === 0) {
    return { marked: 0, skipped: 0 };
  }
  const storeTargets = await discoverRestartRecoveryStoreTargets({
    cfg: params.cfg,
    stateDir: params.stateDir,
    shouldContinue: params.shouldContinue,
  });
  const result = { marked: 0, skipped: 0 };
  for (const sessionKey of releasedKeys) {
    if (params.shouldContinue?.() === false) {
      return result;
    }
    let agentId: string | undefined;
    try {
      agentId = resolveAgentIdFromSessionKey(sessionKey);
    } catch {
      agentId = undefined;
    }
    const candidates = agentId
      ? storeTargets.filter((target) => target.agentId === agentId)
      : storeTargets;
    const stores = candidates.length > 0 ? candidates : storeTargets;
    for (const store of stores) {
      const entry = loadSessionEntry({
        agentId: store.agentId,
        sessionKey,
        storePath: store.storePath,
      });
      if (!entry?.sessionId) {
        continue;
      }
      const storeResult = await markOrphanedMainSessionForRecovery({
        target: { ...store, sessionKey },
        expectedSessionId: entry.sessionId,
        expectedLifecycleRevision:
          typeof entry.lifecycleRevision === "string" ? entry.lifecycleRevision : undefined,
        cfg: params.cfg,
      });
      result.marked += storeResult.marked;
      result.skipped += storeResult.skipped;
    }
  }
  const releasedSubagent = releasedKeys.some((sessionKey) => isSubagentSessionKey(sessionKey));
  if (params.cfg && releasedSubagent) {
    try {
      await runStartupSessionMigration({
        cfg: params.cfg,
        sessionKeys: new Set(releasedKeys.filter((sessionKey) => isSubagentSessionKey(sessionKey))),
        log: {
          info: params.log?.info ?? (() => {}),
          warn: params.log?.warn ?? mainSessionRecoveryLog.warn,
        },
      });
    } catch (error) {
      params.log?.warn?.(`handoff lease subagent orphan reconcile failed: ${String(error)}`);
    }
  }
  if (result.marked > 0) {
    try {
      const { getGatewayRecoveryRuntime } = await import("./server-recovery-runtime-context.js");
      const gatewayRuntime = getGatewayRecoveryRuntime();
      if (gatewayRuntime && params.shouldContinue?.() !== false) {
        const { recoverRestartAbortedMainSessions } = await import(
          "../agents/main-session-recovery/main-session-restart-recovery.js"
        );
        await recoverRestartAbortedMainSessions({
          cfg: params.cfg,
          stateDir: params.stateDir,
          gatewayRuntime,
          shouldContinue: params.shouldContinue,
        });
      }
    } catch (error) {
      params.log?.warn?.(`handoff lease orphan resume failed: ${String(error)}`);
    }
  }
  return result;
}

/** Watches predecessor handoff leases and recovers a conversation once its holder is gone. */
export function startSessionHandoffLeaseOrphanRecovery(params: {
  getConfig?: () => BranchConfig;
  cfg?: BranchConfig;
  stateDir?: string;
  log?: RecoveryLog;
  shouldContinue?: () => boolean;
}): SessionHandoffLeaseOrphanRecovery {
  const log = params.log ?? {
    info: mainSessionRecoveryLog.info,
    warn: mainSessionRecoveryLog.warn,
  };
  let stopped = false;
  let pending = false;
  let inFlight: Promise<void> | undefined;
  const pendingLanes = new Set<string>();
  const shouldContinue = () => !stopped && params.shouldContinue?.() !== false;
  const flush = () => {
    if (stopped || inFlight) {
      pending = Boolean(inFlight);
      return;
    }
    pending = false;
    const releasedLanes = [...pendingLanes];
    pendingLanes.clear();
    inFlight = recoverReleasedHandoffLeaseOrphans({
      cfg: params.getConfig?.() ?? params.cfg,
      releasedLanes,
      stateDir: params.stateDir,
      log,
      shouldContinue,
    })
      .then((result) => {
        if (result.marked > 0) {
          log.info?.(
            `recovered ${result.marked} conversation(s) after a predecessor handoff lease ended`,
          );
        }
      })
      .catch((error: unknown) => {
        log.warn(`handoff lease orphan recovery failed: ${String(error)}`);
      })
      .finally(() => {
        inFlight = undefined;
        if (pending && shouldContinue()) {
          flush();
        }
      });
  };
  const unsubscribe = onSessionHandoffLaneReleased((lane) => {
    if (!shouldContinue()) {
      return;
    }
    pendingLanes.add(lane);
    flush();
  });
  return {
    stop: () => {
      stopped = true;
      unsubscribe();
    },
  };
}

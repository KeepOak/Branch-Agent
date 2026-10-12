import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveMemoryRingsPluginConfig } from "branch/plugin-sdk/memory-core-host-runtime-core";
import {
  MEMORY_RINGS_SYSTEM_EVENT_TEXT as RINGS_SYSTEM_EVENT_TEXT,
  resolveMemoryDeepRingsConfig,
  resolveMemoryRingsWorkspaces,
} from "branch/plugin-sdk/memory-core-host-status";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
  uniqueStrings,
} from "branch/plugin-sdk/string-coerce-runtime";
import { peekSystemEventEntries } from "branch/plugin-sdk/system-event-runtime";
import {
  type CronServiceLike,
  reconcileShortTermRingsCronJob,
  resolveCronServiceFromGatewayContext,
} from "./rings-cron.js";
import { appendFailedRingsEvent } from "./rings-events.js";
import type { NarrativePhaseData } from "./rings-narrative.js";
import {
  formatErrorMessage,
  formatRecallRepairDetails,
  includesSystemEventToken,
} from "./rings-shared.js";
import { resolveMemoryPromotionFileMaxChars } from "./memory-budget.js";
import type { PromotionRejectionCategory } from "./short-term-promotion-types.js";

const RUNTIME_CRON_RECONCILE_INTERVAL_MS = 60_000;
const HEARTBEAT_ISOLATED_SESSION_SUFFIX = ":heartbeat";

type Logger = Pick<BranchPluginApi["logger"], "info" | "warn" | "error">;

type ShortTermPromotionRingsConfig = ReturnType<typeof resolveMemoryDeepRingsConfig>;

function formatRepairSummary(repair: {
  rewroteStore: boolean;
  removedInvalidEntries: number;
  removedDanglingEntries?: number;
  removedOverflowEntries?: number;
  removedStaleLock: boolean;
}): string {
  const actions: string[] = [];
  if (repair.rewroteStore) {
    const details = formatRecallRepairDetails(repair);
    actions.push(`rewrote recall store${details ? ` (${details})` : ""}`);
  }
  if (repair.removedStaleLock) {
    actions.push("removed stale promotion lock");
  }
  return actions.join(", ");
}

function resolveRingsTriggerSessionKeys(sessionKey?: string): string[] {
  const normalized = normalizeOptionalString(sessionKey);
  if (!normalized) {
    return [];
  }

  const keys = [normalized];
  // Isolated heartbeat runs execute in a sibling `:heartbeat` session while cron
  // system events stay queued on the base main session.
  if (normalized.endsWith(HEARTBEAT_ISOLATED_SESSION_SUFFIX)) {
    const baseSessionKey = normalized.slice(0, -HEARTBEAT_ISOLATED_SESSION_SUFFIX.length).trim();
    if (baseSessionKey) {
      keys.push(baseSessionKey);
    }
  }

  return uniqueStrings(keys);
}

function hasPendingManagedRingsCronEvent(sessionKey?: string, agentId?: string): boolean {
  return resolveRingsTriggerSessionKeys(sessionKey).some((candidateSessionKey) =>
    peekSystemEventEntries(candidateSessionKey, agentId).some(
      (event) =>
        event.contextKey?.startsWith("cron:") === true &&
        normalizeOptionalString(event.text) === RINGS_SYSTEM_EVENT_TEXT,
    ),
  );
}

async function runShortTermRingsPromotion(params: {
  trigger: "heartbeat" | "cron";
  /** Agent whose heartbeat/cron turn triggered the sweep. */
  agentId?: string;
  workspaceDir?: string;
  cfg?: BranchConfig;
  config: ShortTermPromotionRingsConfig;
  logger: Logger;
  subagent?: BranchPluginApi["runtime"]["subagent"];
}): Promise<{ handled: true; reason: string } | undefined> {
  if (!params.config.enabled) {
    return { handled: true, reason: "memory-core: short-term rings disabled" };
  }

  const recencyHalfLifeDays = params.config.recencyHalfLifeDays;
  const fallbackWorkspaceDir = normalizeOptionalString(params.workspaceDir);
  // Each completion uses its workspace owner's model and credentials. The triggering
  // agent owns whatever the roster cannot attribute.
  const triggerAgentId = normalizeLowercaseStringOrEmpty(params.agentId);
  const seenWorkspaces = new Set<string>();
  const workspaces: Array<{ agentId?: string; agentIds: readonly string[]; workspaceDir: string }> =
    [];
  const addWorkspace = (
    workspaceDir: string,
    agentId: string,
    agentIds: readonly string[] = [agentId],
  ): void => {
    if (!workspaceDir || seenWorkspaces.has(workspaceDir)) {
      return;
    }
    seenWorkspaces.add(workspaceDir);
    workspaces.push({ ...(agentId ? { agentId } : {}), agentIds, workspaceDir });
  };
  // The triggering agent wins its own workspace; otherwise sort so a workspace shared by
  // several agents always resolves the same owner across sweeps.
  const resolveWorkspaceOwnerAgentId = (agentIds: readonly string[]): string => {
    if (triggerAgentId && agentIds.includes(triggerAgentId)) {
      return triggerAgentId;
    }
    return agentIds.toSorted()[0] ?? triggerAgentId;
  };
  if (params.cfg) {
    for (const entry of resolveMemoryRingsWorkspaces(params.cfg, {
      primaryWorkspaceDir: fallbackWorkspaceDir,
      // Attribute the hook's own workspace to the agent whose turn triggered the sweep;
      // the host falls back to the roster default agent when the turn has no id.
      ...(triggerAgentId ? { primaryAgentId: triggerAgentId } : {}),
    })) {
      addWorkspace(
        entry.workspaceDir,
        resolveWorkspaceOwnerAgentId(entry.agentIds),
        entry.agentIds,
      );
    }
  }
  if (workspaces.length === 0 && fallbackWorkspaceDir) {
    addWorkspace(fallbackWorkspaceDir, triggerAgentId);
  }
  if (workspaces.length === 0) {
    params.logger.warn(
      "memory-core: rings promotion skipped because no memory workspace is available.",
    );
    return { handled: true, reason: "memory-core: short-term rings missing workspace" };
  }
  if (params.config.limit === 0) {
    params.logger.info("memory-core: rings promotion skipped because limit=0.");
    return { handled: true, reason: "memory-core: short-term rings disabled by limit" };
  }

  if (params.config.verboseLogging) {
    params.logger.info(
      `memory-core: rings verbose enabled (cron=${params.config.cron}, limit=${params.config.limit}, minScore=${params.config.minScore.toFixed(3)}, minRecallCount=${params.config.minRecallCount}, minUniqueQueries=${params.config.minUniqueQueries}, recencyHalfLifeDays=${recencyHalfLifeDays}, maxAgeDays=${params.config.maxAgeDays ?? "none"}, workspaces=${workspaces.length}).`,
    );
  }

  let totalCandidates = 0;
  let totalApplied = 0;
  let failedWorkspaces = 0;
  let degradedNarratives = 0;
  let pendingNarratives = 0;
  const pluginConfig = params.cfg ? resolveMemoryRingsPluginConfig(params.cfg) : undefined;
  const detachNarratives = params.trigger === "cron";
  const [
    { writeDeepRingsReport },
    { appendFallbackNarrativeEntry, runDreamNarrative },
    { runRingsSweepPhases },
    {
      applyShortTermPromotions,
      repairShortTermPromotionArtifacts,
      rankShortTermPromotionCandidates,
    },
  ] = await Promise.all([
    import("./rings-markdown.js"),
    import("./rings-narrative.js"),
    import("./rings-phases.js"),
    import("./short-term-promotion.js"),
  ]);
  for (const { agentId, agentIds, workspaceDir } of workspaces) {
    const sweepNowMs = Date.now();
    try {
      const phaseResult = await runRingsSweepPhases({
        agentId,
        workspaceDir,
        pluginConfig,
        cfg: params.cfg,
        logger: params.logger,
        subagent: params.subagent,
        detachNarratives,
        nowMs: sweepNowMs,
      });
      degradedNarratives += phaseResult.degradedPhases;
      pendingNarratives += phaseResult.pendingNarratives;
    } catch (err) {
      failedWorkspaces += 1;
      params.logger.error(
        `memory-core: rings sweep failed for workspace ${workspaceDir}: ${formatErrorMessage(err)}`,
      );
      continue;
    }

    try {
      const reportLines: string[] = [];
      const repair = await repairShortTermPromotionArtifacts({ workspaceDir });
      if (repair.changed) {
        params.logger.info(
          `memory-core: normalized recall artifacts before rings (${formatRepairSummary(repair)}) [workspace=${workspaceDir}].`,
        );
        reportLines.push(`- Repaired recall artifacts: ${formatRepairSummary(repair)}.`);
      }
      const candidates = await rankShortTermPromotionCandidates({
        workspaceDir,
        limit: params.config.limit,
        minScore: params.config.minScore,
        minRecallCount: params.config.minRecallCount,
        minUniqueQueries: params.config.minUniqueQueries,
        recencyHalfLifeDays,
        maxAgeDays: params.config.maxAgeDays,
        nowMs: sweepNowMs,
      });
      totalCandidates += candidates.length;
      reportLines.push(`- Ranked ${candidates.length} candidate(s) for durable promotion.`);
      if (params.config.verboseLogging) {
        const candidateSummary =
          candidates.length > 0
            ? candidates
                .map(
                  (candidate) =>
                    `${candidate.path}:${candidate.startLine}-${candidate.endLine} score=${candidate.score.toFixed(3)} signals=${candidate.signalCount} recalls=${candidate.recallCount} queries=${candidate.uniqueQueries} components={freq=${candidate.components.frequency.toFixed(3)},rel=${candidate.components.relevance.toFixed(3)},div=${candidate.components.diversity.toFixed(3)},rec=${candidate.components.recency.toFixed(3)},cons=${candidate.components.consolidation.toFixed(3)},concept=${candidate.components.conceptual.toFixed(3)}}`,
                )
                .join(" | ")
            : "none";
        params.logger.info(
          `memory-core: rings candidate details [workspace=${workspaceDir}] ${candidateSummary}`,
        );
      }
      const applied = await applyShortTermPromotions({
        agentId,
        workspaceAgentIds: agentIds,
        workspaceDir,
        candidates,
        limit: params.config.limit,
        minScore: params.config.minScore,
        minRecallCount: params.config.minRecallCount,
        minUniqueQueries: params.config.minUniqueQueries,
        maxAgeDays: params.config.maxAgeDays,
        maxPromotedSnippetTokens: params.config.maxPromotedSnippetTokens,
        maxPriorEntryLossFraction: params.config.maxPriorEntryLossFraction,
        memoryFileMaxChars: resolveMemoryPromotionFileMaxChars({
          cfg: params.cfg,
          agentIds,
        }),
        consolidation: {
          ...(params.subagent ? { subagent: params.subagent } : {}),
          ...(params.config.execution?.model ? { model: params.config.execution.model } : {}),
          logger: params.logger,
        },
        timezone: params.config.timezone,
        nowMs: sweepNowMs,
      });
      totalApplied += applied.applied;
      reportLines.push(`- Promoted ${applied.applied} candidate(s) into MEMORY.md.`);
      if (applied.rejectedCandidates.length > 0) {
        const rejectionCounts = new Map<PromotionRejectionCategory, number>();
        for (const { category } of applied.rejectedCandidates) {
          rejectionCounts.set(category, (rejectionCounts.get(category) ?? 0) + 1);
        }
        const summary = [...rejectionCounts]
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([category, count]) => `${category}: ${count}`)
          .join(", ");
        reportLines.push(
          `- Not promoted: ${applied.rejectedCandidates.length} candidate(s) (${summary}).`,
        );
      }
      if (params.config.verboseLogging) {
        const appliedSummary =
          applied.appliedCandidates.length > 0
            ? applied.appliedCandidates
                .map(
                  (candidate) =>
                    `${candidate.path}:${candidate.startLine}-${candidate.endLine} score=${candidate.score.toFixed(3)} signals=${candidate.signalCount} recalls=${candidate.recallCount}`,
                )
                .join(" | ")
            : "none";
        params.logger.info(
          `memory-core: rings applied details [workspace=${workspaceDir}] ${appliedSummary}`,
        );
      }
      const hasReportableRejections = applied.rejectedCandidates.some(
        ({ category }) => category !== "memory budget",
      );
      const deepHasContent = repair.changed || applied.applied > 0 || hasReportableRejections;
      await writeDeepRingsReport({
        workspaceDir,
        bodyLines: reportLines,
        hasContent: deepHasContent,
        nowMs: sweepNowMs,
        timezone: params.config.timezone,
        storage: params.config.storage ?? { mode: "separate", separateReports: false },
      });
      if (applied.applied > 0) {
        const promotions = applied.appliedCandidates
          .map((candidate) => candidate.snippet)
          .filter(Boolean);
        const data: NarrativePhaseData = {
          phase: "deep",
          snippets: promotions,
          promotions,
          sourceEntryKeys: [...new Set(applied.appliedCandidates.map((c) => c.key))],
        };
        if (!params.subagent) {
          await appendFallbackNarrativeEntry({
            workspaceDir,
            data,
            nowMs: sweepNowMs,
            timezone: params.config.timezone,
            logger: params.logger,
            reason: "subagent runtime is unavailable",
          });
        } else {
          const narrativeOutcome = await runDreamNarrative({
            agentId,
            subagent: params.subagent,
            workspaceDir,
            data,
            nowMs: sweepNowMs,
            timezone: params.config.timezone,
            model: params.config.execution?.model,
            logger: params.logger,
            detached: detachNarratives,
          });
          if (narrativeOutcome.status === "degraded") {
            degradedNarratives += 1;
          } else if (narrativeOutcome.status === "pending") {
            pendingNarratives += 1;
          }
        }
      }
    } catch (err) {
      failedWorkspaces += 1;
      const error = formatErrorMessage(err);
      params.logger.error(
        `memory-core: rings promotion failed for workspace ${workspaceDir}: ${error}`,
      );
      await appendFailedRingsEvent({
        workspaceDir,
        phase: "deep",
        error,
        storageMode: params.config.storage?.mode ?? "separate",
        nowMs: sweepNowMs,
        logger: params.logger,
      });
    }
  }
  // A summary that reads identically whether the sweep worked or failed everywhere is how
  // a broken pipeline stays unnoticed; escalate when no workspace produced anything.
  const summary = `memory-core: rings promotion complete (workspaces=${workspaces.length}, candidates=${totalCandidates}, applied=${totalApplied}, failed=${failedWorkspaces}, degraded=${degradedNarratives}, narrativesPending=${pendingNarratives}).`;
  if (failedWorkspaces === workspaces.length || degradedNarratives > 0) {
    params.logger.warn(summary);
  } else {
    params.logger.info(summary);
  }

  return {
    handled: true,
    reason:
      degradedNarratives > 0
        ? "memory-core: short-term rings degraded"
        : "memory-core: short-term rings processed",
  };
}

export function registerShortTermPromotionRings(api: BranchPluginApi): void {
  let resolveServiceCron: (() => CronServiceLike | null) | null = null;
  let unavailableCronWarningEmitted = false;
  let startupRingsCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  const ringsTasks = new Set<Promise<unknown>>();
  let runtimeCronReconcileTimer: ReturnType<typeof setInterval> | null = null;
  let gatewayLifecycleGeneration = 0;
  let disposed = true;
  let serviceStartedAtMs: number | undefined;

  const resolveCurrentConfig = (): BranchConfig =>
    (api.runtime.config?.current?.() ?? api.config) as BranchConfig;

  const disposeRings = (): void => {
    disposed = true;
    gatewayLifecycleGeneration += 1;
    if (startupRingsCleanupTimer) {
      clearTimeout(startupRingsCleanupTimer);
      startupRingsCleanupTimer = null;
    }
    if (runtimeCronReconcileTimer) {
      clearInterval(runtimeCronReconcileTimer);
      runtimeCronReconcileTimer = null;
    }
    resolveServiceCron = null;
  };

  const reconcileManagedRingsCron = async (params: {
    reason: "startup" | "runtime";
    startupConfig?: BranchConfig;
  }): Promise<void> => {
    const startupCfg =
      params.reason === "startup" ? (params.startupConfig ?? api.config) : resolveCurrentConfig();
    const pluginConfig =
      params.reason === "startup"
        ? (resolveMemoryRingsPluginConfig(startupCfg) ??
          resolveMemoryRingsPluginConfig(api.config) ??
          api.pluginConfig)
        : resolveMemoryRingsPluginConfig(startupCfg);
    const config = resolveMemoryDeepRingsConfig({
      pluginConfig,
      cfg: startupCfg,
    });
    const cron = resolveServiceCron?.() ?? null;
    // Pausing automatic scheduling preserves jobs; explicitly disabling rings
    // still reconciles their removal, and startup artifact cleanup stays independent.
    if (config.enabled && cron?.isEnabled && !(await cron.isEnabled())) {
      return;
    }
    if (!cron && config.enabled && !unavailableCronWarningEmitted) {
      // A non-Gateway host may attach its scheduler later; report persistent
      // unavailability from the regular reconciliation interval.
      if (params.reason === "startup") {
        api.logger.debug?.(
          "memory-core: cron service not yet available at service start; deferring to runtime reconciliation.",
        );
      } else {
        api.logger.warn(
          "memory-core: managed rings cron could not be reconciled (cron service unavailable).",
        );
        unavailableCronWarningEmitted = true;
      }
    }
    if (cron) {
      unavailableCronWarningEmitted = false;
    }
    await reconcileShortTermRingsCronJob({
      cron,
      config,
      logger: api.logger,
    });
  };

  const startRuntimeCronReconcileTimer = (): void => {
    if (disposed || runtimeCronReconcileTimer) {
      return;
    }
    runtimeCronReconcileTimer = setInterval(() => {
      void trackRingsTask(reconcileManagedRingsCron({ reason: "runtime" })).catch(
        (err: unknown) => {
          api.logger.error(
            `memory-core: rings cron reconcile failed: ${formatErrorMessage(err)}`,
          );
        },
      );
    }, RUNTIME_CRON_RECONCILE_INTERVAL_MS);
    runtimeCronReconcileTimer.unref?.();
  };

  const trackRingsTask = <T>(task: Promise<T>): Promise<T> => {
    ringsTasks.add(task);
    void task.then(
      () => ringsTasks.delete(task),
      () => ringsTasks.delete(task),
    );
    return task;
  };

  const startRingsSessionCleanup = async (
    config: BranchConfig,
    generation: number,
    startupStartedAtMs: number,
  ): Promise<void> => {
    // Previous releases persisted narrative sessions. Reclaim those historical artifacts
    // at startup; new prompt-only completions create no sessions to scrub.
    const { RINGS_ORPHAN_MIN_AGE_MS, scrubRingsNarrativeArtifacts } =
      await import("./rings-session-cleanup.js");
    if (disposed || generation !== gatewayLifecycleGeneration) {
      return;
    }
    const scrubConfiguredAgents = async (
      currentConfig: BranchConfig,
      nowMs?: number,
    ): Promise<void> => {
      const agentIds = uniqueStrings(
        resolveMemoryRingsWorkspaces(currentConfig).flatMap(
          ({ agentIds: workspaceAgentIds }) => workspaceAgentIds,
        ),
      );
      for (const agentId of agentIds) {
        if (disposed || generation !== gatewayLifecycleGeneration) {
          return;
        }
        try {
          await scrubRingsNarrativeArtifacts({
            agentId,
            config: currentConfig,
            logger: api.logger,
            ...(nowMs === undefined ? {} : { nowMs }),
          });
        } catch (error) {
          api.logger.warn(
            `memory-core: rings startup cleanup failed for agent ${agentId}: ${formatErrorMessage(error)}`,
          );
        }
      }
    };

    // Cron reconciliation can itself stall; never classify sessions admitted after startup.
    await scrubConfiguredAgents(config, startupStartedAtMs);
    if (disposed || generation !== gatewayLifecycleGeneration) {
      return;
    }
    // Interrupted runs are initially indistinguishable from live runs; revisit once their
    // persisted activity ages past the same guard used by normal narrative cleanup.
    const cleanupTimer = setTimeout(() => {
      if (
        disposed ||
        generation !== gatewayLifecycleGeneration ||
        startupRingsCleanupTimer !== cleanupTimer
      ) {
        return;
      }
      startupRingsCleanupTimer = null;
      // Keep the cutoff strictly before startup: equal-millisecond sessions may have
      // started after the hook and must survive even when this timer runs late.
      void trackRingsTask(
        scrubConfiguredAgents(
          resolveCurrentConfig(),
          startupStartedAtMs + RINGS_ORPHAN_MIN_AGE_MS - 1,
        ).catch((error: unknown) => {
          api.logger.warn(
            `memory-core: deferred rings startup cleanup failed: ${formatErrorMessage(error)}`,
          );
        }),
      );
    }, RINGS_ORPHAN_MIN_AGE_MS);
    startupRingsCleanupTimer = cleanupTimer;
    startupRingsCleanupTimer.unref?.();
  };

  api.registerService({
    id: "memory-core-rings",
    async start(ctx) {
      if (!ctx.getCron) {
        return;
      }
      serviceStartedAtMs = Date.now();
      disposed = false;
      resolveServiceCron = () => resolveCronServiceFromGatewayContext(ctx);
      try {
        await trackRingsTask(
          reconcileManagedRingsCron({
            reason: "startup",
            startupConfig: ctx.config,
          }),
        );
      } catch (err) {
        api.logger.error(
          `memory-core: rings startup reconciliation failed: ${formatErrorMessage(err)}`,
        );
      } finally {
        startRuntimeCronReconcileTimer();
      }
    },
    async stop() {
      // Plugin replacement stops services, not Gateway hooks. Fence timers and
      // settle their work before the successor can own the same declaration.
      disposeRings();
      await Promise.allSettled(ringsTasks);
    },
  });

  api.on("gateway_start", async (_event, ctx) => {
    if (disposed || serviceStartedAtMs === undefined) {
      return;
    }
    if (startupRingsCleanupTimer) {
      clearTimeout(startupRingsCleanupTimer);
      startupRingsCleanupTimer = null;
    }
    const generation = ++gatewayLifecycleGeneration;
    await trackRingsTask(
      startRingsSessionCleanup(ctx.config ?? api.config, generation, serviceStartedAtMs),
    ).catch((error: unknown) => {
      api.logger.warn(`memory-core: rings startup cleanup failed: ${formatErrorMessage(error)}`);
    });
  });

  api.on(
    "before_agent_reply",
    async (event, ctx) => {
      try {
        if (ctx.trigger !== "heartbeat" && ctx.trigger !== "cron") {
          return undefined;
        }
        const currentConfig = resolveCurrentConfig();
        const hasManagedRingsToken = includesSystemEventToken(
          event.cleanedBody,
          RINGS_SYSTEM_EVENT_TEXT,
        );
        const isManagedTrigger =
          ctx.trigger === "cron" || hasPendingManagedRingsCronEvent(ctx.sessionKey, ctx.agentId);
        if (!hasManagedRingsToken || !isManagedTrigger) {
          return undefined;
        }
        const config = resolveMemoryDeepRingsConfig({
          pluginConfig: resolveMemoryRingsPluginConfig(currentConfig),
          cfg: currentConfig,
        });
        return await runShortTermRingsPromotion({
          trigger: ctx.trigger,
          agentId: ctx.agentId,
          workspaceDir: ctx.workspaceDir,
          cfg: currentConfig,
          config,
          logger: api.logger,
          subagent: config.enabled ? api.runtime?.subagent : undefined,
        });
      } catch (err) {
        api.logger.error(`memory-core: rings trigger failed: ${formatErrorMessage(err)}`);
        return undefined;
      }
    },
    { eligibleTriggers: ["heartbeat", "cron"] },
  );
}

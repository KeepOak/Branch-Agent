import { isDeepStrictEqual } from "node:util";
import { coerceErrorMessage } from "@branch/normalization-core";
import {
  AgentSharedStoreOwnerError,
  assertAgentSessionStoreDeletionSafe,
  isPathOwnedBySurvivingAgent,
  readAgentDeleteDatabaseRegistry,
  resolveSurvivingDatabaseFilePaths,
} from "../agents/agent-delete-databases.js";
import { getRuntimeConfig } from "../config/config.js";
import { groveCronGatewayJobMatchesRef, deleteGroveCronRef, markGroveCronRefRemoved } from "./cron.js";
import { digestGroveValue } from "./digest.js";
import {
  applyGroveAdoptedRemovePlan,
  buildGroveAdoptedRemovePlan,
} from "./lifecycle-adopted-removal.js";
import {
  groveBootstrapStateBlocksRemove,
  planGroveBootstrapRemoval,
  removeGroveBootstrap,
} from "./lifecycle-bootstrap-removal.js";
import {
  withGroveAgentConfigRemoval,
  digestGroveAgentRemovalSurface,
} from "./lifecycle-config-removal.js";
import {
  groveRemoveQuietRuntime,
  GroveRemoveError,
  cleanupGroveAgentFilesystem,
  deletionEffects,
  readGroveRemoveCronInventory,
  releaseGroveRemoveRows,
  removeGroveWorkspaceFile,
  workspaceContainsUntrackedEntries,
} from "./lifecycle-delete-support.js";
import { removeGroveMcpServers } from "./lifecycle-mcp-removal.js";
import {
  GROVE_REMOVE_PLAN_SCHEMA_VERSION,
  GROVE_REMOVE_RESULT_SCHEMA_VERSION,
  type GroveRemoveApplyOptions,
  type GroveRemovePlanOptions,
  type GroveRemoveResult,
  type GroveRemovePlan,
  type GroveRemovePlanAction,
} from "./lifecycle-remove-contract.js";
import { groveRemoveStateBlockers } from "./lifecycle-remove-state-blockers.js";
import { readGroveStatus } from "./lifecycle-status.js";
import { groveMcpRemovalSelector, planGroveMcpServerRemoval } from "./mcp.js";
import { groveMonitorSnapshotSchema } from "./monitor-cleanup-contract.js";
import { applyClawPackageRemovalPhase } from "./package-remove-phase.js";
import { filterReferencedCleanup, projectClawPackageRemovePlan } from "./package-remove-plan.js";
import { planClawPackageRemovals } from "./package-remove.js";
import { GROVE_OUTPUT_STABILITY } from "./types.js";

export { GroveRemoveError } from "./lifecycle-delete-support.js";
export {
  GROVE_REMOVE_PLAN_SCHEMA_VERSION,
  GROVE_REMOVE_RESULT_SCHEMA_VERSION,
} from "./lifecycle-remove-contract.js";
export { readGroveStatus, type GroveStatusRecord } from "./lifecycle-status.js";

export async function buildGroveRemovePlan(
  target: string,
  options: GroveRemovePlanOptions = {},
): Promise<GroveRemovePlan> {
  const status = await readGroveStatus(target, options);
  const blockers: GroveRemovePlan["blockers"] = [];
  if (status.records.length === 0) {
    blockers.push({
      code: "grove_not_found",
      message: `No installed Grove matches ${JSON.stringify(target)}.`,
    });
  } else if (status.records.length > 1) {
    blockers.push({
      code: "grove_ambiguous",
      message: `Grove name ${JSON.stringify(target)} matches multiple agents; use an agent id.`,
    });
  }
  const record = status.records.length === 1 ? status.records[0] : undefined;
  if (record?.install.agentOrigin === "adopted") {
    return buildGroveAdoptedRemovePlan(target, record, blockers);
  }
  blockers.push(...groveRemoveStateBlockers(record));
  const actions: GroveRemovePlanAction[] = [];
  if (record) {
    const packageCleanup = filterReferencedCleanup(options.referencedCleanup, "package");
    const mcpCleanup = filterReferencedCleanup(options.referencedCleanup, "mcp");
    const packageDecisions = await planClawPackageRemovals(record.install, record.packages, {
      ...options,
      deps: options.packageDeps,
      referencedCleanup: packageCleanup,
    });
    const packagePlan = projectClawPackageRemovePlan({
      decisions: packageDecisions,
      inspections: record.packages,
      cleanup: packageCleanup,
    });
    blockers.push(...packagePlan.blockers);
    const config = options.config ?? getRuntimeConfig();
    try {
      assertAgentSessionStoreDeletionSafe(config, record.install.agentId, options);
    } catch (error) {
      if (!(error instanceof AgentSharedStoreOwnerError)) {
        throw error;
      }
      blockers.push({ code: "shared_session_store_owner", message: error.message });
    }
    const effects = deletionEffects(
      config,
      record.install.agentId,
      record.install.workspace,
      options.env,
    );
    const survivingDatabaseFilePaths = resolveSurvivingDatabaseFilePaths(
      readAgentDeleteDatabaseRegistry(options),
      record.install.agentId,
      options.env,
    );
    const sharedWithSurvivor = (pathname: string) =>
      isPathOwnedBySurvivingAgent(
        config,
        record.install.agentId,
        pathname,
        survivingDatabaseFilePaths,
        options.env,
      );
    const sharedWorkspace = Boolean(effects.workspace) && sharedWithSurvivor(effects.workspace);
    const sharedAgentDir = sharedWithSurvivor(effects.agentDir);
    const sharedSessionsDir = sharedWithSurvivor(effects.sessionsDir);
    const workspaceHasModifiedFiles =
      record.workspaceFiles.some((file) => file.state === "modified") ||
      record.bootstrap.state === "modified";
    const trackedWorkspacePaths = [
      ...record.workspaceFiles.map((file) => file.path),
      ...(record.install.bootstrap && record.bootstrap.state === "pending"
        ? [record.bootstrap.path]
        : []),
    ];
    const workspaceHasUntrackedEntries = await workspaceContainsUntrackedEntries(
      record.install.workspace,
      trackedWorkspacePaths,
    );
    const { attachedJobs, monitors, inspectionUnavailable } = await readGroveRemoveCronInventory(
      record.install.agentId,
      options,
    );
    const ownedSchedulerJobIds = new Set(
      record.cronJobs
        .filter((cron) => cron.status !== "removed" && cron.schedulerJobId)
        .map((cron) => cron.schedulerJobId),
    );
    actions.push({
      kind: "agent",
      id: record.install.agentId,
      action: "remove",
      target: `agents.entries[${JSON.stringify(record.install.agentId)}]`,
      blocked: record.agentState === "modified",
      details: {
        expectedState: record.agentState,
        configDigest: record.install.agentConfigDigest,
        removalSurfaceDigest: digestGroveAgentRemovalSurface(
          options.config ?? getRuntimeConfig(),
          record.install.agentId,
        ),
        ownedPaths: record.install.agentOwnedPaths,
      },
      ...(record.agentState === "modified" ? { reason: "Agent config digest changed." } : {}),
    });
    if (effects.pruned.removedBindings > 0) {
      actions.push({
        kind: "configBinding",
        id: record.install.agentId,
        action: "remove",
        target: `bindings[agentId=${record.install.agentId}]`,
        blocked: record.agentState === "modified",
        details: { count: effects.pruned.removedBindings },
      });
    }
    if (effects.pruned.removedAllow > 0) {
      actions.push({
        kind: "agentAllow",
        id: record.install.agentId,
        action: "remove",
        target: `tools.agentToAgent.allow[${record.install.agentId}]`,
        blocked: record.agentState === "modified",
        details: { count: effects.pruned.removedAllow },
      });
    }
    if (effects.workspace) {
      actions.push({
        kind: "workspace",
        id: record.install.agentId,
        action:
          sharedWorkspace || workspaceHasModifiedFiles || workspaceHasUntrackedEntries
            ? "retain"
            : "trash",
        target: effects.workspace,
        blocked: record.agentState === "modified",
        details: {
          retained: sharedWorkspace || workspaceHasModifiedFiles || workspaceHasUntrackedEntries,
          sharedWith: effects.workspaceSharedWith,
        },
        ...(sharedWorkspace
          ? { reason: "Workspace contains state owned by another agent." }
          : workspaceHasModifiedFiles
            ? { reason: "Workspace contains locally modified Grove-managed files." }
            : workspaceHasUntrackedEntries
              ? { reason: "Workspace contains files or directories not managed by this Grove." }
              : {}),
      });
    }
    if (effects.agentDir) {
      actions.push({
        kind: "agentState",
        id: record.install.agentId,
        action: sharedAgentDir ? "retain" : "trash",
        target: effects.agentDir,
        blocked: record.agentState === "modified",
        ...(sharedAgentDir
          ? { reason: "Agent directory contains state owned by another agent." }
          : {}),
      });
    }
    actions.push({
      kind: "sessionIndex",
      id: record.install.agentId,
      action: "delete",
      target: `session store entries for agent:${record.install.agentId}`,
      blocked: record.agentState === "modified",
    });
    actions.push({
      kind: "sessionTranscripts",
      id: record.install.agentId,
      action: sharedSessionsDir ? "retain" : "trash",
      target: effects.sessionsDir,
      blocked: record.agentState === "modified",
      ...(sharedSessionsDir
        ? { reason: "Session directory contains state owned by another agent." }
        : {}),
    });
    for (const job of attachedJobs.filter((candidate) => !ownedSchedulerJobIds.has(candidate.id))) {
      if (monitors.some((monitor) => isDeepStrictEqual(monitor, job))) {
        actions.push({
          kind: "scheduledJob",
          id: job.id,
          action: "remove",
          target: `cron_jobs:${job.id}`,
          blocked: false,
          reason: "Config-owned monitor; Gateway cancellation and drainage precede local cleanup.",
          details: { ...job },
        });
        continue;
      }
      blockers.push({
        code: "agent_job_attached",
        message: `Cron job ${JSON.stringify(job.id)} still references agent ${JSON.stringify(record.install.agentId)}; reassign or remove independent work, or reconnect to the serving Gateway to verify monitor ownership.`,
      });
      actions.push({
        kind: "scheduledJob",
        id: job.id,
        action: "retain",
        target: `cron_jobs:${job.id}`,
        blocked: true,
        reason:
          "Scheduled work without verified Grove or config ownership must be handled explicitly.",
        details: {
          ...(inspectionUnavailable ? { monitorInspection: "unavailable" } : {}),
          name: job.name,
          enabled: job.enabled,
          agentId: job.agentId,
          ownerAgentId: job.ownerAgentId,
        },
      });
    }
    for (const file of record.workspaceFiles) {
      actions.push({
        kind: "workspaceFile",
        id: file.path,
        action: file.state === "unchanged" ? "delete" : "retain",
        target: `${file.workspace}:${file.path}`,
        blocked: file.state === "unsafe",
        details: {
          expectedState: file.state,
          contentDigest: file.contentDigest,
          workspace: file.workspace,
        },
        ...(file.state === "modified"
          ? { reason: "Local content changed; preserve the file." }
          : {}),
      });
    }
    const bootstrapAction = planGroveBootstrapRemoval(record);
    if (bootstrapAction) {
      actions.push(bootstrapAction);
    }
    actions.push(...packagePlan.actions);
    const unmatchedMcpSelectors = new Set(mcpCleanup?.selected ?? []);
    for (const server of record.mcpServers) {
      const blocked = server.state === "pending";
      const decision = planGroveMcpServerRemoval(server, {
        ...options,
        referencedCleanup: mcpCleanup,
      });
      unmatchedMcpSelectors.delete(groveMcpRemovalSelector(server));
      if (decision.blocked) {
        blockers.push({
          code: "referenced_cleanup_requires_override",
          message: `${groveMcpRemovalSelector(server)}: ${decision.reason ?? "explicit conflict override is required"}`,
        });
      }
      actions.push({
        kind: "mcpServer",
        id: server.name,
        action: blocked ? "retain" : decision.action,
        target: `mcp.servers.${server.name}`,
        blocked,
        details: {
          expectedState: server.state,
          configDigest: server.configDigest,
          relationship: server.relationship,
          origin: server.origin,
          independentOwner: server.independentOwner,
          affectedGroveAgentIds: decision.affectedGroveAgentIds,
          cleanupMode: mcpCleanup?.mode ?? "retain",
          availableCleanupModes:
            server.relationship === "referenced"
              ? ["retain", "remove-if-unused", "remove-selected"]
              : ["remove"],
        },
        ...(blocked
          ? { reason: `MCP ownership state is ${server.state}.` }
          : decision.reason
            ? { reason: decision.reason }
            : {}),
      });
    }
    for (const selector of unmatchedMcpSelectors) {
      blockers.push({
        code: "referenced_cleanup_not_found",
        message: `Selected referenced resource ${JSON.stringify(selector)} is not owned by this Grove.`,
      });
    }
    for (const cron of record.cronJobs) {
      const blocked =
        cron.status !== "removed" && (cron.status !== "complete" || !cron.schedulerJobId);
      actions.push({
        kind: "cronJob",
        id: cron.manifestId,
        action: blocked ? "retain" : "remove",
        target: cron.schedulerJobId ?? cron.declarationKey,
        blocked,
        details: {
          expectedStatus: cron.status,
          declarationKey: cron.declarationKey,
          schedulerJobId: cron.schedulerJobId,
          job: cron.job,
        },
        ...(blocked ? { reason: `Cron ownership state is ${cron.status}.` } : {}),
      });
    }
    actions.push({
      kind: "installRecord",
      id: record.install.agentId,
      action: "remove",
      target: `grove_installs:${record.install.agentId}`,
      blocked: false,
      details: {
        expectedStatus: record.install.status,
        planIntegrity: record.install.planIntegrity,
        sourceIntegrity: record.install.grove.integrity,
      },
    });
  }
  const planIdentity = {
    target,
    agentId: record?.install.agentId,
    actions,
    blockers,
  };
  return {
    schemaVersion: GROVE_REMOVE_PLAN_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    dryRun: true,
    mutationAllowed: false,
    planIntegrity: digestGroveValue(planIdentity),
    target,
    ...(record ? { agentId: record.install.agentId } : {}),
    actions,
    blockers,
  };
}

export async function applyGroveRemovePlan(
  plan: GroveRemovePlan,
  options: GroveRemoveApplyOptions = {},
): Promise<GroveRemoveResult> {
  if (options.consentPlanIntegrity !== plan.planIntegrity) {
    throw new GroveRemoveError(
      "plan_integrity_mismatch",
      "Consent does not match the current Grove remove plan; run remove --dry-run again.",
    );
  }
  if (plan.blockers.length > 0 || !plan.agentId) {
    throw new GroveRemoveError("remove_blocked", "The Grove remove plan contains blockers.");
  }
  if (
    plan.actions.some((action) => action.kind === "installRecord" && action.action === "release")
  ) {
    return await applyGroveAdoptedRemovePlan(plan, options);
  }
  const monitorGateway = options.monitorGateway;
  if (!monitorGateway) {
    throw new GroveRemoveError(
      "monitor_gateway_required",
      "Grove removal requires the serving Gateway to establish safe cancellation and drainage.",
    );
  }
  const currentPlan = await buildGroveRemovePlan(plan.target, options);
  if (currentPlan.planIntegrity !== plan.planIntegrity) {
    throw new GroveRemoveError("remove_changed", "Grove-owned state changed after remove planning.");
  }
  const agentId = plan.agentId;
  const current = await readGroveStatus(plan.agentId, options);
  const record = current.records[0];
  const plannedAgentAction = plan.actions.find(
    (action) => action.kind === "agent" && action.id === agentId,
  );
  const expectedRemovalSurfaceDigest = plannedAgentAction?.details?.removalSurfaceDigest;
  if (typeof expectedRemovalSurfaceDigest !== "string") {
    throw new GroveRemoveError("remove_changed", "Grove remove plan is missing config state.");
  }
  if (
    !record ||
    record.agentState === "modified" ||
    groveBootstrapStateBlocksRemove(record) ||
    record.workspaceFiles.some((file) => file.state === "unsafe") ||
    record.mcpServers.some((server) => server.state === "pending")
  ) {
    throw new GroveRemoveError("remove_changed", "Grove-owned state changed after remove planning.");
  }
  const packageDecisions = await planClawPackageRemovals(record.install, record.packages, {
    ...options,
    deps: options.packageDeps,
    referencedCleanup: filterReferencedCleanup(options.referencedCleanup, "package"),
  });
  const plannedPackages = plan.actions
    .filter((action) => action.kind === "packageRef")
    .map((action) => `${action.id}:${action.action}`)
    .toSorted();
  const currentPackages = packageDecisions
    .map(
      (decision) =>
        `${decision.packageRef.kind}:${decision.packageRef.ref}@${decision.packageRef.version}:${decision.action === "uninstall" ? "uninstall" : "release"}`,
    )
    .toSorted();
  if (JSON.stringify(plannedPackages) !== JSON.stringify(currentPackages)) {
    throw new GroveRemoveError("remove_changed", "Package ownership changed after remove planning.");
  }
  const plannedMcpServers = plan.actions
    .filter((action) => action.kind === "mcpServer")
    .map((action) => `${action.id}:${action.action}`)
    .toSorted();
  const currentMcpServers = record.mcpServers
    .map((server) => `${server.name}:${planGroveMcpServerRemoval(server, options).action}`)
    .toSorted();
  if (JSON.stringify(plannedMcpServers) !== JSON.stringify(currentMcpServers)) {
    throw new GroveRemoveError("remove_changed", "MCP ownership changed after remove planning.");
  }
  const result: GroveRemoveResult = {
    schemaVersion: GROVE_REMOVE_RESULT_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    dryRun: false,
    status: "partial",
    agentId,
    agentRemoved: false,
    workspaceFiles: [],
    packages: [],
    mcpServers: [],
    cronJobs: [],
    packageRefsReleased: 0,
  };
  const partial = (code: string, message: string): GroveRemoveResult => ({
    ...result,
    error: { code, message },
  });
  const monitors = currentPlan.actions
    .filter((action) => action.kind === "scheduledJob" && action.action === "remove")
    .map((action) => groveMonitorSnapshotSchema.parse(action.details));
  return await withGroveAgentConfigRemoval<GroveRemoveResult>(
    {
      agentId,
      expectedDigest: record.install.agentConfigDigest,
      expectedInstall: record.orphaned ? null : record.install,
      expectedRemovalSurfaceDigest,
      expectedState: record.agentState,
      fallbackWorkspace: record.install.workspace,
      config: options.config,
      stateDatabase: options,
      onModified: () =>
        new GroveRemoveError("agent_modified", "Agent config changed during remove."),
      quiesceMonitors: (operationId) => monitorGateway.quiesce(agentId, operationId, monitors),
      drainMonitors: async (operationId) => await monitorGateway.drain(agentId, operationId),
    },
    async (commitRemoval, assertCurrent) => {
      assertCurrent();
      const mcpRemoval = await removeGroveMcpServers({
        agentId,
        servers: record.mcpServers,
        options,
        assertCurrent,
      });
      assertCurrent();
      result.mcpServers = mcpRemoval.mcpServers;
      if (mcpRemoval.error) {
        return partial("mcp_cleanup_failed", mcpRemoval.error);
      }
      const cronJobs = result.cronJobs;
      for (const cron of record.cronJobs) {
        if (cron.status !== "removed" && (!cron.schedulerJobId || cron.status !== "complete")) {
          throw new GroveRemoveError(
            "cron_cleanup_uncertain",
            `Cron declaration ${JSON.stringify(cron.manifestId)} is not safely removable.`,
          );
        }
        if (
          cron.status !== "removed" &&
          (!options.cronGateway?.get || !options.cronGateway.remove)
        ) {
          throw new GroveRemoveError(
            "cron_gateway_required",
            "Grove cron jobs require the gateway-owned cron.get and cron.remove APIs.",
          );
        }
        try {
          if (cron.status !== "removed") {
            const live = await options.cronGateway!.get!(cron.schedulerJobId!);
            if (live != null && !groveCronGatewayJobMatchesRef(agentId, cron, live)) {
              throw new Error(
                `Cron declaration ${JSON.stringify(cron.manifestId)} changed after planning.`,
              );
            }
            assertCurrent();
            if (live != null) {
              try {
                await options.cronGateway!.remove(cron.schedulerJobId!);
              } catch (removeError) {
                // Re-read after transport loss; a durable removal may have succeeded.
                const afterRemove = await options.cronGateway!.get!(cron.schedulerJobId!);
                if (afterRemove != null) {
                  throw removeError;
                }
              }
            }
            assertCurrent();
            markGroveCronRefRemoved(agentId, cron.manifestId, options);
          }
          deleteGroveCronRef(agentId, cron.manifestId, options);
          cronJobs.push({
            manifestId: cron.manifestId,
            schedulerJobId: cron.schedulerJobId,
            action: "removed",
          });
        } catch (error) {
          const message = coerceErrorMessage(error);
          cronJobs.push({
            manifestId: cron.manifestId,
            schedulerJobId: cron.schedulerJobId,
            action: "error",
            message,
          });
          return partial("cron_cleanup_failed", message);
        }
      }
      const configRemoval = await commitRemoval();
      const { cleanupTargets, configBeforeDelete, completeDeletion } = configRemoval;
      result.agentRemoved = configRemoval.agentRemoved;
      try {
        await configRemoval.drainMonitors();
        configRemoval.assertCurrent();
      } catch (error) {
        return partial("monitor_cleanup_failed", coerceErrorMessage(error));
      }
      const purgeSessions =
        options.purgeSessions ??
        (await import("../config/sessions/cleanup-service.js")).purgeAgentSessionStoreEntries;
      const purgeFailed = await purgeSessions(configBeforeDelete, agentId, {
        env: options.env,
        runDatabaseCleanup: configRemoval.runDatabaseCleanup,
      });
      assertCurrent();
      if (purgeFailed) {
        return partial(
          "session_cleanup_failed",
          "Session cleanup failed; correct the reported error and retry Grove removal.",
        );
      }
      try {
        const removed = await applyClawPackageRemovalPhase(packageDecisions, {
          ...options,
          agentId,
          operationId: configRemoval.operationId,
          assertCurrent,
        });
        result.packages = removed.packages;
        result.pluginRuntime = removed.application;
        result.warnings = removed.warnings;
      } catch (error) {
        return partial("package_cleanup_failed", coerceErrorMessage(error));
      }
      assertCurrent();
      const packageErrors = result.packages.filter((pkg) => pkg.action === "error");
      if (packageErrors.length > 0) {
        return partial("package_cleanup_failed", packageErrors.map((pkg) => pkg.reason).join("; "));
      }
      const workspaceFiles = result.workspaceFiles;
      for (const file of record.workspaceFiles) {
        assertCurrent();
        workspaceFiles.push(await removeGroveWorkspaceFile(file, assertCurrent));
      }
      assertCurrent();
      const bootstrap = await removeGroveBootstrap(record, assertCurrent);
      const cleanupErrors = workspaceFiles
        .filter((file) => file.action === "error")
        .map((file) => file.message ?? `Could not remove ${file.path}.`);
      if (bootstrap?.action === "error") {
        cleanupErrors.push(bootstrap.message ?? `Could not remove ${bootstrap.path}.`);
      }
      if (cleanupErrors.length === 0) {
        const workspaceHasRemainingEntries = await workspaceContainsUntrackedEntries(
          cleanupTargets.workspaceDir,
          record.workspaceFiles.map((file) => file.path),
        );
        configRemoval.assertCurrent();
        cleanupErrors.push(
          ...(await cleanupGroveAgentFilesystem({
            agentId,
            nextConfig: configRemoval.nextConfig,
            targets: cleanupTargets,
            runtime: groveRemoveQuietRuntime,
            trashPath: options.trashPath,
            stateDatabase: options,
            assertCurrent,
            retainWorkspace:
              workspaceHasRemainingEntries ||
              bootstrap?.action === "retainedModified" ||
              workspaceFiles.some((file) => file.action === "retainedModified"),
          })),
        );
      }
      const complete = releaseGroveRemoveRows(
        agentId,
        workspaceFiles,
        cleanupErrors,
        configRemoval.assertCurrent,
        completeDeletion,
        options,
      );
      return {
        ...result,
        status: complete ? "complete" : "partial",
        ...(bootstrap ? { bootstrap } : {}),
        packageRefsReleased: complete ? record.packages.length : 0,
        ...(complete
          ? {}
          : {
              error: {
                code: "workspace_cleanup_failed",
                message: cleanupErrors.join("; "),
              },
            }),
      };
    },
  ).catch((error: unknown) =>
    partial(
      error instanceof GroveRemoveError ? error.code : "monitor_cleanup_failed",
      coerceErrorMessage(error),
    ),
  );
}

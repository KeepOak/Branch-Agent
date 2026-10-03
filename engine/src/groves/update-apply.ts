import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { coerceErrorMessage, stableStringify } from "@branch/normalization-core";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope-config.js";
import { listAgentEntries } from "../agents/agent-scope.js";
import { transformConfigFileWithRetry } from "../config/config.js";
import type { AgentConfig } from "../config/types.agents.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { PluginInstallBatchReload } from "../plugins/install-runtime-batch.js";
import type { RuntimeEnv } from "../runtime.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { groveTargetPackages } from "./application-provenance.js";
import {
  applyGroveCronUpdate,
  GroveCronUpdateError,
  type GroveCronUpdateExecution,
} from "./cron-update.js";
import type { GroveCronGateway } from "./cron.js";
import { digestGroveValue as digest } from "./digest.js";
import { buildGroveAddPlan, type GroveAddPlanContext } from "./lifecycle.js";
import {
  applyGroveMcpUpdate,
  GroveMcpUpdateError,
  type GroveMcpUpdateExecution,
} from "./mcp-update.js";
import { normalizeWorkspaceConfig, resolveMigrationAgentSettings } from "./migrate-validation.js";
import {
  applyClawPackageUpdate,
  ClawPackageUpdateError,
  type ClawPackageUpdateExecution,
} from "./package-update.js";
import { runGrovePluginBatch, type GrovePluginRuntimeOptions } from "./plugin-runtime.js";
import {
  readGroveInstallRecord,
  updateGroveInstallRecord,
  updateGroveInstallRecordStatus,
  type PersistedGroveInstall,
} from "./provenance.js";
import {
  GROVE_OUTPUT_STABILITY,
  type GroveManifest,
  type GroveBranchProfile,
  type GroveSourceIdentity,
} from "./types.js";
import { buildGroveUpdatePlan, type GroveUpdateAction, type GroveUpdatePlan } from "./update-plan.js";
import { collectGroveRollbackFailures } from "./update-rollback.js";
import {
  applyGroveWorkspaceUpdate,
  GroveWorkspaceUpdateError,
  type GroveWorkspaceUpdateExecution,
} from "./workspace-update.js";

export const GROVE_UPDATE_RESULT_SCHEMA_VERSION = "branch.groveUpdateResult.v1" as const;

type ConfigCommit = (transform: (config: BranchConfig) => BranchConfig) => Promise<void>;

export class GroveUpdateMutationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GroveUpdateMutationError";
  }
}

type GroveUpdateResult = {
  schemaVersion: typeof GROVE_UPDATE_RESULT_SCHEMA_VERSION;
  stability: typeof GROVE_OUTPUT_STABILITY;
  dryRun: false;
  mutationAllowed: true;
  status: "complete";
  agentId: string;
  previousGrove: NonNullable<GroveUpdatePlan["currentGrove"]>;
  targetGrove: NonNullable<GroveUpdatePlan["targetGrove"]>;
  appliedActions: GroveUpdateAction[];
  installRecord: PersistedGroveInstall;
};

function comparablePlan(plan: GroveUpdatePlan): unknown {
  return {
    found: plan.found,
    agentId: plan.agentId,
    currentGrove: plan.currentGrove,
    targetGrove: plan.targetGrove,
    actions: plan.actions,
    capabilityChanges: plan.capabilityChanges,
    readiness: plan.readiness,
    blockers: plan.blockers,
  };
}

function unchangedPackagePaths(plan: GroveUpdatePlan, manifest: GroveManifest): Set<string> {
  const unchangedIds = new Set(
    plan.actions
      .filter((action) => action.kind === "package" && action.action === "unchanged")
      .map((action) => action.id),
  );
  const paths = new Set<string>();
  manifest.packages.forEach((pkg, index) => {
    if (unchangedIds.has(`${pkg.kind}:${pkg.ref}`)) {
      paths.add(`$.packages[${index}]`);
    }
  });
  return paths;
}

export async function applyGroveUpdatePlan(
  plan: GroveUpdatePlan,
  params: {
    targetManifest: GroveManifest;
    targetGroveMarkdownBody?: Buffer;
    targetBranchProfile?: GroveBranchProfile;
    targetSource: GroveSourceIdentity;
  },
  options: BranchStateDatabaseOptions & {
    config: BranchConfig;
    sourceMcpServers: Record<string, Record<string, unknown>>;
    consentPlanIntegrity: string | undefined;
    packagePreflight?: GroveAddPlanContext["packagePreflight"];
    runtime?: RuntimeEnv;
    reloadPlugins?: PluginInstallBatchReload;
    commitConfig?: ConfigCommit;
    rebuildPlan?: typeof buildGroveUpdatePlan;
    buildAddPlan?: typeof buildGroveAddPlan;
    readInstall?: typeof readGroveInstallRecord;
    persistInstall?: typeof updateGroveInstallRecord;
    applyWorkspace?: typeof applyGroveWorkspaceUpdate;
    applyMcp?: typeof applyGroveMcpUpdate;
    applyCron?: typeof applyGroveCronUpdate;
    applyPackage?: typeof applyClawPackageUpdate;
    cronGateway?: GroveCronGateway;
  },
): Promise<GroveUpdateResult> {
  if (options.consentPlanIntegrity !== plan.planIntegrity) {
    throw new GroveUpdateMutationError(
      "plan_integrity_mismatch",
      "Consent does not match the current Grove update plan; run update --dry-run again.",
    );
  }
  if (!plan.found || plan.blockers.length > 0 || plan.actions.some((action) => action.blocked)) {
    throw new GroveUpdateMutationError(
      "update_blocked",
      "The Grove update plan contains blockers or manual actions.",
    );
  }

  const rebuildPlan = options.rebuildPlan ?? buildGroveUpdatePlan;
  const fresh = await rebuildPlan({
    agentId: plan.agentId,
    targetManifest: params.targetManifest,
    targetGroveMarkdownBody: params.targetGroveMarkdownBody,
    targetBranchProfile: params.targetBranchProfile,
    targetSource: params.targetSource,
    config: options.config,
    sourceMcpServers: options.sourceMcpServers,
    stateOptions: options,
    packagePreflight: options.packagePreflight,
  });
  if (
    fresh.planIntegrity !== plan.planIntegrity ||
    stableStringify(comparablePlan(fresh)) !== stableStringify(comparablePlan(plan))
  ) {
    throw new GroveUpdateMutationError(
      "update_changed",
      "Grove-owned state changed after update planning; build a new dry-run plan.",
    );
  }

  const actionable = fresh.actions.filter((action) => action.action !== "unchanged");
  if (!fresh.currentGrove || !fresh.targetGrove) {
    throw new GroveUpdateMutationError("update_invalid", "The Grove update plan lacks identity.");
  }

  const buildAddPlan = options.buildAddPlan ?? buildGroveAddPlan;
  const readInstall = options.readInstall ?? readGroveInstallRecord;
  const currentInstall = readInstall(fresh.agentId, options);
  if (!currentInstall) {
    throw new GroveUpdateMutationError("update_changed", "The Grove install record disappeared.");
  }
  const adoptedAgentConfigDigest =
    currentInstall.agentOrigin === "adopted"
      ? fresh.actions.find((action) => action.kind === "agent")?.desiredDigest
      : undefined;
  const installPersistenceOptions = {
    ...options,
    ...(adoptedAgentConfigDigest ? { agentConfigDigest: adoptedAgentConfigDigest } : {}),
  };
  const partialMutation = (
    message: string,
    errorOptions?: ErrorOptions,
  ): GroveUpdateMutationError => {
    try {
      updateGroveInstallRecordStatus(fresh.agentId, "partial", options);
    } catch {
      // Preserve the owner failure; doctor can still reconcile subordinate pending records.
    }
    return new GroveUpdateMutationError("update_partial", message, errorOptions);
  };
  const targetAddPlan = await buildAddPlan({
    manifest: params.targetManifest,
    groveMarkdownBody: params.targetGroveMarkdownBody,
    includePackageBootstrap: false,
    branchProfile: params.targetBranchProfile,
    source: params.targetSource,
    context: {
      agentId: fresh.agentId,
      workspace: currentInstall.workspace,
      packagePreflight: async (pkg, workspace) => {
        const preflight = options.packagePreflight
          ? await options.packagePreflight(pkg, workspace)
          : {
              ok: false,
              code: "package_install_unavailable",
              message: "Package preflight is unavailable.",
            };
        const action = fresh.actions.find(
          (candidate) => candidate.kind === "package" && candidate.id === `${pkg.kind}:${pkg.ref}`,
        );
        return !preflight.ok &&
          pkg.kind === "plugin" &&
          preflight.code === "plugin_version_conflict" &&
          action?.action === "change"
          ? {
              ok: true,
              action: "install" as const,
              ...(preflight.integrity ? { integrity: preflight.integrity } : {}),
              ...(preflight.installId ? { installId: preflight.installId } : {}),
              ...(preflight.warning ? { warning: preflight.warning } : {}),
              ...(preflight.requirements ? { requirements: preflight.requirements } : {}),
              ...(preflight.detectedFormat ? { detectedFormat: preflight.detectedFormat } : {}),
              ...(preflight.mapped ? { mapped: preflight.mapped } : {}),
              ...(preflight.unavailable ? { unavailable: preflight.unavailable } : {}),
              ...(preflight.adapterIdentity ? { adapterIdentity: preflight.adapterIdentity } : {}),
            }
          : preflight;
      },
    },
  });
  const unchangedPaths = unchangedPackagePaths(fresh, params.targetManifest);
  if (
    targetAddPlan.blockers.some(
      (blocker) =>
        blocker.code !== "agent_id_collision" &&
        blocker.code !== "workspace_collision" &&
        !(blocker.code === "skill_version_conflict" && unchangedPaths.has(blocker.path)),
    )
  ) {
    throw new GroveUpdateMutationError(
      "update_target_blocked",
      "The target Grove cannot be safely materialized for update.",
    );
  }
  for (const action of fresh.actions.filter(
    (candidate) => candidate.kind === "package" && candidate.action === "unchanged",
  )) {
    const addAction = targetAddPlan.actions.find(
      (candidate) => candidate.kind === "package" && candidate.id === action.id,
    );
    if (!addAction || addAction.details?.expectedState === "absent") {
      throw new GroveUpdateMutationError(
        "update_changed",
        `Package ${JSON.stringify(action.id)} is no longer present; build a new dry-run plan.`,
      );
    }
  }
  const targetPackages = groveTargetPackages(params.targetManifest, params.targetBranchProfile);
  for (const action of fresh.actions.filter(
    (candidate) =>
      candidate.kind === "package" &&
      candidate.action !== "unchanged" &&
      candidate.action !== "release" &&
      candidate.action !== "remove",
  )) {
    const target = targetPackages.get(action.id);
    const addAction = targetAddPlan.actions.find(
      (candidate) => candidate.kind === "package" && candidate.id === action.id,
    );
    const details = addAction?.details;
    if (
      !target ||
      action.desiredDigest !==
        digest({
          package: target,
          integrity: details?.integrity,
          installId: details?.installId,
          riskWarning: details?.riskWarning,
          prerequisites: details?.prerequisites,
          extension: details?.extension,
        })
    ) {
      throw new GroveUpdateMutationError(
        "update_changed",
        `Resolved package ${JSON.stringify(action.id)} changed after update planning; build a new dry-run plan.`,
      );
    }
  }

  const applyPackage = options.applyPackage ?? applyClawPackageUpdate;
  const requirementActions = fresh.actions.filter(
    (action) =>
      action.kind === "package" &&
      action.action !== "unchanged" &&
      action.action !== "release" &&
      action.action !== "remove" &&
      targetPackages.get(action.id)?.kind === "plugin",
  );
  const remainingPackageActions = fresh.actions.filter(
    (action) =>
      action.kind === "package" &&
      action.action !== "unchanged" &&
      !requirementActions.includes(action),
  );
  const applyPackageActions = async (
    actions: GroveUpdateAction[],
    runtimeBatch?: GrovePluginRuntimeOptions["runtimeBatch"],
  ): Promise<ClawPackageUpdateExecution> => {
    if (actions.length === 0) {
      return { appliedIds: [], rollback: async () => undefined };
    }
    return await applyPackage({ ...fresh, actions }, targetAddPlan, {
      ...options,
      runtimeBatch,
    });
  };
  const resumedRequirements =
    currentInstall.status === "complete"
      ? []
      : fresh.actions
          .filter(
            (action) =>
              action.kind === "package" &&
              action.action === "unchanged" &&
              targetPackages.get(action.id)?.kind === "plugin",
          )
          .map((action) => {
            const installId = targetAddPlan.actions.find((entry) => entry.id === action.id)?.details
              ?.installId;
            if (typeof installId !== "string" || !installId) {
              throw new GroveUpdateMutationError(
                "update_changed",
                `Plugin requirement ${action.id} lost its installed identity; build a new dry-run plan.`,
              );
            }
            return installId;
          });

  let requirementExecution: ClawPackageUpdateExecution;
  try {
    requirementExecution =
      requirementActions.length || resumedRequirements.length
        ? await runGrovePluginBatch(
            options,
            requirementActions.length + resumedRequirements.length,
            (batch) => {
              for (const id of resumedRequirements) {
                batch?.retain(id);
              }
              return applyPackageActions(requirementActions, batch);
            },
            (failure, operation) =>
              new ClawPackageUpdateError(
                [
                  !operation.ok ? coerceErrorMessage(operation.error) : undefined,
                  coerceErrorMessage(failure),
                ]
                  .filter(Boolean)
                  .join("\n"),
                true,
                { cause: !operation.ok ? new AggregateError([operation.error, failure]) : failure },
              ),
          )
        : await applyPackageActions(requirementActions);
  } catch (error) {
    if (error instanceof ClawPackageUpdateError && error.partial) {
      throw partialMutation(error.message, { cause: error });
    }
    throw new GroveUpdateMutationError("package_update_failed", coerceErrorMessage(error), {
      cause: error,
    });
  }
  const retainedRequirementMutation = requirementExecution.appliedIds.length > 0;
  const throwIfUpdatePartial = (error: unknown, rollbackFailures: string[] = []): void => {
    if (rollbackFailures.length > 0) {
      throw partialMutation(`${coerceErrorMessage(error)}; ${rollbackFailures.join("; ")}`);
    }
    if (retainedRequirementMutation) {
      throw partialMutation(
        `${coerceErrorMessage(error)}; successfully realized shared requirements were retained`,
      );
    }
  };

  const applyWorkspace = options.applyWorkspace ?? applyGroveWorkspaceUpdate;
  let workspaceExecution: GroveWorkspaceUpdateExecution;
  try {
    workspaceExecution = await applyWorkspace(fresh, targetAddPlan, options);
  } catch (error) {
    if (error instanceof GroveWorkspaceUpdateError && error.partial) {
      throw partialMutation(error.message);
    }
    throwIfUpdatePartial(error);
    throw new GroveUpdateMutationError("workspace_update_failed", coerceErrorMessage(error));
  }

  const applyMcp = options.applyMcp ?? applyGroveMcpUpdate;
  let mcpExecution: GroveMcpUpdateExecution;
  try {
    mcpExecution = await applyMcp(fresh, params.targetManifest, options);
  } catch (error) {
    const partial = error instanceof GroveMcpUpdateError && error.partial;
    try {
      await workspaceExecution.rollback();
    } catch (rollbackError) {
      throw partialMutation(
        `${coerceErrorMessage(error)}; workspace rollback failed: ${coerceErrorMessage(rollbackError)}`,
      );
    }
    if (partial) {
      throw partialMutation(`${error.message}; MCP config write outcome is uncertain`);
    }
    throwIfUpdatePartial(error);
    throw new GroveUpdateMutationError("mcp_update_failed", coerceErrorMessage(error));
  }

  let packageExecution: ClawPackageUpdateExecution;
  try {
    packageExecution = await applyPackageActions(remainingPackageActions);
  } catch (error) {
    // Keep method lookup and receiver binding inside each step.
    const rollbackFailures = await collectGroveRollbackFailures([
      ["MCP rollback failed", () => mcpExecution.rollback()],
      ["workspace rollback failed", () => workspaceExecution.rollback()],
    ]);
    if (error instanceof ClawPackageUpdateError && error.partial) {
      rollbackFailures.unshift("package artifact rollback is unavailable");
    }
    throwIfUpdatePartial(error, rollbackFailures);
    throw new GroveUpdateMutationError("package_update_failed", coerceErrorMessage(error));
  }

  const agentAction = fresh.actions.find((action) => action.kind === "agent");
  const commit: ConfigCommit =
    options.commitConfig ??
    (async (transform) => {
      await transformConfigFileWithRetry({
        afterWrite: { mode: "auto" },
        transform: (config) => ({ nextConfig: transform(config) }),
      });
    });
  let previousAgent: AgentConfig | undefined;
  let agentChanged = false;
  const liveAgentDigest = (config: BranchConfig, agent: AgentConfig | undefined) => {
    if (!agent || currentInstall.agentOrigin !== "adopted") {
      return agent ? digest(agent) : undefined;
    }
    let workspace = resolveAgentWorkspaceDir(config, fresh.agentId, options.env);
    try {
      workspace = realpathSync(workspace);
    } catch {
      workspace = resolve(workspace);
    }
    try {
      // Adopted ownership records effective settings, including inherited defaults
      // and the canonical workspace, while rollback retains the authored entry.
      return digest(
        normalizeWorkspaceConfig(resolveMigrationAgentSettings(config, agent), workspace),
      );
    } catch {
      return undefined;
    }
  };
  const rollbackAgent = async (): Promise<void> => {
    if (!agentChanged) {
      return;
    }
    await commit((config) => {
      const current = listAgentEntries(config).find((agent) => agent.id === fresh.agentId);
      const targetDigest = adoptedAgentConfigDigest ?? digest(targetAddPlan.agent.config);
      const liveDigest = liveAgentDigest(config, current);
      if (liveDigest !== targetDigest) {
        throw new Error("The agent changed before rollback.");
      }
      const nextEntries = { ...config.agents?.entries };
      if (previousAgent) {
        const { id: _id, ...previousEntry } = previousAgent;
        nextEntries[fresh.agentId] = previousEntry;
      } else {
        delete nextEntries[fresh.agentId];
      }
      return { ...config, agents: { ...config.agents, entries: nextEntries } };
    });
    agentChanged = false;
  };
  if (agentAction?.action === "change") {
    try {
      await commit((config) => {
        const current = listAgentEntries(config).find((agent) => agent.id === fresh.agentId);
        previousAgent = current;
        if (agentAction.currentDigest !== undefined) {
          if (!current) {
            throw new GroveUpdateMutationError(
              "agent_changed",
              "The owned agent entry disappeared during update.",
            );
          }
          const liveDigest = liveAgentDigest(config, current);
          if (liveDigest !== agentAction.currentDigest) {
            throw new GroveUpdateMutationError(
              "agent_changed",
              "The owned agent entry changed during update.",
            );
          }
        }
        const nextEntries = { ...config.agents?.entries };
        const { id: _id, ...targetEntry } = targetAddPlan.agent.config;
        nextEntries[fresh.agentId] = targetEntry;
        agentChanged = true;
        return { ...config, agents: { ...config.agents, entries: nextEntries } };
      });
    } catch (error) {
      const rollbackFailures = await collectGroveRollbackFailures([
        ["agent rollback failed", () => rollbackAgent()],
        ["package rollback incomplete", () => packageExecution.rollback()],
        ["MCP rollback failed", () => mcpExecution.rollback()],
        ["workspace rollback failed", () => workspaceExecution.rollback()],
      ]);
      throwIfUpdatePartial(error, rollbackFailures);
      if (error instanceof GroveUpdateMutationError) {
        throw error;
      }
      throw new GroveUpdateMutationError("agent_update_failed", coerceErrorMessage(error));
    }
  }

  const persistInstall = options.persistInstall ?? updateGroveInstallRecord;
  const applyCron = options.applyCron ?? applyGroveCronUpdate;
  let cronExecution: GroveCronUpdateExecution;
  try {
    cronExecution = await applyCron(fresh, params.targetManifest, options);
  } catch (error) {
    if (error instanceof GroveCronUpdateError && error.partial) {
      try {
        persistInstall(targetAddPlan, {
          ...installPersistenceOptions,
          expectedGrove: fresh.currentGrove,
          status: "partial",
        });
      } catch (persistError) {
        throw partialMutation(
          `${error.message}; cron gateway mutation outcome is uncertain; provenance update failed: ${coerceErrorMessage(persistError)}`,
        );
      }
      throw partialMutation(`${error.message}; cron gateway mutation outcome is uncertain`);
    }
    const rollbackFailures = await collectGroveRollbackFailures([
      ["agent rollback failed", () => rollbackAgent()],
      ["package rollback incomplete", () => packageExecution.rollback()],
      ["MCP rollback failed", () => mcpExecution.rollback()],
      ["workspace rollback failed", () => workspaceExecution.rollback()],
    ]);
    throwIfUpdatePartial(error, rollbackFailures);
    throw new GroveUpdateMutationError("cron_update_failed", coerceErrorMessage(error));
  }

  let installRecord: PersistedGroveInstall;
  try {
    installRecord = persistInstall(targetAddPlan, {
      ...installPersistenceOptions,
      expectedGrove: fresh.currentGrove,
    });
  } catch (error) {
    const rollbackFailures = await collectGroveRollbackFailures([
      ["agent rollback failed", () => rollbackAgent()],
      ["package rollback incomplete", () => packageExecution.rollback()],
      ["cron rollback failed", () => cronExecution.rollback()],
      ["MCP rollback failed", () => mcpExecution.rollback()],
      ["workspace rollback failed", () => workspaceExecution.rollback()],
    ]);
    throwIfUpdatePartial(error, rollbackFailures);
    throw new GroveUpdateMutationError("provenance_update_failed", coerceErrorMessage(error));
  }
  return {
    schemaVersion: GROVE_UPDATE_RESULT_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    dryRun: false,
    mutationAllowed: true,
    status: "complete",
    agentId: fresh.agentId,
    previousGrove: fresh.currentGrove,
    targetGrove: fresh.targetGrove,
    appliedActions: actionable,
    installRecord,
  };
}

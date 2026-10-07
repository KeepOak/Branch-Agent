import type { Stats } from "node:fs";
import { lstat, mkdir, rmdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { coerceErrorMessage } from "@branch/normalization-core";
import { findOverlappingWorkspaceAgentIds } from "../agents/agent-delete-safety.js";
import { listAgentEntries, toAgentEntriesRecord } from "../agents/agent-scope.js";
import { applyAgentConfig } from "../commands/agents.config.js";
import { transformConfigFileWithRetry } from "../config/config.js";
import type { AgentConfig } from "../config/types.agents.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resolvePathViaExistingAncestorSync } from "../infra/boundary-path.js";
import { normalizeWindowsPathForComparison } from "../infra/path-guards.js";
import type { PluginInstallBatchReload } from "../plugins/install-runtime-batch.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { recordAgentProvenance } from "../state/agent-provenance.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { resolveUserPath } from "../utils.js";
import { planWithPackageActions, sameCommittedAgent, statusAtLeast } from "./add-plan-helpers.js";
import { GroveBootstrapWriteError, seedClawPackageBootstrap } from "./bootstrap.js";
import {
  GroveCronInstallError,
  installGroveCronJobs,
  type GroveCronGateway,
  type PersistedGroveCronRef,
} from "./cron.js";
import { replaceLegacyCommittedAgent } from "./legacy-resume.js";
import {
  GroveMcpInstallError,
  installGroveMcpServers,
  type PersistedGroveMcpServerRef,
} from "./mcp.js";
import { ClawPackageInstallError, installClawPackages } from "./packages.js";
import {
  deleteGroveInstallRecord,
  persistGroveInstallRecord,
  updateGroveInstallRecordStatus,
  type GroveInstallStatus,
  type PersistedGroveInstall,
  type PersistedClawPackageRef,
} from "./provenance.js";
import { GROVE_OUTPUT_STABILITY, type GroveAddPlan } from "./types.js";
import {
  GroveWorkspaceWriteError,
  createGroveWorkspaceFiles,
  type PersistedGroveWorkspaceFile,
} from "./workspace.js";

export const GROVE_ADD_RESULT_SCHEMA_VERSION = "branch.groveAddResult.v1" as const;

type ConfigCommit = (transform: (config: BranchConfig) => BranchConfig) => Promise<void>;
type GroveAddApplyOptions = BranchStateDatabaseOptions & {
  reloadPlugins?: PluginInstallBatchReload;
  consentPlanIntegrity?: string;
  resumeRecord?: PersistedGroveInstall;
  resumePlan?: GroveAddPlan;
  commitConfig?: ConfigCommit;
  persistRecord?: typeof persistGroveInstallRecord;
  deleteRecord?: typeof deleteGroveInstallRecord;
  updateRecord?: typeof updateGroveInstallRecordStatus;
  createWorkspaceFiles?: typeof createGroveWorkspaceFiles;
  runtime?: RuntimeEnv;
  installPackages?: typeof installClawPackages;
  installMcpServers?: typeof installGroveMcpServers;
  installCronJobs?: typeof installGroveCronJobs;
  seedPackageBootstrap?: typeof seedClawPackageBootstrap;
  cronGateway?: Pick<GroveCronGateway, "add" | "list" | "waitUntilAgentAvailable">;
  nowMs?: number;
};
export class GroveAddMutationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GroveAddMutationError";
  }
}

type GroveAddResult = {
  schemaVersion: typeof GROVE_ADD_RESULT_SCHEMA_VERSION;
  stability: typeof GROVE_OUTPUT_STABILITY;
  dryRun: false;
  mutationAllowed: true;
  planIntegrity: string;
  status: "complete" | "partial";
  grove: GroveAddPlan["grove"];
  agent: GroveAddPlan["agent"];
  workspaceCreated: boolean;
  configCommitted: boolean;
  workspaceFiles: PersistedGroveWorkspaceFile[];
  packages: PersistedClawPackageRef[];
  mcpServers: PersistedGroveMcpServerRef[];
  cronJobs: PersistedGroveCronRef[];
  installRecord?: PersistedGroveInstall;
  error?: {
    code: string;
    message: string;
    diagnostics?: GroveWorkspaceWriteError["diagnostics"];
  };
};

function markInstallStatus(
  agentId: string,
  status: GroveInstallStatus,
  expectedStatuses: GroveInstallStatus[],
  options: GroveAddApplyOptions,
): void {
  (options.updateRecord ?? updateGroveInstallRecordStatus)(agentId, status, {
    ...options,
    expectedStatuses,
  });
}

function clearUnownedInstallRecord(
  agentId: string,
  expectedStatuses: GroveInstallStatus[],
  options: GroveAddApplyOptions,
): void {
  (options.deleteRecord ?? deleteGroveInstallRecord)(agentId, {
    ...options,
    expectedStatuses,
  });
}

function workspacePathKey(value: string): string {
  return process.platform === "win32" ? normalizeWindowsPathForComparison(value) : value;
}

function assertWorkspacePathUnchanged(workspace: string): void {
  const canonicalWorkspace = resolvePathViaExistingAncestorSync(workspace);
  if (workspacePathKey(canonicalWorkspace) !== workspacePathKey(workspace)) {
    throw new GroveAddMutationError(
      "workspace_path_changed",
      `Workspace ancestry changed after planning: expected ${JSON.stringify(workspace)}, resolved ${JSON.stringify(canonicalWorkspace)}.`,
    );
  }
}

export async function applyGroveAddPlan(
  plan: GroveAddPlan,
  options: GroveAddApplyOptions = {},
): Promise<GroveAddResult> {
  if (plan.blockers.length > 0) {
    throw new GroveAddMutationError("plan_blocked", "The Grove add plan contains blockers.");
  }
  if (options.consentPlanIntegrity !== (options.resumePlan?.planIntegrity ?? plan.planIntegrity)) {
    throw new GroveAddMutationError(
      "plan_integrity_mismatch",
      "Consent does not match the current Grove add plan; run add --dry-run again.",
    );
  }

  const persistRecord = options.persistRecord ?? persistGroveInstallRecord;
  let installRecord: PersistedGroveInstall;
  try {
    installRecord = persistRecord(plan, {
      ...options,
      status: "pending",
      expectedExistingRecord: options.resumeRecord,
      expectedExistingPlan: options.resumePlan,
      deferLegacyPlanUpgrade: options.resumePlan !== undefined,
    });
  } catch (error) {
    throw new GroveAddMutationError("provenance_failed", (error as Error).message);
  }

  let workspaceCreated = false;
  let configCommitted = false;
  let workspaceFiles: PersistedGroveWorkspaceFile[] = [];
  let packages: PersistedClawPackageRef[] = [];
  let mcpServers: PersistedGroveMcpServerRef[] = [];
  let cronJobs: PersistedGroveCronRef[] = [];
  const partialResult = ({
    installStatus = "partial",
    nowMs,
    ...overrides
  }: Partial<
    Pick<
      GroveAddResult,
      | "workspaceCreated"
      | "configCommitted"
      | "workspaceFiles"
      | "packages"
      | "mcpServers"
      | "cronJobs"
    >
  > & {
    installStatus?: GroveInstallStatus;
    nowMs?: number;
    error: GroveAddResult["error"];
  }): GroveAddResult => ({
    schemaVersion: GROVE_ADD_RESULT_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    dryRun: false,
    mutationAllowed: true,
    planIntegrity: plan.planIntegrity,
    status: "partial",
    grove: plan.grove,
    agent: plan.agent,
    workspaceCreated,
    configCommitted,
    workspaceFiles,
    packages,
    mcpServers,
    cronJobs,
    installRecord: {
      ...installRecord,
      status: installStatus,
      updatedAtMs: nowMs ?? Date.now(),
    },
    ...overrides,
  });

  const workspace = resolve(resolveUserPath(plan.agent.workspace));
  const workspacePhaseRecorded = statusAtLeast(installRecord.status, "workspace_ready");
  let workspaceState: Stats | undefined;
  try {
    assertWorkspacePathUnchanged(workspace);
    workspaceState = await lstat(workspace).catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    });
  } catch (error) {
    clearUnownedInstallRecord(plan.agent.finalId, ["pending", "partial"], options);
    if (error instanceof GroveAddMutationError) {
      throw error;
    }
    throw new GroveAddMutationError(
      "workspace_parent_failed",
      `Could not inspect workspace ${JSON.stringify(workspace)}: ${(error as Error).message}`,
    );
  }

  if (!workspacePhaseRecorded && workspaceState) {
    markInstallStatus(plan.agent.finalId, "partial", ["pending", "partial"], options);
    return partialResult({
      workspaceCreated: false,
      configCommitted: false,
      packages: [],
      error: {
        code: "workspace_collision",
        message: `Workspace ${JSON.stringify(workspace)} was created after planning.`,
      },
      nowMs: options.nowMs,
    });
  }
  if (workspaceState && !workspaceState.isDirectory()) {
    throw new GroveAddMutationError(
      "workspace_collision",
      `Workspace ${JSON.stringify(workspace)} is no longer a directory.`,
    );
  }

  workspaceCreated = workspaceState?.isDirectory() ?? false;
  configCommitted = statusAtLeast(installRecord.status, "config_committed");
  const installPackages = options.installPackages ?? installClawPackages;
  const preserveRecordedPhaseOrMarkPartial = (): GroveInstallStatus => {
    if (workspacePhaseRecorded) {
      return installRecord.status;
    }
    markInstallStatus(plan.agent.finalId, "partial", ["pending", "partial"], options);
    return "partial";
  };

  const hostRequirementPlan = planWithPackageActions(
    plan,
    (action) => action.details?.kind === "plugin",
  );
  const hostRequirementActions = hostRequirementPlan.actions.filter(
    (action) => action.kind === "package",
  );
  if (hostRequirementActions.length > 0) {
    try {
      packages = await installPackages(hostRequirementPlan, options);
    } catch (error) {
      const packageError = error instanceof ClawPackageInstallError ? error : undefined;
      const installStatus = preserveRecordedPhaseOrMarkPartial();
      return partialResult({
        packages: packageError?.installedPackages ?? packages,
        installStatus,
        error: {
          code: packageError?.code ?? "package_install_failed",
          message: packageError?.message ?? coerceErrorMessage(error),
        },
        nowMs: options.nowMs,
      });
    }
  }

  try {
    assertWorkspacePathUnchanged(workspace);
    await mkdir(dirname(workspace), { recursive: true });
    assertWorkspacePathUnchanged(workspace);
  } catch (error) {
    if (packages.length > 0) {
      const installStatus = preserveRecordedPhaseOrMarkPartial();
      return partialResult({
        installStatus,
        error: {
          code: error instanceof GroveAddMutationError ? error.code : "workspace_parent_failed",
          message:
            error instanceof GroveAddMutationError
              ? error.message
              : `Could not create parent directory for workspace ${JSON.stringify(workspace)}: ${(error as Error).message}`,
        },
        nowMs: options.nowMs,
      });
    }
    clearUnownedInstallRecord(plan.agent.finalId, ["pending", "partial"], options);
    if (error instanceof GroveAddMutationError) {
      throw error;
    }
    throw new GroveAddMutationError(
      "workspace_parent_failed",
      `Could not create parent directory for workspace ${JSON.stringify(workspace)}: ${(error as Error).message}`,
    );
  }

  if (!workspaceCreated) {
    try {
      await mkdir(workspace);
      workspaceCreated = true;
    } catch (error) {
      markInstallStatus(plan.agent.finalId, "partial", ["pending", "partial"], options);
      return partialResult({
        workspaceCreated: false,
        configCommitted: false,
        error: {
          code: "workspace_collision",
          message: `Could not create new workspace ${JSON.stringify(workspace)}: ${(error as Error).message}`,
        },
        nowMs: options.nowMs,
      });
    }

    try {
      if (!workspacePhaseRecorded) {
        markInstallStatus(
          plan.agent.finalId,
          "workspace_ready",
          ["pending", "partial", "workspace_ready"],
          options,
        );
      }
    } catch (error) {
      const removedWorkspace = await rmdir(workspace)
        .then(() => true)
        .catch(() => false);
      if (removedWorkspace) {
        try {
          clearUnownedInstallRecord(plan.agent.finalId, ["pending", "partial"], options);
        } catch {
          // Preserve the phase-write failure if the unowned attempt cannot be reconciled.
        }
      }
      throw new GroveAddMutationError("provenance_failed", (error as Error).message);
    }
  }

  // Seed and attest the consented package bootstrap while the workspace is still
  // private. Committing the agent config first makes the agent routable, so a
  // concurrent `sessions.create` can stock-seed BOOTSTRAP.md and strand the add at
  // `config_committed` with a seed conflict that no retry can clear.
  try {
    await (options.seedPackageBootstrap ?? seedClawPackageBootstrap)(plan, {
      ...options,
      ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    });
  } catch (error) {
    const installStatus: GroveInstallStatus = configCommitted
      ? "config_committed"
      : "workspace_ready";
    markInstallStatus(
      plan.agent.finalId,
      installStatus,
      configCommitted ? ["config_committed"] : ["workspace_ready", "config_committed"],
      options,
    );
    return partialResult({
      installStatus,
      error: {
        code: error instanceof GroveBootstrapWriteError ? error.code : "bootstrap_write_failed",
        message: coerceErrorMessage(error),
      },
      nowMs: options.nowMs,
    });
  }

  try {
    const commit: ConfigCommit =
      options.commitConfig ??
      (async (transform) => {
        await transformConfigFileWithRetry({
          afterWrite: { mode: "auto" },
          transform: (config) => ({ nextConfig: transform(config) }),
        });
      });
    await commit((config) => {
      const existingAgents = listAgentEntries(config);
      const agentsToPreserve: AgentConfig[] =
        existingAgents.length > 0 ? existingAgents : [{ id: DEFAULT_AGENT_ID }];
      const configWithPreservedAgents: BranchConfig = {
        ...config,
        agents: {
          ...config.agents,
          entries: toAgentEntriesRecord(agentsToPreserve),
        },
      };
      const normalizedAgentId = normalizeAgentId(plan.agent.finalId);
      const existingAgent = agentsToPreserve.find(
        (agent) => normalizeAgentId(agent.id) === normalizedAgentId,
      );
      if (existingAgent) {
        if (sameCommittedAgent(existingAgent, plan)) {
          return config;
        }
        const nextConfig = replaceLegacyCommittedAgent({
          config: configWithPreservedAgents,
          agents: agentsToPreserve,
          normalizedAgentId,
          plan,
          resumePlan: options.resumePlan,
          resumeRecord: options.resumeRecord,
          matchesPlan: sameCommittedAgent,
        });
        if (nextConfig) {
          return nextConfig;
        }
        throw new GroveAddMutationError(
          "agent_id_collision",
          "Agent " + JSON.stringify(plan.agent.finalId) + " was created after planning.",
        );
      }
      if (
        findOverlappingWorkspaceAgentIds(configWithPreservedAgents, plan.agent.finalId, workspace)
          .length > 0
      ) {
        throw new GroveAddMutationError(
          "workspace_collision",
          "Workspace " + JSON.stringify(workspace) + " is already assigned to an agent.",
        );
      }
      const nextConfig = applyAgentConfig(configWithPreservedAgents, {
        agentId: normalizedAgentId,
      });
      return {
        ...nextConfig,
        agents: {
          ...nextConfig.agents,
          entries: {
            ...nextConfig.agents?.entries,
            ...toAgentEntriesRecord([plan.agent.config]),
          },
        },
      };
    });
    // The transform runs before persistence can still fail; record the fact only after commit.
    // Moving this into the callback retains the workspace and reports a write that never landed.
    configCommitted = true;
    try {
      recordAgentProvenance(plan.agent.finalId, { createdVia: "grove" }, options);
    } catch (error) {
      throw new GroveAddMutationError("provenance_failed", coerceErrorMessage(error));
    }
    if (options.resumePlan && installRecord.schemaVersion === "branch.groveInstallRecord.v1") {
      installRecord = persistRecord(plan, {
        ...options,
        status: "pending",
        expectedExistingRecord: options.resumeRecord,
        expectedExistingPlan: options.resumePlan,
      });
    }
    markInstallStatus(
      plan.agent.finalId,
      "config_committed",
      ["workspace_ready", "config_committed"],
      options,
    );
  } catch (error) {
    let installStatus: GroveInstallStatus = "workspace_ready";
    if (!configCommitted) {
      const removedWorkspace = await rmdir(workspace)
        .then(() => true)
        .catch(() => false);
      if (removedWorkspace) {
        workspaceCreated = false;
        installStatus = "partial";
        markInstallStatus(plan.agent.finalId, "partial", ["workspace_ready", "partial"], options);
      }
    }
    return partialResult({
      installStatus,
      error: {
        code: error instanceof GroveAddMutationError ? error.code : "config_commit_failed",
        message: coerceErrorMessage(error),
      },
      nowMs: options.nowMs,
    });
  }

  const createFiles = options.createWorkspaceFiles ?? createGroveWorkspaceFiles;
  try {
    workspaceFiles = await createFiles(plan, options);
  } catch (error) {
    const workspaceError =
      error instanceof GroveWorkspaceWriteError
        ? error
        : new GroveWorkspaceWriteError(
            [
              {
                level: "error",
                code: "workspace_file_io_error",
                phase: "mutation",
                path: "$.workspace",
                message: coerceErrorMessage(error),
              },
            ],
            workspaceFiles,
          );
    markInstallStatus(plan.agent.finalId, "config_committed", ["config_committed"], options);
    return partialResult({
      workspaceFiles: workspaceError.createdFiles,
      installStatus: "config_committed",
      nowMs: options.nowMs,
      error: {
        code: "workspace_files_failed",
        message: workspaceError.message,
        diagnostics: workspaceError.diagnostics,
      },
    });
  }

  try {
    // Skills require their workspace. Recurring work is enabled only after all
    // package mutation succeeds.
    const workspacePackagePlan = planWithPackageActions(
      plan,
      (action) => action.details?.kind !== "plugin",
    );
    const workspacePackageActions = workspacePackagePlan.actions.filter(
      (action) => action.kind === "package",
    );
    if (workspacePackageActions.length > 0) {
      const workspacePackages = await installPackages(workspacePackagePlan, options);
      packages = [...packages, ...workspacePackages];
    }
  } catch (error) {
    const packageError = error instanceof ClawPackageInstallError ? error : undefined;
    return partialResult({
      packages: [...packages, ...(packageError?.installedPackages ?? [])],
      installStatus: "config_committed",
      error: {
        code: packageError?.code ?? "package_install_failed",
        message: packageError?.message ?? coerceErrorMessage(error),
      },
      nowMs: options.nowMs,
    });
  }

  const installMcpServers = options.installMcpServers ?? installGroveMcpServers;
  try {
    mcpServers = await installMcpServers(plan, options);
  } catch (error) {
    const mcpError = error instanceof GroveMcpInstallError ? error : undefined;
    markInstallStatus(plan.agent.finalId, "config_committed", ["config_committed"], options);
    return partialResult({
      mcpServers: mcpError?.mcpServers ?? mcpServers,
      installStatus: "config_committed",
      error: {
        code: mcpError?.code ?? "mcp_install_failed",
        message: mcpError?.message ?? coerceErrorMessage(error),
      },
      nowMs: options.nowMs,
    });
  }

  const installCronJobs = options.installCronJobs ?? installGroveCronJobs;
  try {
    cronJobs = await installCronJobs(plan, { ...options, gateway: options.cronGateway });
  } catch (error) {
    const cronError = error instanceof GroveCronInstallError ? error : undefined;
    markInstallStatus(plan.agent.finalId, "config_committed", ["config_committed"], options);
    return partialResult({
      cronJobs: cronError?.cronJobs ?? cronJobs,
      installStatus: "config_committed",
      error: {
        code: cronError?.code ?? "cron_install_failed",
        message: cronError?.message ?? coerceErrorMessage(error),
      },
      nowMs: options.nowMs,
    });
  }

  try {
    markInstallStatus(plan.agent.finalId, "complete", ["config_committed", "complete"], options);
    return {
      schemaVersion: GROVE_ADD_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      dryRun: false,
      mutationAllowed: true,
      planIntegrity: plan.planIntegrity,
      status: "complete",
      grove: plan.grove,
      agent: plan.agent,
      workspaceCreated,
      configCommitted,
      packages,
      mcpServers,
      cronJobs,
      workspaceFiles,
      installRecord: {
        ...installRecord,
        status: "complete",
        updatedAtMs: options.nowMs ?? Date.now(),
      },
    };
  } catch (error) {
    return partialResult({
      error: { code: "provenance_failed", message: (error as Error).message },
    });
  }
}

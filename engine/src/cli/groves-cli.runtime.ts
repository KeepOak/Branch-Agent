import { redactSensitiveUrlLikeString } from "@branch/net-policy/redact-sensitive-url";
import { filterStringEntries, stableStringify } from "@branch/normalization-core";
import {
  listAgentEntries,
  listAgentIds,
  resolveAgentWorkspaceDir,
} from "../agents/agent-scope-config.js";
import {
  applyGroveAddPlan,
  GROVE_ADD_RESULT_SCHEMA_VERSION,
  GroveAddMutationError,
} from "../groves/add.js";
import {
  findGroveExtensionPackageCollisions,
  planGroveExtensions,
} from "../groves/application-plan.js";
import { assertExperimentalGrovesEnabled } from "../groves/experimental.js";
import {
  GROVE_EXPORT_RESULT_SCHEMA_VERSION,
  GroveExportError,
  exportGroveAgent,
} from "../groves/export.js";
import {
  applyGroveRemovePlan,
  buildGroveRemovePlan,
  GROVE_REMOVE_PLAN_SCHEMA_VERSION,
  GROVE_REMOVE_RESULT_SCHEMA_VERSION,
  GroveRemoveError,
  readGroveStatus,
} from "../groves/lifecycle-state.js";
import { buildGroveAddPlan } from "../groves/lifecycle.js";
import {
  findResumableIntroducedPluginRequirement,
  readGroveResumeStateReadOnly,
} from "../groves/package-resume.js";
import { preflightClawPackage } from "../groves/packages.js";
import {
  groveInstallRecordMatchesPlan,
  readGroveInstallRecord,
  readClawPackageRefs,
  type PersistedGroveInstall,
} from "../groves/provenance.js";
import { readGroveManifestFile } from "../groves/reader.js";
import {
  GROVE_INSPECT_RESULT_SCHEMA_VERSION,
  GROVE_ADD_PLAN_SCHEMA_VERSION,
  GROVE_OUTPUT_STABILITY,
  type GroveAddPlan,
} from "../groves/types.js";
import { getRuntimeConfig } from "../config/config.js";
import { listConfiguredMcpServers } from "../config/mcp-config.js";
import { redactSensitiveArgv } from "../config/redact-argv.js";
import {
  loadCronJobsStoreWithConfigJobsReadOnly,
  resolveCronJobsStorePath,
} from "../cron/store.js";
import { redactSensitiveText } from "../logging/redact.js";
import { defaultRuntime, writeRuntimeJson, type RuntimeEnv } from "../runtime.js";
import { authorizeLegacyV1Resume } from "./groves-cli-legacy-resume.js";
import {
  emitGroveFailure,
  formatClawDiagnostics,
  logGroveAgentConfiguration,
  logGroveExperimentalWarning,
} from "./groves-cli-output.js";
import { waitUntilGatewayAgentAvailable } from "./groves-cli.gateway-readiness.js";
import type {
  GrovesAddOptions,
  GrovesExportOptions,
  GrovesInspectOptions,
  GrovesRemoveOptions,
  GrovesStatusOptions,
} from "./groves-cli.js";
import { groveMonitorCleanupGateway } from "./groves-cli.monitor-cleanup.js";
import { clawPackageRemovalGateway } from "./groves-cli.package-removal.js";
import { listCronJobsFromGateway } from "./cron-cli/list-jobs.js";
import { callGatewayFromCli } from "./gateway-rpc.js";
import { resolvePluginBatchReload } from "./plugins-lifecycle-client.js";

function logGroveAddPlanSummary(plan: GroveAddPlan, runtime: RuntimeEnv): void {
  runtime.log(`Agent: ${plan.agent.finalId}`);
  runtime.log(`Workspace: ${plan.agent.workspace}`);
  logGroveAgentConfiguration(plan, runtime);
  runtime.log(`Actions: ${plan.summary.totalActions}`);
  runtime.log(`Packages: ${plan.summary.packageActions}`);
  for (const action of plan.actions.filter((candidate) => candidate.kind === "package")) {
    const requirementState =
      typeof action.details?.requirementState === "string"
        ? action.details.requirementState
        : "unresolved";
    runtime.log(
      `  Requirement ${action.target}: ${requirementState}${action.action === "install" ? " (installation requires this exact plan consent)" : ""}`,
    );
  }
  runtime.log(`MCP servers: ${plan.summary.mcpServerActions}`);
  for (const action of plan.actions.filter((candidate) => candidate.kind === "mcpServer")) {
    const server = action.details as Record<string, unknown> | undefined;
    const target =
      typeof server?.url === "string"
        ? redactSensitiveUrlLikeString(server.url)
        : typeof server?.command === "string"
          ? redactSensitiveArgv([server.command, ...filterStringEntries(server.args)]).join(" ")
          : "invalid declaration";
    runtime.log(`  MCP ${action.id}: ${target}`);
  }
  runtime.log(`Cron jobs: ${plan.summary.cronJobActions}`);
  if (plan.capabilityChanges.length > 0) {
    runtime.log(`Capability escalations (${plan.capabilityChanges.length}):`);
    for (const change of plan.capabilityChanges) {
      runtime.log(
        redactSensitiveText(`  ! ${change.kind}:${change.id} ${JSON.stringify(change.effect)}`),
      );
    }
    runtime.log("The plan integrity binds every capability line above.");
  }
  if (plan.summary.blockedActions > 0) {
    runtime.log(`Blocked actions: ${plan.summary.blockedActions}`);
  }
}

async function matchingResumeState(plan: GroveAddPlan, opts: GrovesAddOptions) {
  const readOnlyState = opts.dryRun
    ? await readGroveResumeStateReadOnly(plan.agent.finalId)
    : undefined;
  const record = opts.dryRun ? readOnlyState?.record : readGroveInstallRecord(plan.agent.finalId);
  if (
    !record ||
    record.status === "complete" ||
    record.workspace !== plan.agent.workspace ||
    record.grove.kind !== plan.grove.kind ||
    record.grove.name !== plan.grove.name ||
    record.grove.version !== plan.grove.version ||
    record.grove.integrity !== plan.grove.integrity
  ) {
    return undefined;
  }
  return {
    record,
    packageRefs: readOnlyState?.packageRefs ?? readClawPackageRefs({ agentId: plan.agent.finalId }),
  };
}

function requireGrovePlanConsent(
  action: "add" | "remove",
  opts: GrovesAddOptions | GrovesRemoveOptions,
  runtime: RuntimeEnv,
): boolean {
  if (opts.dryRun || (opts.yes && opts.planIntegrity)) {
    return false;
  }
  const code = opts.yes ? "plan_integrity_required" : "consent_required";
  const message = opts.yes
    ? `Grove ${action} consent must include --plan-integrity from the exact dry-run plan.`
    : `Grove ${action} requires explicit consent; pass --dry-run to preview or --yes with --plan-integrity to ${action === "add" ? "create the new agent and workspace" : "remove owned state"}.`;
  emitGroveFailure(runtime, opts.json, message, {
    schemaVersion:
      action === "add" ? GROVE_ADD_PLAN_SCHEMA_VERSION : GROVE_REMOVE_PLAN_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    ok: false,
    error: { code, message },
  });
  return true;
}

export async function runGrovesInspectCommand(
  sourcePath: string,
  opts: GrovesInspectOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  const result = await readGroveManifestFile(sourcePath);
  if (!result.ok) {
    emitGroveFailure(runtime, opts.json, formatClawDiagnostics(result.diagnostics), {
      schemaVersion: GROVE_INSPECT_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      valid: false,
      diagnostics: result.diagnostics,
    });
    return;
  }

  const extensionPlan = await planGroveExtensions({
    extensions: result.branchProfile?.extensions ?? [],
    workspace: result.source.packageRoot,
    packagePreflight: preflightClawPackage,
  });
  const extensionCollisions = findGroveExtensionPackageCollisions({
    packages: result.manifest.packages,
    extensions: result.branchProfile?.extensions ?? [],
  });
  const diagnostics = [
    ...result.diagnostics,
    ...extensionPlan.blockers,
    ...extensionCollisions.map(({ diagnostic }) => diagnostic),
  ];
  const valid = diagnostics.every((diagnostic) => diagnostic.level !== "error");
  const payload = {
    schemaVersion: GROVE_INSPECT_RESULT_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    valid,
    source: result.source,
    manifest: result.manifest,
    ...(result.branchProfile ? { branchProfile: result.branchProfile } : {}),
    extensions: extensionPlan.extensions,
    diagnostics,
  };
  if (opts.json) {
    writeRuntimeJson(runtime, payload);
    if (!valid) {
      runtime.exit(1);
    }
    return;
  }
  logGroveExperimentalWarning(runtime);
  runtime.log(`Grove: ${result.source.name}@${result.source.version}`);
  runtime.log(`Agent: ${result.manifest.agent.name ?? result.manifest.agent.id}`);
  runtime.log(`Packages: ${result.manifest.packages.length}`);
  runtime.log(`Extension requirements: ${extensionPlan.extensions.length}`);
  for (const extension of extensionPlan.extensions) {
    runtime.log(
      `  ${extension.id}: ${extension.requirementState}; ${extension.detectedFormat ?? "unresolved"} -> ${(extension.mapped ?? []).join(", ") || "no mapped capabilities"}`,
    );
  }
  runtime.log(`MCP servers: ${Object.keys(result.manifest.mcpServers).length}`);
  runtime.log(`Cron jobs: ${result.manifest.cronJobs.length}`);
  if (!valid) {
    runtime.error(formatClawDiagnostics(diagnostics));
    runtime.exit(1);
  }
}

export async function runGrovesAddCommand(
  sourcePath: string,
  opts: GrovesAddOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  if (requireGrovePlanConsent("add", opts, runtime)) {
    return;
  }
  let legacyV1ResumeRecord: PersistedGroveInstall | undefined;
  const result = await readGroveManifestFile(sourcePath, {
    authorizeLegacyDynamicToolProfile: ({ manifest, source }) => {
      legacyV1ResumeRecord = authorizeLegacyV1Resume({ manifest, source, opts });
      return legacyV1ResumeRecord !== undefined;
    },
  });
  if (!result.ok) {
    emitGroveFailure(runtime, opts.json, formatClawDiagnostics(result.diagnostics), {
      schemaVersion: GROVE_ADD_PLAN_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      valid: false,
      diagnostics: result.diagnostics,
    });
    return;
  }

  const config = getRuntimeConfig();
  const listedMcpServers = await listConfiguredMcpServers();
  if (!listedMcpServers.ok) {
    runtime.error(listedMcpServers.error);
    runtime.exit(1);
    return;
  }
  const existingAgentIds = listAgentIds(config);
  const existingWorkspacePaths = existingAgentIds.map((agentId) =>
    resolveAgentWorkspaceDir(config, agentId),
  );
  const cronStore = await loadCronJobsStoreWithConfigJobsReadOnly(resolveCronJobsStorePath());
  const basePlanContext = {
    config,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
    ...(opts.workspace ? { workspace: opts.workspace } : {}),
    existingAgentIds,
    existingWorkspacePaths,
    existingMcpServers: listedMcpServers.mcpServers,
    existingCronJobIds: cronStore.store.jobs.map((job) => job.id),
    packagePreflight: preflightClawPackage,
  };
  const planInput = {
    manifest: result.manifest,
    groveMarkdownBody: result.groveMarkdownBody,
    packageBootstrap: result.packageBootstrap,
    branchProfile: result.branchProfile,
    source: result.source,
    diagnostics: result.diagnostics,
  };
  let plan = await buildGroveAddPlan({ ...planInput, context: basePlanContext });
  let legacyResumePlan = result.legacyBranchProfile
    ? await buildGroveAddPlan({
        ...planInput,
        branchProfile: result.legacyBranchProfile,
        reconstructLegacyDynamicToolProfilePlan: true,
        context: basePlanContext,
      })
    : undefined;
  let resumableInstallRecord: PersistedGroveInstall | undefined;
  const resumeState = await matchingResumeState(legacyResumePlan ?? plan, opts);
  if (result.legacyBranchProfile && !resumeState) {
    plan = {
      ...plan,
      blockers: [
        ...plan.blockers,
        {
          level: "error",
          code: "grove_resume_plan_mismatch",
          phase: "plan",
          path: "$",
          message:
            "The incomplete Grove add no longer matches the previously consented plan; remove its partial state before retrying.",
        },
      ],
    };
  }
  if (resumeState) {
    const { record: resumeRecord, packageRefs: resumePackageRefs } = resumeState;
    resumableInstallRecord = resumeRecord;
    const packagePreflight = async (
      pkg: Parameters<typeof preflightClawPackage>[0],
      workspace: string,
    ) => {
      const preflight = await preflightClawPackage(pkg, workspace);
      return findResumableIntroducedPluginRequirement({
        agentId: resumeRecord.agentId,
        pkg,
        preflight,
        refs: resumePackageRefs,
      })
        ? { ...preflight, action: "install" as const }
        : preflight;
    };
    const canResumeWorkspace =
      resumeRecord.status === "workspace_ready" || resumeRecord.status === "config_committed";
    const expectedCommittedAgentConfigs = legacyResumePlan
      ? [legacyResumePlan.agent.config, plan.agent.config]
      : [plan.agent.config];
    const committedAgent = listAgentEntries(config).find(
      (agent) =>
        agent.id === resumeRecord.agentId &&
        expectedCommittedAgentConfigs.some(
          (expected) => stableStringify(agent) === stableStringify(expected),
        ),
    );
    const canResumeAgent =
      resumeRecord.status === "config_committed" ||
      (resumeRecord.status === "workspace_ready" && committedAgent !== undefined);
    const resumePlanContext = {
      ...basePlanContext,
      packagePreflight,
      existingAgentIds: canResumeAgent
        ? existingAgentIds.filter((agentId) => agentId !== resumeRecord.agentId)
        : existingAgentIds,
      existingWorkspacePaths: canResumeWorkspace
        ? existingAgentIds
            .filter((agentId) => agentId !== resumeRecord.agentId)
            .map((agentId) => resolveAgentWorkspaceDir(config, agentId))
        : existingWorkspacePaths,
      ...(canResumeWorkspace ? { resumableWorkspace: resumeRecord.workspace } : {}),
    };
    plan = await buildGroveAddPlan({ ...planInput, context: resumePlanContext });
    if (result.legacyBranchProfile) {
      legacyResumePlan = await buildGroveAddPlan({
        ...planInput,
        branchProfile: result.legacyBranchProfile,
        reconstructLegacyDynamicToolProfilePlan: true,
        context: resumePlanContext,
      });
    }
    const expectedResumePlan = legacyResumePlan ?? plan;
    const exactLegacyResume =
      !legacyResumePlan ||
      (legacyV1ResumeRecord !== undefined &&
        stableStringify(legacyV1ResumeRecord) === stableStringify(resumeRecord));
    if (
      plan.blockers.length === 0 &&
      (!exactLegacyResume || !groveInstallRecordMatchesPlan(resumeRecord, expectedResumePlan))
    ) {
      plan = {
        ...plan,
        blockers: [
          ...plan.blockers,
          {
            level: "error",
            code: "grove_resume_plan_mismatch",
            phase: "plan",
            path: "$",
            message:
              "The incomplete Grove add no longer matches the current plan; remove its partial state before retrying.",
          },
        ],
      };
    }
  }

  if (plan.blockers.length > 0) {
    if (opts.json) {
      writeRuntimeJson(runtime, plan);
    } else {
      logGroveExperimentalWarning(runtime);
      logGroveAddPlanSummary(plan, runtime);
      runtime.error(formatClawDiagnostics(plan.blockers));
    }
    runtime.exit(1);
    return;
  }

  if (opts.dryRun) {
    if (opts.json) {
      writeRuntimeJson(runtime, plan);
    } else {
      logGroveExperimentalWarning(runtime);
      runtime.log(`Grove add plan: ${plan.grove.name}@${plan.grove.version}`);
      logGroveAddPlanSummary(plan, runtime);
    }
    return;
  }

  const consentPlanIntegrity = legacyResumePlan?.planIntegrity ?? plan.planIntegrity;
  if (opts.planIntegrity !== consentPlanIntegrity) {
    const message = "The consented Grove plan no longer matches; run add --dry-run again.";
    emitGroveFailure(runtime, opts.json, message, {
      schemaVersion: GROVE_ADD_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      status: "failed",
      planIntegrity: plan.planIntegrity,
      error: { code: "plan_integrity_mismatch", message },
    });
    return;
  }

  let addResult;
  if (!opts.json) {
    logGroveExperimentalWarning(runtime);
  }
  try {
    addResult = await applyGroveAddPlan(plan, {
      reloadPlugins: await resolvePluginBatchReload(),
      consentPlanIntegrity: opts.planIntegrity,
      resumeRecord: resumableInstallRecord,
      resumePlan: legacyResumePlan,
      runtime: opts.json ? { ...runtime, log: () => undefined } : runtime,
      cronGateway: {
        add: async (input) => await callGatewayFromCli("cron.add", {}, input),
        list: async (agentId) =>
          await listCronJobsFromGateway({}, { agentId, includeDisabled: true }),
        waitUntilAgentAvailable: waitUntilGatewayAgentAvailable,
      },
    });
  } catch (error) {
    const code = error instanceof GroveAddMutationError ? error.code : "add_failed";
    const message = (error as Error).message;
    emitGroveFailure(runtime, opts.json, message, {
      schemaVersion: GROVE_ADD_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      status: "failed",
      error: { code, message },
    });
    return;
  }

  if (opts.json) {
    writeRuntimeJson(runtime, addResult);
  } else {
    runtime.log(`Added agent: ${addResult.agent.finalId}`);
    runtime.log(`Workspace: ${addResult.agent.workspace}`);
    runtime.log(`Status: ${addResult.status}`);
    if (addResult.error) {
      runtime.error(addResult.error.message);
    }
  }
  if (addResult.status !== "complete") {
    runtime.exit(1);
  }
}

export async function runGrovesStatusCommand(
  target: string | undefined,
  opts: GrovesStatusOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  const status = await readGroveStatus(target);
  if (opts.json) {
    writeRuntimeJson(runtime, status);
  } else {
    logGroveExperimentalWarning(runtime);
    runtime.log(`Installed Groves: ${status.summary.groves}`);
    for (const record of status.records) {
      runtime.log(
        `${record.install.agentId}: ${record.install.grove.name}@${record.install.grove.version} (${record.install.status})`,
      );
      runtime.log(
        `  Agent: ${record.agentState}; bootstrap: ${record.bootstrapState}; files: ${record.workspaceFiles.length}; packages: ${record.packages.length}`,
      );
    }
  }
  if (target && status.records.length === 0) {
    runtime.exit(1);
  }
}

export async function runGrovesRemoveCommand(
  target: string,
  opts: GrovesRemoveOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  if (requireGrovePlanConsent("remove", opts, runtime)) {
    return;
  }
  const selected = opts.removeReferenced ?? [];
  if (opts.removeUnused && selected.length > 0) {
    runtime.error("Choose either --remove-unused or --remove-referenced, not both.");
    runtime.exit(1);
    return;
  }
  if (opts.forceReferenced && selected.length === 0) {
    runtime.error("--force-referenced requires at least one --remove-referenced selector.");
    runtime.exit(1);
    return;
  }
  const referencedCleanup = selected.length
    ? {
        mode: "remove-selected" as const,
        selected,
        allowConflicts: Boolean(opts.forceReferenced),
      }
    : opts.removeUnused
      ? { mode: "remove-if-unused" as const }
      : { mode: "retain" as const };
  const plan = await buildGroveRemovePlan(target, {
    referencedCleanup,
    monitorGateway: groveMonitorCleanupGateway,
  });
  if (opts.dryRun || plan.blockers.length > 0) {
    if (opts.json) {
      writeRuntimeJson(runtime, plan);
    } else {
      logGroveExperimentalWarning(runtime);
      runtime.log(`Remove actions: ${plan.actions.length}`);
      runtime.log(`Plan integrity: ${plan.planIntegrity}`);
      for (const action of plan.actions.filter((candidate) => candidate.kind === "packageRef")) {
        runtime.log(
          `  Package ${action.target}: ${action.action}${action.reason ? ` (${action.reason})` : ""}`,
        );
      }
      for (const action of plan.actions.filter((candidate) => candidate.kind === "mcpServer")) {
        runtime.log(
          `  MCP ${action.id}: ${action.action}${action.reason ? ` (${action.reason})` : ""}`,
        );
      }
      if (plan.blockers.length > 0) {
        runtime.error(plan.blockers.map((blocker) => blocker.message).join("\n"));
      }
    }
    if (plan.blockers.length > 0) {
      runtime.exit(1);
    }
    return;
  }
  try {
    const result = await applyGroveRemovePlan(plan, {
      monitorGateway: groveMonitorCleanupGateway,
      packageGateway: clawPackageRemovalGateway,
      consentPlanIntegrity: opts.planIntegrity,
      referencedCleanup,
      cronGateway: {
        get: async (id) => await callGatewayFromCli("cron.get", {}, { id }),
        remove: async (id) => await callGatewayFromCli("cron.remove", {}, { id }),
      },
    });
    if (opts.json) {
      writeRuntimeJson(runtime, result);
    } else {
      logGroveExperimentalWarning(runtime);
      runtime.log(`${result.agentRemoved ? "Removed agent" : "Agent"}: ${result.agentId}`);
      runtime.log(`Status: ${result.status}`);
      for (const pkg of result.packages) {
        runtime.log(
          `  Package ${pkg.kind}:${pkg.ref}@${pkg.version}: ${pkg.action}${pkg.reason ? ` (${pkg.reason})` : ""}`,
        );
      }
      runtime.log(`Package references released: ${result.packageRefsReleased}`);
      if (result.error) {
        runtime.error(result.error.message);
      }
      for (const warning of result.warnings ?? []) {
        runtime.log(`Warning: ${warning}`);
      }
      if (result.pluginRuntime) {
        runtime.log(
          `Plugin runtime changed in Gateway generation ${result.pluginRuntime.generation}.`,
        );
      }
    }
    if (result.status !== "complete") {
      runtime.exit(1);
    }
  } catch (error) {
    const code = error instanceof GroveRemoveError ? error.code : "remove_failed";
    const message = error instanceof Error ? error.message : String(error);
    emitGroveFailure(runtime, opts.json, message, {
      schemaVersion: GROVE_REMOVE_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      status: "failed",
      error: { code, message },
    });
  }
}

export async function runGrovesExportCommand(
  agentId: string,
  opts: GrovesExportOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  try {
    const listedMcpServers = await listConfiguredMcpServers();
    if (!listedMcpServers.ok) {
      throw new GroveExportError("mcp_config_unavailable", listedMcpServers.error);
    }
    const result = await exportGroveAgent(agentId, opts.out, {
      config: getRuntimeConfig(),
      sourceMcpServers: listedMcpServers.mcpServers,
      ...(opts.bootstrap ? { bootstrapPath: opts.bootstrap } : {}),
    });
    if (opts.json) {
      writeRuntimeJson(runtime, result);
      return;
    }
    logGroveExperimentalWarning(runtime);
    runtime.log(`Exported agent: ${result.agentId}`);
    runtime.log(`Package directory: ${result.outputDirectory}`);
    runtime.log(
      `Workspace files: ${result.manifest.workspace.files.length + Object.keys(result.manifest.workspace.bootstrapFiles).length}`,
    );
    runtime.log(`Packages: ${result.manifest.packages.length}`);
    runtime.log(`Bootstrap: ${result.filesWritten.includes("BOOTSTRAP.md") ? "included" : "none"}`);
  } catch (error) {
    const code = error instanceof GroveExportError ? error.code : "export_failed";
    const message = error instanceof Error ? error.message : String(error);
    emitGroveFailure(runtime, opts.json, message, {
      schemaVersion: GROVE_EXPORT_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      status: "failed",
      error: { code, message },
    });
  }
}

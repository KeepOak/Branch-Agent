import { tempWorkspace } from "@openclaw/fs-safe/temp";
import { listAgentIds, resolveAgentWorkspaceDir } from "../agents/agent-scope-config.js";
import { assertExperimentalGrovesEnabled } from "../groves/experimental.js";
import { buildGroveAddPlan } from "../groves/lifecycle.js";
import {
  GROVE_BUILD_RESULT_SCHEMA_VERSION,
  buildGroveProject,
  extractBuiltGroveArtifact,
} from "../groves/project-build.js";
import {
  GROVE_PROJECT_RESULT_SCHEMA_VERSION,
  GroveProjectError,
  createGroveProject,
  validateGroveProject,
} from "../groves/project.js";
import { readGroveManifestFile } from "../groves/reader.js";
import { GROVE_OUTPUT_STABILITY, type GroveAddPlan } from "../groves/types.js";
import { readConfigFileSnapshot } from "../config/config.js";
import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import { resolvePreferredBranchTmpDir } from "../infra/tmp-branch-dir.js";
import { defaultRuntime, writeRuntimeJson, type RuntimeEnv } from "../runtime.js";
import {
  emitGroveFailure,
  formatClawDiagnostics,
  logGroveAgentConfiguration,
  logGroveExperimentalWarning,
} from "./groves-cli-output.js";
import type {
  GrovesBuildOptions,
  GrovesCreateOptions,
  GrovesDevOptions,
  GrovesValidateOptions,
} from "./groves-cli.js";

type PreparedDev = {
  build: Awaited<ReturnType<typeof buildGroveProject>>;
  plan: GroveAddPlan;
};

const GROVE_DEV_RESULT_SCHEMA_VERSION = "branch.clawDev.v1" as const;

function reportProjectError(
  error: unknown,
  fallbackCode: string,
  schemaVersion:
    | typeof GROVE_PROJECT_RESULT_SCHEMA_VERSION
    | typeof GROVE_BUILD_RESULT_SCHEMA_VERSION
    | typeof GROVE_DEV_RESULT_SCHEMA_VERSION,
  json: boolean | undefined,
  runtime: RuntimeEnv,
): void {
  const code = error instanceof GroveProjectError ? error.code : fallbackCode;
  const message = error instanceof Error ? error.message : String(error);
  emitGroveFailure(runtime, json, message, {
    schemaVersion,
    stability: GROVE_OUTPUT_STABILITY,
    ok: false,
    error: { code, message },
  });
}

function logDevPlanSummary(plan: GroveAddPlan, runtime: RuntimeEnv): void {
  runtime.log(`Agent: ${plan.agent.finalId}`);
  runtime.log(`Workspace: ${plan.agent.workspace}`);
  logGroveAgentConfiguration(plan, runtime);
  runtime.log(`Actions: ${plan.summary.totalActions}`);
  runtime.log(`Capability escalations: ${plan.capabilityChanges.length}`);
  runtime.log(`Blocked actions: ${plan.summary.blockedActions}`);
}

async function prepareDev(projectPath: string, opts: GrovesDevOptions): Promise<PreparedDev> {
  await using workspace = await tempWorkspace({
    rootDir: resolvePreferredBranchTmpDir(),
    prefix: "branch-grove-dev-",
  });
  const build = await buildGroveProject(projectPath, workspace.path("grove.tgz"));
  await using extracted = await extractBuiltGroveArtifact(build.artifact);
  const result = await readGroveManifestFile(extracted.packageRoot);
  if (!result.ok) {
    throw new GroveProjectError(
      "artifact_verification_failed",
      formatClawDiagnostics(result.diagnostics),
    );
  }
  const configSnapshot = await readConfigFileSnapshot({
    observe: false,
    skipPluginValidation: true,
  });
  if (!configSnapshot.valid) {
    throw new GroveProjectError(
      "config_unavailable",
      "Branch Agent config is invalid; fix it before previewing a Grove project.",
    );
  }
  const config = configSnapshot.resolved;
  const existingMcpServers = normalizeConfiguredMcpServers(config.mcp?.servers);
  const existingAgentIds = listAgentIds(config);
  const plan = await buildGroveAddPlan({
    manifest: result.manifest,
    groveMarkdownBody: result.groveMarkdownBody,
    packageBootstrap: result.packageBootstrap,
    branchProfile: result.branchProfile,
    source: {
      ...result.source,
      integrityKind: "artifact",
      integrity: build.integrity,
      byteLength: build.byteLength,
    },
    diagnostics: result.diagnostics,
    context: {
      config,
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
      ...(opts.workspace ? { workspace: opts.workspace } : {}),
      existingAgentIds,
      existingWorkspacePaths: existingAgentIds.map((agentId) =>
        resolveAgentWorkspaceDir(config, agentId),
      ),
      existingMcpServers,
      sourceReferenceRoot: `grove-artifact:${build.integrity}`,
    },
  });
  return { build, plan };
}

export async function runGrovesCreateCommand(
  projectPath: string,
  opts: GrovesCreateOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  try {
    const result = await createGroveProject(projectPath, {
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.agentId ? { agentId: opts.agentId } : {}),
    });
    if (opts.json) {
      writeRuntimeJson(runtime, {
        schemaVersion: GROVE_PROJECT_RESULT_SCHEMA_VERSION,
        stability: GROVE_OUTPUT_STABILITY,
        ok: true,
        ...result,
      });
      return;
    }
    logGroveExperimentalWarning(runtime);
    runtime.log(`Created Grove project: ${result.root}`);
    runtime.log(`Package: ${result.packageJson.name}@${result.packageJson.version}`);
  } catch (error) {
    reportProjectError(
      error,
      "project_create_failed",
      GROVE_PROJECT_RESULT_SCHEMA_VERSION,
      opts.json,
      runtime,
    );
  }
}

export async function runGrovesValidateCommand(
  projectPath: string,
  opts: GrovesValidateOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  const result = await validateGroveProject(projectPath);
  if (!result.ok) {
    emitGroveFailure(runtime, opts.json, formatClawDiagnostics(result.diagnostics), {
      schemaVersion: GROVE_PROJECT_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      ok: false,
      root: result.root,
      diagnostics: result.diagnostics,
    });
    return;
  }
  if (opts.json) {
    writeRuntimeJson(runtime, {
      schemaVersion: GROVE_PROJECT_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      ok: true,
      root: result.root,
      source: result.grove.source,
      manifest: result.grove.manifest,
      ...(result.grove.branchProfile ? { branchProfile: result.grove.branchProfile } : {}),
      excludedPaths: result.excludedPaths,
      diagnostics: result.diagnostics,
    });
    return;
  }
  logGroveExperimentalWarning(runtime);
  runtime.log(`Valid Grove project: ${result.root}`);
  runtime.log(`Package: ${result.packageJson.name}@${result.packageJson.version}`);
  for (const path of result.excludedPaths) {
    runtime.log(`Excluded: ${path}`);
  }
}

export async function runGrovesBuildCommand(
  projectPath: string,
  opts: GrovesBuildOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  try {
    const result = await buildGroveProject(projectPath, opts.out);
    if (opts.json) {
      writeRuntimeJson(runtime, { ...result, stability: GROVE_OUTPUT_STABILITY, ok: true });
      return;
    }
    logGroveExperimentalWarning(runtime);
    runtime.log(`Built Grove: ${result.grove.name}@${result.grove.version}`);
    runtime.log(`Artifact: ${result.artifact}`);
    runtime.log(`Integrity: ${result.integrity}`);
    runtime.log(`Excluded project paths: ${result.excludedPaths.length}`);
  } catch (error) {
    reportProjectError(
      error,
      "project_build_failed",
      GROVE_BUILD_RESULT_SCHEMA_VERSION,
      opts.json,
      runtime,
    );
  }
}

export async function runGrovesDevCommand(
  projectPath: string,
  opts: GrovesDevOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  assertExperimentalGrovesEnabled();
  let prepared: PreparedDev;
  try {
    prepared = await prepareDev(projectPath, opts);
  } catch (error) {
    reportProjectError(
      error,
      "project_dev_failed",
      GROVE_DEV_RESULT_SCHEMA_VERSION,
      opts.json,
      runtime,
    );
    return;
  }
  const { build, plan } = prepared;
  if (opts.json) {
    writeRuntimeJson(runtime, {
      schemaVersion: GROVE_DEV_RESULT_SCHEMA_VERSION,
      stability: GROVE_OUTPUT_STABILITY,
      offline: true,
      mutationAllowed: false,
      build: {
        integrity: build.integrity,
        byteLength: build.byteLength,
        files: build.files,
        excludedPaths: build.excludedPaths,
        grove: build.grove,
      },
      plan,
    });
  } else {
    logGroveExperimentalWarning(runtime);
    runtime.log(`Grove dev preview: ${build.grove.name}@${build.grove.version}`);
    runtime.log(`Artifact integrity: ${build.integrity}`);
    logDevPlanSummary(plan, runtime);
    if (plan.blockers.length > 0) {
      runtime.error(formatClawDiagnostics(plan.blockers));
    }
  }
  if (plan.blockers.length > 0) {
    runtime.exit(1);
  }
}

import { lstat, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { listAgentEntries, resolveAgentWorkspaceDir } from "../agents/agent-scope-config.js";
import { resolveStateDir } from "../config/paths.js";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveIdentityPathViaExistingAncestorSync } from "../infra/boundary-path.js";
import { isAvatarDataUrl } from "../shared/avatar-policy.js";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";
import { openExistingBranchStateDatabaseReadOnly } from "../state/branch-state-db.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { digestGroveBytes, digestGroveValue } from "./digest.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import { GroveMigrationError } from "./migrate-errors.js";
import {
  createGeneratedPackage,
  createPackagePreview,
  generatedPackage,
  lstatMigrationPathIfExists,
  packageIdentityDigest,
  removeGeneratedPackageIfUnchanged,
  removePackagePreview,
} from "./migrate-package.js";
import {
  assertPackageDestinationOutsideWorkspaces,
  assertWorkspaceSnapshotUnchanged,
  groveMigrationPathsOverlap,
} from "./migrate-safety.js";
import {
  inspectValueForSecret,
  normalizeWorkspaceConfig,
  resolveMigrationAgentSettings,
  validateAgentConfigKeys,
} from "./migrate-validation.js";
import { readSelectedWorkspaceFiles } from "./migrate-workspace-files.js";
import { readGroveInstallRecordFromDatabase } from "./provenance-read.kernel.js";
import { readGroveSecondaryReferenceTables } from "./provenance-secondary-references.js";
import { persistGroveMigrationOwnership, readGroveInstallRecords } from "./provenance.js";
import { readGroveManifestFile } from "./reader.js";
import { isPortableGroveAvatar } from "./schema-portability.js";
import type { GroveManifest, GroveBranchProfile } from "./types.js";
import {
  GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION,
  type PersistedGroveWorkspaceFile,
  readAllGroveWorkspaceFiles,
  readGroveWorkspaceFiles,
} from "./workspace.js";

export const GROVE_MIGRATION_PLAN_SCHEMA_VERSION = "branch.groveMigrationPlan.v1" as const;
const GROVE_MIGRATION_RESULT_SCHEMA_VERSION = "branch.groveMigrationResult.v1" as const;

const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const MIGRATION_RETAINED_PATHS = [
  "BOOTSTRAP.md (one-time workspace seed)",
  "credentials and auth state",
  "session indexes and transcripts",
  "agent databases and runtime state",
  "all other workspace files and directories",
];

type GroveMigrationPlan = {
  schemaVersion: typeof GROVE_MIGRATION_PLAN_SCHEMA_VERSION;
  stability: "experimental";
  dryRun: true;
  mutationAllowed: false;
  agentId: string;
  workspace: string;
  packageRoot: string;
  packageName: string;
  agent: GroveManifest["agent"];
  branchProfile?: GroveBranchProfile;
  generatedPackageFiles: Array<{ path: string; byteLength: number; digest: string }>;
  workspaceFiles: Array<{ path: string; byteLength: number; digest: string }>;
  retained: string[];
  planIntegrity: string;
  blockers: Array<{ code: string; path: string; message: string }>;
};

export type GroveMigrationResult = {
  schemaVersion: typeof GROVE_MIGRATION_RESULT_SCHEMA_VERSION;
  stability: "experimental";
  dryRun: false;
  status: "complete";
  agentId: string;
  workspace: string;
  packageRoot: string;
  planIntegrity: string;
};

export { GroveMigrationError } from "./migrate-errors.js";

type BuiltMigration = {
  plan: GroveMigrationPlan;
  addPlan: Awaited<ReturnType<typeof buildGroveAddPlan>>;
  manifest: GroveManifest;
  profile?: GroveBranchProfile;
  groveMarkdownBody?: Buffer;
  packageFiles: Map<string, Buffer>;
  ownershipFiles: PersistedGroveWorkspaceFile[];
};

async function readOwnership(options: BranchStateDatabaseOptions, agentId: string) {
  const database = await openExistingBranchStateDatabaseReadOnly(options);
  if (!database) {
    return {
      install: undefined,
      workspaceFiles: [],
      installs: [],
      allWorkspaceFiles: [],
      secondaryReferences: [],
    };
  }
  try {
    const db = database.db;
    const readOptions = { ...options, database, readOnly: true };
    const hasInstallTable = tableExists(db, "grove_installs");
    const hasWorkspaceFileTable = tableExists(db, "grove_workspace_files");
    return {
      install: hasInstallTable ? readGroveInstallRecordFromDatabase(db, agentId) : undefined,
      workspaceFiles: hasWorkspaceFileTable ? readGroveWorkspaceFiles(agentId, readOptions) : [],
      installs: hasInstallTable ? readGroveInstallRecords(readOptions) : [],
      allWorkspaceFiles: hasWorkspaceFileTable ? readAllGroveWorkspaceFiles(readOptions) : [],
      secondaryReferences: readGroveSecondaryReferenceTables(db, agentId),
    };
  } finally {
    database.walMaintenance.close();
  }
}

async function canonicalExistingWorkspace(path: string): Promise<string> {
  const absolute = resolve(path);
  const stat = await lstat(absolute).catch(() => undefined);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new GroveMigrationError(
      "workspace_unavailable",
      `Workspace ${JSON.stringify(absolute)} must already exist as a local directory and cannot be a symlink.`,
      "$.workspace",
    );
  }
  return await realpath(absolute);
}

function sanitizeAgentPreview(agent: GroveManifest["agent"]): GroveManifest["agent"] {
  const avatar = agent.identity?.avatar;
  if (!avatar?.startsWith("data:image/")) {
    return agent;
  }
  return {
    ...agent,
    identity: {
      ...agent.identity,
      avatar: `image data URL (${Buffer.byteLength(avatar, "utf8")} bytes; ${digestGroveBytes(Buffer.from(avatar))})`,
    },
  };
}

function buildPlanIntegrity(
  addPlan: Awaited<ReturnType<typeof buildGroveAddPlan>>,
  packageFiles: Map<string, Buffer>,
) {
  return digestGroveValue({
    schemaVersion: GROVE_MIGRATION_PLAN_SCHEMA_VERSION,
    addPlan,
    packageFiles: [...packageFiles.entries()]
      .map(([path, content]) => ({
        path,
        digest: digestGroveBytes(content),
        byteLength: content.byteLength,
      }))
      .toSorted((left, right) => left.path.localeCompare(right.path)),
    retained: MIGRATION_RETAINED_PATHS,
  });
}

function adoptMigrationActions(plan: BuiltMigration["addPlan"]): void {
  plan.actions = plan.actions.map((action) => {
    if (action.kind !== "workspaceFile" && action.kind !== "agent" && action.kind !== "workspace") {
      return action;
    }
    return {
      ...action,
      action: "reuse",
      details: {
        ...action.details,
        expectedState: action.kind === "workspaceFile" ? "present-matching" : "present",
      },
    };
  });
}

export async function buildGroveMigrationPlan(params: {
  agentId: string;
  config: BranchConfig;
  options?: BranchStateDatabaseOptions;
}): Promise<BuiltMigration> {
  const options = params.options ?? {};
  const agentId = params.agentId;
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new GroveMigrationError(
      "invalid_agent_id",
      `Agent id ${JSON.stringify(agentId)} is not a valid Grove agent id.`,
      "$.agent.id",
    );
  }
  const agents = listAgentEntries(params.config).filter((entry) => entry.id === agentId);
  if (agents.length !== 1) {
    throw new GroveMigrationError(
      agents.length === 0 ? "agent_not_found" : "agent_ambiguous",
      agents.length === 0
        ? `No configured local agent matches ${JSON.stringify(agentId)}.`
        : `More than one configured agent resolves to ${JSON.stringify(agentId)}; resolve the duplicate ownership before migrating.`,
      "$.agent.id",
    );
  }
  const agent = agents[0]!;
  validateAgentConfigKeys(agent);
  const migrationAgent = resolveMigrationAgentSettings(params.config, agent);
  const ownership = await readOwnership(options, agentId);
  if (ownership.install) {
    throw new GroveMigrationError(
      "agent_already_managed",
      `Agent ${JSON.stringify(agentId)} already has Grove ownership. Use groves status/update/remove instead of migrating it again.`,
    );
  }
  if (ownership.secondaryReferences.length > 0) {
    throw new GroveMigrationError(
      "secondary_resources_unclaimed",
      `Agent ${JSON.stringify(agentId)} has unclaimed Grove resource references in ${ownership.secondaryReferences.join(", ")}. Reconcile those resources before migrating.`,
      "$.agent.id",
    );
  }
  if (ownership.workspaceFiles.length > 0) {
    throw new GroveMigrationError(
      "workspace_ownership_unclaimed",
      `Agent ${JSON.stringify(agentId)} has Grove workspace-file ownership records without an install record. Reconcile those records before migrating.`,
      "$.workspace",
    );
  }
  const configuredWorkspace = resolveAgentWorkspaceDir(params.config, agentId, options.env);
  const workspace = await canonicalExistingWorkspace(configuredWorkspace);
  const packageRoot = resolveIdentityPathViaExistingAncestorSync(
    resolve(resolveStateDir(options.env), "groves", "local", agentId),
  );
  if (await lstatMigrationPathIfExists(packageRoot)) {
    throw new GroveMigrationError(
      "package_destination_exists",
      `Local Grove package destination ${JSON.stringify(packageRoot)} already exists. Move or inspect it before migrating.`,
      "$.packageRoot",
    );
  }
  const configuredAgents = listAgentEntries(params.config);
  assertPackageDestinationOutsideWorkspaces({
    agentId,
    packageRoot,
    workspace,
    configuredAgents,
    installs: ownership.installs,
    config: params.config,
    env: options.env,
  });
  for (const other of configuredAgents) {
    if (other.id === agentId) {
      continue;
    }
    const otherWorkspace = resolveIdentityPathViaExistingAncestorSync(
      resolveAgentWorkspaceDir(params.config, other.id, options.env),
    );
    if (groveMigrationPathsOverlap(workspace, otherWorkspace)) {
      throw new GroveMigrationError(
        "workspace_ownership_ambiguous",
        `Workspace ${JSON.stringify(workspace)} overlaps agent ${JSON.stringify(other.id)} at ${JSON.stringify(otherWorkspace)}. Resolve workspace ownership before migrating.`,
        "$.workspace",
      );
    }
  }
  const installOverlap = ownership.installs.find(
    (record) =>
      record.agentId !== agentId &&
      groveMigrationPathsOverlap(
        workspace,
        resolveIdentityPathViaExistingAncestorSync(record.workspace),
      ),
  );
  if (installOverlap) {
    throw new GroveMigrationError(
      "workspace_owned_by_grove",
      `Workspace ${JSON.stringify(workspace)} is already tracked by Grove agent ${JSON.stringify(installOverlap.agentId)}.`,
      "$.workspace",
    );
  }
  const selectedFiles = await readSelectedWorkspaceFiles(workspace);
  const selectedPaths = new Set<string>(selectedFiles.map((file) => file.name));
  const conflictingFile = ownership.allWorkspaceFiles.find(
    (file) =>
      file.agentId !== agentId &&
      resolveIdentityPathViaExistingAncestorSync(file.workspace) === workspace &&
      selectedPaths.has(file.path),
  );
  if (conflictingFile) {
    throw new GroveMigrationError(
      "workspace_file_already_owned",
      `${conflictingFile.path} is already tracked by Grove agent ${JSON.stringify(conflictingFile.agentId)}.`,
      `$.workspace.${conflictingFile.path}`,
    );
  }
  const avatar = agent.identity?.avatar?.trim();
  const portableAvatar =
    avatar && isAvatarDataUrl(avatar) && isPortableGroveAvatar(avatar) ? avatar : undefined;
  const projected = generatedPackage(agentId, {
    agent: migrationAgent,
    avatar: portableAvatar,
    files: selectedFiles,
  });
  if (inspectValueForSecret({ agent: projected.manifest.agent, profile: projected.profile })) {
    throw new GroveMigrationError(
      "agent_setting_secret_detected",
      "Potential secret material was found in a Grove v1 agent setting. The matching value was not displayed; remove it or keep the setting unmanaged.",
      "$.agent",
    );
  }
  const packagePreview = await createPackagePreview(projected.packageFiles);
  let loaded: Extract<Awaited<ReturnType<typeof readGroveManifestFile>>, { ok: true }>;
  try {
    const read = await readGroveManifestFile(packagePreview);
    if (!read.ok) {
      throw new GroveMigrationError(
        "generated_package_invalid",
        read.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
        read.diagnostics[0]?.path,
      );
    }
    loaded = read;
    const existingWorkspacePaths = configuredAgents
      .filter((entry) => entry.id !== agentId)
      .map((entry) => resolveAgentWorkspaceDir(params.config, entry.id, options.env));
    const packageIdentity = packageIdentityDigest(projected.packageFiles);
    const source = {
      ...loaded.source,
      integrity: packageIdentity.integrity,
      byteLength: packageIdentity.byteLength,
    };
    const addPlan = await buildGroveAddPlan({
      manifest: loaded.manifest,
      groveMarkdownBody: loaded.groveMarkdownBody,
      branchProfile: loaded.branchProfile,
      source,
      context: {
        config: params.config,
        agentId,
        workspace,
        existingAgentIds: configuredAgents
          .filter((entry) => entry.id !== agentId)
          .map((entry) => entry.id),
        existingWorkspacePaths,
        resumableWorkspace: workspace,
        sourceReferenceRoot: packageRoot,
      },
    });
    if (addPlan.blockers.length > 0) {
      const first = addPlan.blockers[0]!;
      throw new GroveMigrationError(first.code, first.message, first.path);
    }
    const comparablePlanAgent = normalizeWorkspaceConfig(migrationAgent, workspace);
    if (digestGroveValue(comparablePlanAgent) !== digestGroveValue(addPlan.agent.config)) {
      throw new GroveMigrationError(
        "agent_settings_not_faithful",
        "The generated Grove v1 manifest would not reproduce the configured agent settings exactly. Review unsupported fields and defaults before migrating.",
        "$.agent",
      );
    }
    for (const fileAction of addPlan.actions.filter((action) => action.kind === "workspaceFile")) {
      const name = fileAction.id;
      const captured = selectedFiles.find((file) => file.name === name);
      if (!captured || fileAction.digest !== captured.digest) {
        throw new GroveMigrationError(
          "workspace_file_projection_changed",
          `The Grove package would not preserve the exact bytes of ${JSON.stringify(name)}.`,
          `$.workspace.${name}`,
        );
      }
    }
    adoptMigrationActions(addPlan);
    const planIntegrity = buildPlanIntegrity(addPlan, projected.packageFiles);
    addPlan.planIntegrity = planIntegrity;
    const plan: GroveMigrationPlan = {
      schemaVersion: GROVE_MIGRATION_PLAN_SCHEMA_VERSION,
      stability: "experimental",
      dryRun: true,
      mutationAllowed: false,
      agentId,
      workspace,
      packageRoot,
      packageName: source.name,
      agent: projected.manifest.agent,
      ...(projected.profile ? { branchProfile: projected.profile } : {}),
      generatedPackageFiles: [...projected.packageFiles.entries()]
        .map(([path, content]) => ({
          path,
          byteLength: content.byteLength,
          digest: digestGroveBytes(content),
        }))
        .toSorted((left, right) => left.path.localeCompare(right.path)),
      workspaceFiles: selectedFiles.map(({ name, content, digest }) => ({
        path: resolve(workspace, name),
        byteLength: content.byteLength,
        digest,
      })),
      retained: [...MIGRATION_RETAINED_PATHS],
      planIntegrity,
      blockers: [],
    };
    const ownershipFiles = addPlan.actions
      .filter((action) => action.kind === "workspaceFile")
      .map((action) => {
        const sourcePath = action.source
          ? relative(plan.packageRoot, action.source).replaceAll(sep, "/")
          : "";
        const path = relative(workspace, action.target).replaceAll(sep, "/");
        if (!sourcePath || path.startsWith("../") || sourcePath.startsWith("../")) {
          throw new GroveMigrationError(
            "migration_path_invalid",
            `Could not bind ${JSON.stringify(action.id)} to the generated local package.`,
            `$.workspace.${action.id}`,
          );
        }
        return {
          schemaVersion: GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION,
          agentId,
          workspace,
          path,
          sourcePath,
          contentDigest: action.digest!,
          status: "complete" as const,
          createdAtMs: 0,
          updatedAtMs: 0,
        };
      });
    return {
      plan: {
        ...plan,
        agent: sanitizeAgentPreview(plan.agent),
      },
      addPlan,
      manifest: loaded.manifest,
      ...(loaded.branchProfile ? { profile: loaded.branchProfile } : {}),
      ...(loaded.groveMarkdownBody ? { groveMarkdownBody: loaded.groveMarkdownBody } : {}),
      packageFiles: projected.packageFiles,
      ownershipFiles,
    };
  } finally {
    await removePackagePreview(packagePreview);
  }
}

export async function applyGroveMigrationPlan(params: {
  migration: BuiltMigration;
  config: BranchConfig;
  options?: BranchStateDatabaseOptions;
  assertCurrentConfig?: () => Promise<void>;
}): Promise<GroveMigrationResult> {
  const options = params.options ?? {};
  const root = params.migration.plan.packageRoot;
  const currentWorkspace = await canonicalExistingWorkspace(
    resolveAgentWorkspaceDir(params.config, params.migration.plan.agentId, options.env),
  );
  if (currentWorkspace !== params.migration.plan.workspace) {
    throw new GroveMigrationError(
      "migration_changed",
      "The configured workspace changed after consent. Rerun migrate and review the new plan.",
    );
  }
  const currentOwnership = await readOwnership(options, params.migration.plan.agentId);
  if (currentOwnership.secondaryReferences.length > 0) {
    throw new GroveMigrationError(
      "secondary_resources_unclaimed",
      `Agent ${JSON.stringify(params.migration.plan.agentId)} now has unclaimed Grove resource references in ${currentOwnership.secondaryReferences.join(", ")}; rerun migrate after reconciling them.`,
      "$.agent.id",
    );
  }
  assertPackageDestinationOutsideWorkspaces({
    agentId: params.migration.plan.agentId,
    packageRoot: root,
    workspace: currentWorkspace,
    configuredAgents: listAgentEntries(params.config),
    installs: currentOwnership.installs,
    config: params.config,
    env: options.env,
  });
  if (await lstatMigrationPathIfExists(root)) {
    throw new GroveMigrationError(
      "package_destination_exists",
      `Generated package destination ${JSON.stringify(root)} appeared after planning; rerun migrate to review a fresh plan.`,
      "$.packageRoot",
    );
  }
  await params.assertCurrentConfig?.();
  await createGeneratedPackage(root, params.migration.packageFiles);
  try {
    await assertWorkspaceSnapshotUnchanged(
      currentWorkspace,
      params.migration.ownershipFiles,
      readSelectedWorkspaceFiles,
    );
    const read = await readGroveManifestFile(root);
    if (!read.ok) {
      throw new GroveMigrationError(
        "generated_package_invalid",
        read.diagnostics.map((diagnostic) => diagnostic.message).join("; "),
      );
    }
    const identity = packageIdentityDigest(params.migration.packageFiles);
    const source = {
      ...read.source,
      integrity: identity.integrity,
      byteLength: identity.byteLength,
    };
    const finalPlan = await buildGroveAddPlan({
      manifest: read.manifest,
      groveMarkdownBody: read.groveMarkdownBody,
      branchProfile: read.branchProfile,
      source,
      context: {
        config: params.config,
        agentId: params.migration.plan.agentId,
        workspace: params.migration.plan.workspace,
        existingAgentIds: listAgentEntries(params.config)
          .filter((entry) => entry.id !== params.migration.plan.agentId)
          .map((entry) => entry.id),
        existingWorkspacePaths: listAgentEntries(params.config)
          .filter((entry) => entry.id !== params.migration.plan.agentId)
          .map((entry) => resolveAgentWorkspaceDir(params.config, entry.id, options.env)),
        resumableWorkspace: params.migration.plan.workspace,
        sourceReferenceRoot: root,
      },
    });
    for (const fileAction of finalPlan.actions.filter(
      (action) => action.kind === "workspaceFile",
    )) {
      const expected = params.migration.ownershipFiles.find((file) => file.path === fileAction.id);
      if (!expected || fileAction.digest !== expected.contentDigest) {
        throw new GroveMigrationError(
          "workspace_file_projection_changed",
          `The existing ${JSON.stringify(fileAction.id)} changed after consent. Rerun migrate to review the current file.`,
          `$.workspace.${fileAction.id}`,
        );
      }
    }
    adoptMigrationActions(finalPlan);
    const finalIntegrity = buildPlanIntegrity(finalPlan, params.migration.packageFiles);
    if (finalIntegrity !== params.migration.plan.planIntegrity) {
      throw new GroveMigrationError(
        "migration_changed",
        "The agent, workspace files, or local ownership changed after consent. The generated package was removed; rerun migrate and review the new plan.",
      );
    }
    // Consent uses a path-independent package digest. Persist the reader's actual
    // source identity so a later update of this package resolves to the same source.
    finalPlan.grove = read.source;
    finalPlan.planIntegrity = finalIntegrity;
    await assertWorkspaceSnapshotUnchanged(
      currentWorkspace,
      params.migration.ownershipFiles,
      readSelectedWorkspaceFiles,
    );
    const finalOwnershipFiles = params.migration.ownershipFiles.map((file) => ({
      ...file,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    }));
    await params.assertCurrentConfig?.();
    persistGroveMigrationOwnership(finalPlan, finalOwnershipFiles, options);
    return {
      schemaVersion: GROVE_MIGRATION_RESULT_SCHEMA_VERSION,
      stability: "experimental",
      dryRun: false,
      status: "complete",
      agentId: params.migration.plan.agentId,
      workspace: params.migration.plan.workspace,
      packageRoot: root,
      planIntegrity: finalIntegrity,
    };
  } catch (error) {
    await removeGeneratedPackageIfUnchanged(root, params.migration.packageFiles);
    throw error;
  }
}

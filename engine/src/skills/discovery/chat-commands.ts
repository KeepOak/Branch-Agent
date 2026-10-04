import fs from "node:fs";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
} from "@branch/normalization-core/string-coerce";
import { listAgentIds, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import {
  type ExecPolicyOverrides,
  type ExecSessionDefaults,
  resolveNodeExecEligibility,
} from "../../agents/exec-defaults.js";
import {
  getAgentWorkspaceAccess,
  isWorkspaceAccessUnavailableError,
} from "../../agents/workspace-access.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { logVerbose } from "../../globals.js";
import { racePromiseWithAbortSignal } from "../../infra/abort-signal.js";
import type { PluginMetadataSnapshot } from "../../plugins/plugin-metadata-snapshot.types.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import { prepareSkillBinaryProbe } from "../loading/config.js";
import { getSkillBundle } from "../loading/skill-bundles.js";
import { filterSkillEntries } from "../loading/workspace-skill-filter.js";
import { prepareWorkspaceSkillEntries } from "../loading/workspace-skill-loader.js";
import { getSkillsSourceVersion } from "../runtime/refresh-state.js";
import { prepareRemoteSkillConnections } from "../runtime/remote-skills.js";
import { getRemoteSkillEligibility } from "../runtime/remote.js";
import { composeSkillBundleInvocation } from "../runtime/skill-bundle-invocation.js";
import type { SkillBundle, SkillCommandSpec } from "../types.js";
import { resolveEffectiveAgentSkillFilter } from "./agent-filter.js";
import { listReservedChatSlashCommandNames } from "./chat-command-invocation.js";
import {
  buildWorkspaceSkillCommandSpecs,
  prepareWorkspaceSkillCommandSpecs,
} from "./command-specs.js";
export {
  expandExplicitSkillReferences,
  hasSkillReferenceCandidate,
  listReservedChatSlashCommandNames,
  resolveSkillCommandInvocation,
} from "./chat-command-invocation.js";

type WorkspaceSkillCommandParams = {
  workspaceDir: string;
  cfg: BranchConfig;
  agentId?: string;
  skillFilter?: string[];
  sessionEntry?: ExecSessionDefaults &
    Pick<SessionEntry, "skillLibrarySelections" | "skillsSnapshot" | "toolOverrides">;
  sessionKey?: string;
  execOverrides?: ExecPolicyOverrides;
  includeAllowlistHidden?: boolean;
  pluginMetadataSnapshot?: PluginMetadataSnapshot;
};

function resolveWorkspaceSkillCommandOptions(params: WorkspaceSkillCommandParams) {
  const nodeSkills = resolveNodeExecEligibility({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionEntry: params.sessionEntry,
    sessionKey: params.sessionKey,
    execOverrides: params.execOverrides,
  });
  const eligibility = {
    nodeSkills,
    remote: getRemoteSkillEligibility({ advertiseExecNode: nodeSkills.canExec }),
  };
  return {
    config: params.cfg,
    agentId: params.agentId,
    skillFilter: params.skillFilter,
    includeAllowlistHidden: params.includeAllowlistHidden,
    eligibility,
    pluginMetadataSnapshot: params.pluginMetadataSnapshot,
    librarySelections: params.sessionEntry?.skillLibrarySelections,
  };
}

type BundleInvocationParams = WorkspaceSkillCommandParams & {
  bundle: SkillBundle;
  userInstruction?: string;
  signal?: AbortSignal;
  assertCurrent?: () => void;
  skillOverrides?: Record<string, boolean>;
};

function bundleAdmissionPolicy(params: BundleInvocationParams): string {
  return JSON.stringify([
    params.cfg,
    params.skillFilter,
    params.sessionEntry,
    params.skillOverrides,
  ]);
}

function captureBundleAdmission(params: BundleInvocationParams) {
  const library = params.sessionEntry?.skillLibrarySelections?.length
    ? captureBranchStateWorkerContext()
    : undefined;
  let sourceVersion: number | undefined;
  const policy = bundleAdmissionPolicy(params);
  const assertCurrent = () => {
    params.signal?.throwIfAborted();
    params.assertCurrent?.();
    library?.maintenanceScope?.assertAdmission();
    library?.admission.assertCurrent();
    if (policy !== bundleAdmissionPolicy(params)) {
      throw new Error("Skill policy changed during bundle invocation");
    }
    if (
      sourceVersion !== undefined &&
      sourceVersion !== getSkillsSourceVersion(params.workspaceDir)
    ) {
      throw new Error("Skill sources changed during bundle invocation");
    }
  };
  return {
    assertCurrent,
    captureSource: () => {
      sourceVersion = getSkillsSourceVersion(params.workspaceDir);
    },
  };
}

async function prepareBundleMembers(
  params: BundleInvocationParams,
  admission: ReturnType<typeof captureBundleAdmission>,
) {
  const { assertCurrent } = admission;
  const options = {
    ...resolveWorkspaceSkillCommandOptions(params),
    skillFilter: params.skillFilter ?? resolveEffectiveAgentSkillFilter(params.cfg, params.agentId),
    skillOverrides:
      params.skillOverrides ??
      params.sessionEntry?.toolOverrides?.skills ??
      params.sessionEntry?.skillsSnapshot?.skillOverrides,
  };
  const sources = await prepareWorkspaceSkillEntries(params.workspaceDir, options, assertCurrent);
  admission.captureSource();
  const probe = await prepareSkillBinaryProbe(
    sources.entries,
    options,
    assertCurrent,
    sources.runtime,
  );
  assertCurrent();
  if (probe.needsRetry()) {
    throw new Error("Skill eligibility changed during bundle invocation");
  }
  const eligible = filterSkillEntries(sources.entries, {
    ...options,
    hasBin: probe.hasBin,
    platform: sources.runtime?.platform,
  });
  return { entries: sources.entries, eligible };
}

/** Reacquire the alias and native member authority; stale menus cannot supply instruction paths. */
export async function prepareSkillBundleInvocationForWorkspace(params: BundleInvocationParams) {
  const bundle = getSkillBundle(params.bundle.slug);
  if (!bundle) {
    return undefined;
  }
  const admission = captureBundleAdmission(params);
  admission.assertCurrent();
  await prepareRemoteSkillConnections();
  admission.assertCurrent();
  const members = await prepareBundleMembers(params, admission);
  return await composeSkillBundleInvocation({
    workspaceDir: params.workspaceDir,
    bundle,
    ...members,
    userInstruction: params.userInstruction,
    signal: params.signal,
    assertCurrent: admission.assertCurrent,
  });
}

// Native menus use Gateway-owned Skills only when a workspace is remote. A stopped
// binding still denotes a remote workspace; it must not expose a stale local copy.
function hasRemoteWorkspace(workspaceDir: string): boolean {
  try {
    return Boolean(getAgentWorkspaceAccess(workspaceDir, "loadSkills")?.loadSkills);
  } catch (error) {
    if (isWorkspaceAccessUnavailableError(error)) {
      return true;
    }
    throw error;
  }
}

/** Synchronous public SDK contract; remote workspace menus are deferred. */
export function listSkillCommandsForWorkspace(
  params: WorkspaceSkillCommandParams,
): SkillCommandSpec[] {
  return buildWorkspaceSkillCommandSpecs(params.workspaceDir, {
    ...resolveWorkspaceSkillCommandOptions(params),
    reservedNames: listReservedChatSlashCommandNames(),
    gatewayOnly: hasRemoteWorkspace(params.workspaceDir),
  });
}

export async function prepareSkillCommandsForWorkspace(
  params: WorkspaceSkillCommandParams,
  assertCurrent?: () => void,
): Promise<SkillCommandSpec[]> {
  assertCurrent?.();
  await prepareRemoteSkillConnections();
  assertCurrent?.();
  const commands = await prepareWorkspaceSkillCommandSpecs(
    params.workspaceDir,
    {
      ...resolveWorkspaceSkillCommandOptions(params),
      reservedNames: listReservedChatSlashCommandNames(),
    },
    assertCurrent,
  );
  assertCurrent?.();
  return commands;
}

/** Resolve Gateway-bundled commands with the active Harness eligibility checks. */
export async function prepareBundledSkillCommandForWorkspace(
  params: WorkspaceSkillCommandParams & { skillName: string },
): Promise<SkillCommandSpec | undefined> {
  await prepareRemoteSkillConnections();
  const commands = await prepareWorkspaceSkillCommandSpecs(params.workspaceDir, {
    ...resolveWorkspaceSkillCommandOptions(params),
    reservedNames: listReservedChatSlashCommandNames(),
    bundledSkillName: params.skillName,
  });
  return commands.find(
    (command) =>
      command.skillSource === "bundled" &&
      command.skillName.trim().toLowerCase() === params.skillName.trim().toLowerCase(),
  );
}

function dedupeBySkillName(commands: SkillCommandSpec[]): SkillCommandSpec[] {
  const seen = new Set<string>();
  return commands.filter((cmd) => {
    const key = normalizeOptionalLowercaseString(cmd.skillName);
    if (key && seen.has(key)) {
      return false;
    }
    if (key) {
      seen.add(key);
    }
    return true;
  });
}

type AgentSkillCommandParams = {
  cfg: BranchConfig;
  agentIds?: string[];
  sessionEntry?: ExecSessionDefaults &
    Pick<SessionEntry, "skillLibrarySelections" | "skillsSnapshot">;
  sessionKey?: string;
  execOverrides?: ExecPolicyOverrides;
};

function* resolveAgentSkillCommandWorkspaces(params: AgentSkillCommandParams, allowRemote = false) {
  const agentIds = params.agentIds ?? listAgentIds(params.cfg);
  const hasSingleAgentContext = agentIds.length === 1;
  const workspaceAgents: Array<{
    agentId: string;
    workspaceDir: string;
    skillFilter?: string[];
    gatewayOnly: boolean;
  }> = [];
  for (const agentId of agentIds) {
    const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
    const remote = allowRemote
      ? Boolean(getAgentWorkspaceAccess(workspaceDir, "loadSkills")?.loadSkills)
      : hasRemoteWorkspace(workspaceDir);
    if (!remote) {
      if (!fs.existsSync(workspaceDir)) {
        logVerbose(`Skipping agent "${agentId}": workspace does not exist: ${workspaceDir}`);
        continue;
      }
      try {
        fs.realpathSync(workspaceDir);
      } catch {
        logVerbose(`Skipping agent "${agentId}": cannot resolve workspace: ${workspaceDir}`);
        continue;
      }
    }
    workspaceAgents.push({
      agentId,
      workspaceDir,
      gatewayOnly: remote && !allowRemote,
      skillFilter: resolveEffectiveAgentSkillFilter(params.cfg, agentId),
    });
  }

  for (const { agentId, workspaceDir, skillFilter, gatewayOnly } of workspaceAgents) {
    yield {
      workspaceDir,
      options: {
        ...resolveWorkspaceSkillCommandOptions({
          cfg: params.cfg,
          agentId,
          workspaceDir,
          skillFilter,
          ...(hasSingleAgentContext
            ? {
                sessionEntry: params.sessionEntry,
                sessionKey: params.sessionKey,
                execOverrides: params.execOverrides,
              }
            : {}),
        }),
        gatewayOnly,
      },
    };
  }
}

function appendSkillCommands(
  entries: SkillCommandSpec[],
  used: Set<string>,
  commands: SkillCommandSpec[],
) {
  for (const command of commands) {
    used.add(normalizeLowercaseStringOrEmpty(command.name));
    entries.push(command);
  }
}

function finalizeSkillCommands(entries: SkillCommandSpec[]) {
  return dedupeBySkillName(entries).toSorted((left, right) =>
    left.skillName.localeCompare(right.skillName, "en"),
  );
}

/** Synchronous public SDK contract for native command consumers. */
export function listSkillCommandsForAgents(params: AgentSkillCommandParams): SkillCommandSpec[] {
  const used = listReservedChatSlashCommandNames();
  const entries: SkillCommandSpec[] = [];
  for (const { workspaceDir, options } of resolveAgentSkillCommandWorkspaces(params)) {
    appendSkillCommands(
      entries,
      used,
      buildWorkspaceSkillCommandSpecs(workspaceDir, {
        ...options,
        reservedNames: used,
      }),
    );
  }
  return finalizeSkillCommands(entries);
}

export async function prepareSkillCommandsForAgents(
  params: AgentSkillCommandParams & { signal?: AbortSignal },
): Promise<SkillCommandSpec[]> {
  params.signal?.throwIfAborted();
  await prepareRemoteSkillConnections();
  params.signal?.throwIfAborted();
  const used = listReservedChatSlashCommandNames();
  const entries: SkillCommandSpec[] = [];
  for (const { workspaceDir, options } of resolveAgentSkillCommandWorkspaces(params, true)) {
    const commands = await racePromiseWithAbortSignal(
      prepareWorkspaceSkillCommandSpecs(workspaceDir, {
        ...options,
        reservedNames: used,
      }),
      params.signal,
    );
    params.signal?.throwIfAborted();
    appendSkillCommands(entries, used, commands);
  }
  return finalizeSkillCommands(entries);
}

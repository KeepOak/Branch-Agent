// The contactless first-run profile has no roster. Its onboarding Trunk is the
// implicit main agent (shown as Sapling). Grove installs already keep that agent
// when they append another one (engine/src/groves/add.ts). Creation and startup
// do the same, and a later Trunk must not take the slot.
import fs from "node:fs";
import path from "node:path";
import { applyAgentConfig } from "../commands/agents.config.js";
import { readConfigFileSnapshotForWrite, transformConfigFileWithRetry } from "../config/config.js";
import { resolveIsConfigReadOnly, resolveStateDir } from "../config/paths.js";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";
import type { BranchConfig } from "../config/types.branch.js";
import { LEGACY_IMPLICIT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";
import { readAgentDeletionJournal } from "../state/agent-deletion-journal.js";
import { resolveUserPath } from "../utils.js";
import { hasAgentRosterProperty, listAgentEntries } from "./agent-roster.js";
import {
  listAgentIds,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  toAgentEntriesRecord,
} from "./agent-scope-config.js";
import { resolveDefaultAgentWorkspaceDir } from "./workspace-default-path.js";

function implicitMainWorkspace(config: BranchConfig, env: NodeJS.ProcessEnv): string {
  const configured = config.agents?.defaults?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured, env);
  }
  return resolveDefaultAgentWorkspaceDir(env);
}

/** Writes the implicit onboarding Trunk into the roster without moving its files. */
export function materializeImplicitMainAgent(
  config: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): BranchConfig | undefined {
  if (hasAgentRosterProperty(config)) {
    return undefined;
  }
  if (!listAgentIds(config).includes(LEGACY_IMPLICIT_AGENT_ID)) {
    return undefined;
  }
  return applyAgentConfig(config, {
    agentId: LEGACY_IMPLICIT_AGENT_ID,
    workspace: resolveAgentWorkspaceDir(config, LEGACY_IMPLICIT_AGENT_ID, env),
    agentDir: resolveAgentDir(config, LEGACY_IMPLICIT_AGENT_ID, env),
  });
}

/** Sessions or agent state left behind when a new Trunk replaced the unpersisted slot. */
export function onboardingTrunkDiskEvidence(env: NodeJS.ProcessEnv = process.env): boolean {
  const sessionDir = resolveSessionTranscriptsDirForAgent(LEGACY_IMPLICIT_AGENT_ID, env);
  if (fs.existsSync(sessionDir)) {
    return true;
  }
  return fs.existsSync(path.join(resolveStateDir(env), "agents", LEGACY_IMPLICIT_AGENT_ID));
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/**
 * Puts the onboarding Trunk back beside whatever replaced it. Workspace paths
 * in config may be retargeted so main keeps the directory it already used.
 * Nothing on disk is moved or deleted.
 */
export function restoreDisplacedOnboardingTrunk(
  config: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): BranchConfig | undefined {
  if (!hasAgentRosterProperty(config)) {
    return undefined;
  }
  if (listAgentIds(config).includes(LEGACY_IMPLICIT_AGENT_ID)) {
    return undefined;
  }
  if (!onboardingTrunkDiskEvidence(env)) {
    return undefined;
  }
  const implicitWorkspace = implicitMainWorkspace(config, env);
  const currentEntries = listAgentEntries(config);
  const entries = currentEntries.map((entry) => {
    if (normalizeAgentId(entry.id) === LEGACY_IMPLICIT_AGENT_ID) {
      return entry;
    }
    if (!samePath(resolveAgentWorkspaceDir(config, entry.id, env), implicitWorkspace)) {
      return entry;
    }
    return { ...entry, workspace: path.join(implicitWorkspace, normalizeAgentId(entry.id)) };
  });
  const retargeted = entries.some((entry, index) => entry !== currentEntries[index])
    ? {
        ...config,
        agents: { ...config.agents, entries: toAgentEntriesRecord(entries) },
      }
    : config;
  return applyAgentConfig(retargeted, {
    agentId: LEGACY_IMPLICIT_AGENT_ID,
    workspace: implicitWorkspace,
    agentDir: resolveAgentDir(retargeted, LEGACY_IMPLICIT_AGENT_ID, env),
  });
}

function mainDeletionRecorded(env: NodeJS.ProcessEnv): boolean {
  try {
    return (
      readAgentDeletionJournal(LEGACY_IMPLICIT_AGENT_ID, { env }, "maintenance") !== undefined ||
      readAgentDeletionJournal(LEGACY_IMPLICIT_AGENT_ID, { env }, "runtime") !== undefined
    );
  } catch {
    return false;
  }
}

/** Persists the onboarding Trunk before the gateway serves sessions. */
export async function persistImplicitOnboardingTrunkAtStartup(): Promise<void> {
  if (resolveIsConfigReadOnly()) {
    return;
  }
  const { snapshot } = await readConfigFileSnapshotForWrite();
  if (!snapshot.exists) {
    return;
  }
  const env = process.env;
  const deleted = mainDeletionRecorded(env);
  const nextOf = (config: BranchConfig) =>
    materializeImplicitMainAgent(config, env) ??
    (deleted ? undefined : restoreDisplacedOnboardingTrunk(config, env));
  if (!nextOf(snapshot.config)) {
    return;
  }
  await transformConfigFileWithRetry({
    transform: (config) => ({ nextConfig: nextOf(config) ?? config }),
  });
}

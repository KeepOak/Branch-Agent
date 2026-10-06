import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { characterId } from "../agents/trunk-characters.js";
import type { BranchConfig } from "../config/types.branch.js";
import { readConfigFileSnapshotForWrite, transformConfigFileWithRetry } from "../config/config.js";
import { resolveIsConfigReadOnly } from "../config/paths.js";

const seedIdentity = { name: "C3-PO", theme: "protocol droid", emoji: "🤖" };

function isSeededDevEntry(value: unknown, characterAssignmentVersion: number | undefined): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const identity = entry.identity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return false;
  const face = identity as Record<string, unknown>;
  const untouchedIdentity = Object.keys(face).sort().join(",") === "emoji,name,theme" && face.emoji === seedIdentity.emoji;
  const assignedIdentity = characterAssignmentVersion === 1 &&
    Object.keys(face).sort().join(",") === "avatar,name,theme" &&
    typeof face.avatar === "string" && characterId(face.avatar) !== undefined;
  return Object.keys(entry).sort().join(",") === "identity,workspace" &&
    (untouchedIdentity || assignedIdentity) &&
    face.name === seedIdentity.name && face.theme === seedIdentity.theme &&
    typeof entry.workspace === "string" && /-dev[\\/]workspace[\\/]?$/.test(entry.workspace);
}

function normalWorkspace(workspace: string | undefined): string | undefined {
  return workspace?.replace(/([\\/])\.branch-dev([\\/])/, "$1.branch$2");
}

/** Only the untouched upstream seed is disposable; authored dev Trunks are retained. */
export function migrateDevAgentConfig(config: BranchConfig): BranchConfig | undefined {
  const agents = config.agents;
  const seed = agents?.entries?.dev;
  if (!agents) return undefined;
  const removeSeed = agents.defaultId !== "dev" && isSeededDevEntry(seed, agents.characterAssignmentVersion);
  const formerDefaultWorkspace = agents.defaults?.workspace;
  const migratedDefaultWorkspace = normalWorkspace(formerDefaultWorkspace);
  const entries = Object.fromEntries(Object.entries(agents.entries ?? {}).map(([id, entry]) => [
    id,
    (entry.workspace && normalWorkspace(entry.workspace) !== entry.workspace) ||
    (!entry.workspace && migratedDefaultWorkspace !== formerDefaultWorkspace)
      ? { ...entry, workspace: entry.workspace
          ? normalWorkspace(entry.workspace)
          : path.join(migratedDefaultWorkspace!, id) }
      : entry,
  ]));
  if (removeSeed) delete entries.dev;
  const defaults = { ...agents.defaults };
  defaults.workspace = migratedDefaultWorkspace;
  if (removeSeed && defaults.heartbeat?.agentId === "dev") {
    const heartbeat = { ...defaults.heartbeat };
    const fallback = agents.defaultId && entries[agents.defaultId] ? agents.defaultId : undefined;
    if (fallback) heartbeat.agentId = fallback;
    else delete heartbeat.agentId;
    defaults.heartbeat = heartbeat;
  }
  const changed = removeSeed || defaults.workspace !== agents.defaults?.workspace ||
    Object.entries(agents.entries ?? {}).some(([id, entry]) => entries[id] !== entry);
  return changed
    ? { ...config, agents: { ...agents, ownership: removeSeed && Object.keys(entries).length === 0 ? "explicit" : agents.ownership, defaults, entries: Object.keys(entries).length ? entries : undefined } }
    : undefined;
}

/** Back up the exact authored bytes before the one-time startup config edit. */
export async function removeSeededDevAgentAtStartup(): Promise<void> {
  if (resolveIsConfigReadOnly()) return;
  const { snapshot } = await readConfigFileSnapshotForWrite();
  if (!snapshot.exists || !migrateDevAgentConfig(snapshot.config)) return;
  const backup = `${snapshot.path}.p11-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(snapshot.path, backup, constants.COPYFILE_EXCL);
  await transformConfigFileWithRetry({
    writeOptions: { allowedAgentRosterRemovals: ["dev"] },
    transform: (config) => ({ nextConfig: migrateDevAgentConfig(config) ?? config }),
  });
}

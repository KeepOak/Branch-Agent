import path from "node:path";
import { resolveSessionStoreCompatibilityAgentId } from "../config/legacy.default-agent-owner.js";
import { resolveSessionStorePathCore } from "../config/sessions/paths.js";
import { resolveSqliteTargetFromSessionStorePath } from "../config/sessions/session-sqlite-target.js";
import type { BranchConfig } from "../config/types.branch.js";
import { isPathInside } from "../infra/path-guards.js";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { assertNoBranchAgentDatabaseLeases } from "../state/branch-agent-db-lease.js";
import { invalidateRegisteredAgentDatabasesMemo } from "../state/branch-agent-db-registry-listing.js";
import { unregisterBranchAgentDatabase } from "../state/branch-agent-db-registry.js";
import {
  closeBranchAgentDatabaseByPathAsync,
  closeBranchAgentDatabasesAsync,
  inspectBranchAgentDatabaseOwner,
  listBranchRegisteredAgentDatabases,
  resolveIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "../state/branch-agent-db.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db-contract.js";
import { findOverlappingWorkspaceAgentIds } from "./agent-delete-safety.js";
import {
  isPathOwnedByAnotherRegisteredAgent,
  normalizeAgentDirRegistryPath,
  registerResolvedAgentDir,
  resolveRegisteredAgentIdForDir,
  unregisterResolvedAgentDir,
} from "./agent-dir-registry.js";
import type { AgentDeletionOperation } from "./agent-lifecycle-registry.js";
import { listAgentIds, resolveAgentDir } from "./agent-scope.js";
import { closeAuthProfileReadPool } from "./auth-profiles/sqlite-read-pool.js";

export type AgentDeleteDatabasePlan = {
  agentDirs: string[];
  registrationPaths: string[];
  // Stale registrations can name a survivor's database; path-only readers must exclude it.
  readerPaths: string[];
  fileGroups: string[][];
  relocatedFileGroups: string[][];
};

export async function retireAgentDeleteRuntime(
  cfg: BranchConfig,
  deletion: AgentDeletionOperation,
  agentDirs: readonly string[],
): Promise<void> {
  const agentId = deletion.entry.agentId;
  const { retirePreparedModelRuntimeAgent } = await import("./prepared-model-runtime.js");
  await deletion.assertCurrentAsync();
  await retirePreparedModelRuntimeAgent({ agentId, agentDirs });
  const { closeActiveMemorySearchManagerCore } = await import("../plugins/memory-runtime.js");
  await deletion.assertCurrentAsync();
  await closeActiveMemorySearchManagerCore({ cfg, agentId });
  await deletion.assertCurrentAsync();
}

/** The purge can reopen an agent-local SQLite handle after the initial database plan closed it. */
export async function closeAgentDeleteDirectoryHandles(
  agentDir: string,
  agentId: string,
  databasePaths: readonly string[] = [],
): Promise<void> {
  await closeBranchAgentDatabasesAsync(agentDir);
  // Windows may cache the same directory under both its short and long names. Close the
  // captured exact database paths as well as handles selected by the canonical root.
  for (const databasePath of databasePaths) {
    await closeBranchAgentDatabaseByPathAsync(databasePath, agentId);
  }
  closeAuthProfileReadPool({ kind: "root", rootPath: agentDir });
}

export async function finishAgentDeleteDatabases(params: {
  deletion: AgentDeletionOperation;
  databasePlan: AgentDeleteDatabasePlan | undefined;
  agentDir: string;
  deleteFiles: boolean;
  complete: boolean;
}): Promise<void> {
  const { deletion, databasePlan, agentDir, deleteFiles, complete } = params;
  await deletion.assertCurrentAsync();
  if (!complete) {
    return;
  }
  const agentId = deletion.entry.agentId;
  unregisterResolvedAgentDir({ agentId, agentDir });
  if (deleteFiles) {
    for (const databasePath of databasePlan?.registrationPaths ?? []) {
      unregisterBranchAgentDatabase({ agentId, path: databasePath });
    }
  }
  deletion.finish();
}

/** Destructive planning includes every registered owner, regardless of runtime schema readiness. */
export function readAgentDeleteDatabaseRegistry(options: BranchStateDatabaseOptions = {}) {
  invalidateRegisteredAgentDatabasesMemo(options);
  return listBranchRegisteredAgentDatabases({
    ...options,
    includeIncompatibleSchemaVersions: true,
  });
}

export class AgentSharedStoreOwnerError extends Error {}

export function prepareJournaledAgentDirOwnership(
  cfg: BranchConfig,
  agentId: string,
  agentDir: string,
): void {
  for (const configuredAgentId of listAgentIds(cfg)) {
    resolveAgentDir(cfg, configuredAgentId);
  }
  const registeredOwner = resolveRegisteredAgentIdForDir(agentDir);
  if (registeredOwner !== undefined) {
    return;
  }
  // The durable journal retains ownership across restarts after the roster entry is gone.
  registerResolvedAgentDir({ agentId, agentDir });
}

/** Check before journaling: retaining the file alone would still fence its shared owner. */
export function assertAgentSessionStoreDeletionSafe(
  cfg: BranchConfig,
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): void {
  if (!cfg.session?.store?.trim()) {
    return;
  }
  const id = normalizeAgentId(agentId);
  const defaultAgentId = resolveSessionStoreCompatibilityAgentId(cfg);
  const registeredDatabases = readAgentDeleteDatabaseRegistry(options);
  for (const survivorId of listAgentIds(cfg)) {
    if (normalizeAgentId(survivorId) === id) {
      continue;
    }
    const storePath = resolveSessionStorePathCore(cfg.session.store, {
      agentId: survivorId,
      env: options.env,
    });
    const target = resolveSqliteTargetFromSessionStorePath(storePath, {
      agentId: survivorId,
      defaultAgentId,
      env: options.env,
      registeredDatabases,
    });
    const owner = inspectBranchAgentDatabaseOwner(target.path);
    if (owner.status === "owned" && owner.agentId === id) {
      throw new AgentSharedStoreOwnerError(
        `Agent "${id}" owns the session database still used by agent "${survivorId}" and cannot be deleted. Keep this owner configured until shared history can be moved with a supported migration; no such migration is currently available.`,
      );
    }
  }
}

export function resolveSurvivingDatabaseFilePaths(
  registeredDatabases: ReturnType<typeof listBranchRegisteredAgentDatabases>,
  agentId: string,
  env?: NodeJS.ProcessEnv,
): string[] {
  return [
    ...new Set(
      registeredDatabases
        .filter((entry) => normalizeAgentId(entry.agentId) !== agentId)
        .flatMap((entry) => resolveSqliteDatabaseFilePaths(entry.path))
        .map((pathname) => normalizeAgentDirRegistryPath(pathname, env)),
    ),
  ];
}

export function isPathOwnedBySurvivingAgent(
  cfg: BranchConfig,
  agentId: string,
  pathname: string,
  survivingDatabaseFilePaths: readonly string[] = [],
  env?: NodeJS.ProcessEnv,
): boolean {
  const canonicalPath = normalizeAgentDirRegistryPath(pathname, env);
  return (
    isPathOwnedByAnotherRegisteredAgent({ agentId, pathname, env }) ||
    findOverlappingWorkspaceAgentIds(cfg, agentId, pathname, env).length > 0 ||
    survivingDatabaseFilePaths.some(
      (databasePath) =>
        databasePath === canonicalPath ||
        isPathInside(databasePath, canonicalPath) ||
        isPathInside(canonicalPath, databasePath),
    )
  );
}

export async function prepareAgentDeleteDatabases(
  cfg: BranchConfig,
  agentId: string,
  agentDir: string,
  options: BranchStateDatabaseOptions = {},
): Promise<AgentDeleteDatabasePlan> {
  const registeredDatabases = readAgentDeleteDatabaseRegistry(options);
  const survivingDatabaseFilePaths = resolveSurvivingDatabaseFilePaths(
    registeredDatabases,
    agentId,
    options.env,
  );
  const registeredDatabasePaths = new Set([
    resolveBranchAgentSqlitePath({
      agentId,
      env: options.env,
      path: path.join(agentDir, "branch-agent.sqlite"),
    }),
    ...registeredDatabases
      .filter((entry) => normalizeAgentId(entry.agentId) === agentId)
      .map((entry) => entry.path),
  ]);
  // A surviving directory retains files, not the deleted agent's connection. Check the
  // actual cached owner so stale registration cannot close a surviving agent's handle.
  for (const databasePath of registeredDatabasePaths) {
    await closeBranchAgentDatabaseByPathAsync(databasePath, agentId);
  }
  // Incognito has no registry row or files, but retained statements must also be retired.
  await closeBranchAgentDatabaseByPathAsync(
    resolveIncognitoBranchAgentSqlitePath({ agentId, env: options.env }),
    agentId,
  );
  const databasePaths = [...registeredDatabasePaths].filter((pathname) =>
    resolveSqliteDatabaseFilePaths(pathname).every(
      (filePath) =>
        !isPathOwnedBySurvivingAgent(
          cfg,
          agentId,
          filePath,
          survivingDatabaseFilePaths,
          options.env,
        ),
    ),
  );
  for (const databasePath of databasePaths) {
    closeAuthProfileReadPool({ kind: "database", databasePath });
  }
  assertNoBranchAgentDatabaseLeases(agentId, options);
  const fileGroups = databasePaths.map(resolveSqliteDatabaseFilePaths);
  const relocatedFileGroups = fileGroups.filter((fileGroup) => {
    const relative = path.relative(agentDir, fileGroup[0] ?? agentDir);
    return relative.startsWith("..") || path.isAbsolute(relative);
  });
  return {
    agentDirs: [
      agentDir,
      ...Array.from(registeredDatabasePaths, (databasePath) => path.dirname(databasePath)),
    ],
    registrationPaths: [...registeredDatabasePaths],
    readerPaths: databasePaths,
    fileGroups,
    relocatedFileGroups,
  };
}

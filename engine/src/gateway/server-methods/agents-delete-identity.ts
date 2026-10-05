import fs from "node:fs/promises";
import path from "node:path";
import { root, FsSafeError } from "../../infra/fs-safe.js";

export type AgentCleanupPathIdentity = { dev: string; ino: string };

export class AgentCleanupIdentityMismatchError extends Error {}

export function cleanupPathIdentity(
  stat: { dev?: number | bigint; ino?: number | bigint } | undefined,
): AgentCleanupPathIdentity | null {
  if (
    (typeof stat?.dev !== "number" && typeof stat?.dev !== "bigint") ||
    (typeof stat.ino !== "number" && typeof stat.ino !== "bigint")
  ) {
    return null;
  }
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

export function persistedCleanupPathIdentity(
  dev: string | number | null,
  ino: string | number | null,
): AgentCleanupPathIdentity | null {
  return dev === null || ino === null ? null : { dev: String(dev), ino: String(ino) };
}

export async function statAgentCleanupPath(cleanupPath: {
  parentPath: string;
  trashPath: string;
  kind: "target" | "symlink";
  preparedIdentity: AgentCleanupPathIdentity | null;
}): Promise<void> {
  const parentPath = cleanupPath.parentPath;
  const parentRoot = await root(parentPath, {
    hardlinks: "reject",
    symlinks: "reject",
  });
  if (path.resolve(parentRoot.rootReal) !== parentPath) {
    throw new FsSafeError("path-mismatch", "cleanup path parent changed before deletion");
  }
  const stat = await parentRoot.stat(path.basename(cleanupPath.trashPath));
  const isSymlink = stat.isSymbolicLink;
  if (isSymlink !== (cleanupPath.kind === "symlink")) {
    throw new AgentCleanupIdentityMismatchError(
      `cleanup path changed from ${cleanupPath.kind} before deletion`,
    );
  }
  if (stat.isFile && stat.nlink > 1) {
    throw new AgentCleanupIdentityMismatchError("hardlinked cleanup replacement preserved");
  }
  const identity = cleanupPathIdentity(await fs.lstat(cleanupPath.trashPath, { bigint: true }));
  if (cleanupPath.preparedIdentity === null) {
    // The journal fence blocks legitimate claims on prepared-absent paths, so a
    // file that appeared here is leaked deleted-agent state (recreated WAL
    // sidecars, runtime home rewrites). Adopt it and sweep it; preserving it
    // cascades ancestor protection and finishes over a surviving tree.
    cleanupPath.preparedIdentity = identity;
  } else if (
    identity === null ||
    identity.dev !== cleanupPath.preparedIdentity.dev ||
    identity.ino !== cleanupPath.preparedIdentity.ino
  ) {
    throw new AgentCleanupIdentityMismatchError("cleanup path identity changed before deletion");
  }
}

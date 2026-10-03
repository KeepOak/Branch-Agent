import { executeExistingBranchStateRead } from "./branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";
import type { CachedGitHubIdentity } from "./user-profiles.types.js";

type ProfileReadOptions = Pick<BranchStateDatabaseOptions, "path" | "env">;

export async function resolveCanonicalCachedGitHubIdentity(
  params: { accountId: number; email: string },
  options: ProfileReadOptions = {},
): Promise<CachedGitHubIdentity | undefined> {
  const reply = await executeExistingBranchStateRead(options, {
    type: "userProfiles.githubIdentity.cached",
    accountId: params.accountId,
    email: params.email,
  });
  if (!reply) {
    return undefined;
  }
  if (!reply.ok || reply.type !== "userProfiles.githubIdentity.cached") {
    throw new Error("Cached GitHub identity reader returned an unexpected result");
  }
  return reply.identity;
}

export async function listProfiles(options: ProfileReadOptions = {}) {
  return (await readUserProfileSnapshot(undefined, options)).profiles;
}

export async function readUserProfileSnapshot(
  githubAccountIds?: readonly number[],
  options: ProfileReadOptions = {},
) {
  const context = captureBranchStateWorkerContext(options);
  const { executeBranchStateWorker } = await import("./branch-state-worker-store.js");
  return await executeBranchStateWorker(context, {
    type: "userProfiles.list",
    input: githubAccountIds ? { githubAccountIds } : undefined,
  });
}

/** Candidate IDs and search labels; current recipient policy remains caller-owned. */
export async function readUserProfileDirectory(limit: number, options: ProfileReadOptions = {}) {
  const context = captureBranchStateWorkerContext(options);
  const { executeBranchStateWorker } = await import("./branch-state-worker-store.js");
  return await executeBranchStateWorker(context, {
    type: "userProfiles.directory",
    input: { limit },
  });
}

import { executeExistingBranchStateRead } from "../../state/branch-state-db-readonly.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../../state/branch-state-worker-context.types.js";
import type { WorktreeRegistryListOptions } from "./registry-read.kernel.js";
import type { ManagedWorktreeRecord, ProvisionedFileState } from "./types.js";

export async function readRegistryWorktree(
  context: BranchStateWorkerContext,
  id: string,
): Promise<ManagedWorktreeRecord | undefined> {
  const { executeBranchStateWorker } = await import("../../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, { type: "worktrees.get", input: { id } });
}

export async function readRegistryWorktrees(
  env: NodeJS.ProcessEnv,
  options: WorktreeRegistryListOptions = {},
): Promise<ManagedWorktreeRecord[]> {
  const context = captureBranchStateWorkerContext({ env });
  const input = { liveOnly: options.liveOnly };
  const { executeBranchStateWorker } = await import("../../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, { type: "worktrees.list", input });
}

export async function readLiveRegistryWorktreeIds(env: NodeJS.ProcessEnv): Promise<string[]> {
  const context = captureBranchStateWorkerContext({ env });
  const { executeBranchStateWorker } = await import("../../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, { type: "worktrees.liveIds", input: undefined });
}

export async function getRegistryWorktreeProvisionedPaths(
  env: NodeJS.ProcessEnv,
  id: string,
): Promise<string[] | undefined> {
  const context = captureBranchStateWorkerContext({ env });
  const { executeBranchStateWorker } = await import("../../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, {
    type: "worktrees.provisionedPaths",
    input: { id },
  });
}

export async function getRegistryWorktreeProvisionedState(
  env: NodeJS.ProcessEnv,
  id: string,
): Promise<ProvisionedFileState[] | undefined> {
  const context = captureBranchStateWorkerContext({ env });
  const { executeBranchStateWorker } = await import("../../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, {
    type: "worktrees.provisionedState",
    input: { id },
  });
}

export async function getRegistryWorktreeProvisionedChunk(
  env: NodeJS.ProcessEnv,
  params: { worktreeId: string; path: string; chunkIndex: number },
): Promise<Uint8Array | undefined> {
  const context = captureBranchStateWorkerContext({ env });
  const input = { ...params };
  const { executeBranchStateWorker } = await import("../../state/branch-state-worker-store.js");
  return await executeBranchStateWorker(context, {
    type: "worktrees.provisionedChunk",
    input,
  });
}

export async function readWorktreeCleanupState(env: NodeJS.ProcessEnv) {
  const reply = await executeExistingBranchStateRead(
    { env },
    { type: "worktrees.cleanupState" },
    { current: true },
  );
  if (!reply) {
    return { records: [], leases: { liveScopes: [], staleScopes: [] } };
  }
  if (!reply.ok || reply.type !== "worktrees.cleanupState") {
    throw new Error("Worktree cleanup state read failed");
  }
  return reply;
}

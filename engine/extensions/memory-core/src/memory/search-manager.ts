// Memory Core owns Gateway indexes for both local and host-provided files.
import { getAgentWorkspaceAccess } from "branch/plugin-sdk/agent-workspace-runtime";
import { formatErrorMessage } from "branch/plugin-sdk/error-runtime";
import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  resolveAgentWorkspaceDir,
  resolveMemorySearchConfig,
  type BranchConfig,
} from "branch/plugin-sdk/memory-core-host-engine-foundation";
import type { MemorySearchManager } from "branch/plugin-sdk/memory-core-host-engine-storage";
import { normalizeAgentId } from "branch/plugin-sdk/routing";
import type { MemoryCoreAcquireLocalService } from "./embedding-local-service.js";

const loadManagerRuntime = createLazyRuntimeModule(() => import("../../manager-runtime.js"));

type MemorySearchManagerPurpose = "default" | "status" | "cli";
type MemorySearchManagerParams = {
  cfg: BranchConfig;
  agentId: string;
  purpose?: MemorySearchManagerPurpose;
  inspectSources?: boolean;
  acquireLocalService?: MemoryCoreAcquireLocalService;
};

type MemorySearchManagerResult = {
  manager: MemorySearchManager | null;
  error?: string;
  debug?: {
    backend: "builtin";
    purpose: MemorySearchManagerPurpose;
    managerMs: number;
  };
};

export async function getMemorySearchManager(
  params: MemorySearchManagerParams,
): Promise<MemorySearchManagerResult> {
  const startedAt = Date.now();
  let result: Omit<MemorySearchManagerResult, "debug">;
  try {
    const settings = resolveMemorySearchConfig(params.cfg, params.agentId);
    const access = settings?.sources.includes("memory")
      ? getAgentWorkspaceAccess(resolveAgentWorkspaceDir(params.cfg, params.agentId), "memoryFiles")
      : undefined;
    const { MemoryIndexManager } = await loadManagerRuntime();
    result = {
      manager: await MemoryIndexManager.get({ ...params, memoryFiles: access?.memoryFiles }),
    };
  } catch (err) {
    result = { manager: null, error: formatErrorMessage(err) };
  }
  return {
    ...result,
    debug: {
      backend: "builtin",
      purpose: params.purpose ?? "default",
      managerMs: Math.max(0, Date.now() - startedAt),
    },
  };
}

export async function closeAllMemorySearchManagers(): Promise<void> {
  if (!loadManagerRuntime.peek()) {
    return;
  }
  const { closeAllMemoryIndexManagers } = await loadManagerRuntime();
  await closeAllMemoryIndexManagers();
}

export async function closeMemorySearchManager(params: {
  cfg: BranchConfig;
  agentId: string;
}): Promise<void> {
  if (!loadManagerRuntime.peek()) {
    return;
  }
  const { closeMemoryIndexManagersForAgent } = await loadManagerRuntime();
  await closeMemoryIndexManagersForAgent({
    agentId: normalizeAgentId(params.agentId),
  });
}

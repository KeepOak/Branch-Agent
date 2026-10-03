/**
 * Lazy public SDK facade for active memory search manager lifecycle operations.
 */
import type { BranchConfig } from "../config/types.branch.js";
import type { MemorySearchManager } from "../memory-host-sdk/host/types.js";

type ActiveMemorySearchPurpose = "default" | "status";

/** Active manager lookup result, including a soft error when memory is unavailable. */
export type ActiveMemorySearchManagerResult = {
  manager: MemorySearchManager | null;
  error?: string;
};

/** Loads the active memory search manager for one agent and purpose. */
export async function getActiveMemorySearchManager(params: {
  cfg: BranchConfig;
  agentId: string;
  purpose?: ActiveMemorySearchPurpose;
}): Promise<ActiveMemorySearchManagerResult> {
  const runtime = await import("./memory-host-search.runtime.js");
  return await runtime.getActiveMemorySearchManager(params);
}

/** Closes every active memory search manager for the provided config. */
export async function closeActiveMemorySearchManagers(cfg?: BranchConfig): Promise<void> {
  const runtime = await import("./memory-host-search.runtime.js");
  await runtime.closeActiveMemorySearchManagers(cfg);
}

/** Closes the active memory search manager for one agent. */
export async function closeActiveMemorySearchManager(params: {
  cfg: BranchConfig;
  agentId: string;
}): Promise<void> {
  const runtime = await import("./memory-host-search.runtime.js");
  await runtime.closeActiveMemorySearchManager(params);
}

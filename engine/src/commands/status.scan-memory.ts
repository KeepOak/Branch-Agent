// Memory status collection for status scans.
// Runtime memory dependencies stay lazy so status paths without memory avoid loading the search manager.

import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import type { BranchConfig } from "../config/types.js";
import { resolveBranchAgentSqlitePath } from "../state/branch-agent-db.paths.js";
import type { MemoryPluginStatus } from "../status/memory-plugin.js";
import type { AgentLocalStatusesResult } from "./status.agent-local.js";
import {
  resolveSharedMemoryStatusSnapshot,
  type MemoryStatusSnapshot,
} from "./status.scan.shared.js";

/** Returns the owning agent database path for built-in memory. */
export function resolveDefaultMemoryDatabasePath(agentId: string): string {
  return resolveBranchAgentSqlitePath({ agentId });
}

/** Resolves memory index/cache status for the current status scan. */
export async function resolveStatusMemoryStatusSnapshot(params: {
  cfg: BranchConfig;
  agentStatus: AgentLocalStatusesResult;
  memoryPlugin: MemoryPluginStatus;
  requireDefaultDatabasePath?: (agentId: string) => string;
}): Promise<MemoryStatusSnapshot | null> {
  const { getMemoryProvider, getMemorySearchManager, isMemoryProviderNative } =
    await import("./status.scan.deps.runtime.js");
  return await resolveSharedMemoryStatusSnapshot({
    cfg: params.cfg,
    agentStatus: params.agentStatus,
    memoryPlugin: params.memoryPlugin,
    resolveMemoryConfig: resolveMemorySearchConfig,
    getMemorySearchManager,
    getMemoryProvider,
    isMemoryProviderNative,
    requireDefaultDatabasePath: params.requireDefaultDatabasePath,
  });
}

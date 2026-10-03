// Real workspace contract for memory engine foundation concerns.

export {
  resolveAgentContextLimits,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "./host/branch-runtime-agent.js";
export {
  resolveMemorySearchConfig,
  resolveMemorySearchSyncConfig,
  type ResolvedMemorySearchConfig,
  type ResolvedMemorySearchSyncConfig,
} from "./host/branch-runtime-agent.js";
export { parseDurationMs } from "./host/branch-runtime-config.js";
export { loadConfig } from "./host/branch-runtime-session.js";
export { resolveStateDir } from "./host/branch-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/branch-runtime-config.js";
export {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
} from "./host/branch-runtime-config.js";
export { root } from "./host/branch-runtime-io.js";
export { isPathInside } from "./host/fs-utils.js";
export { createSubsystemLogger } from "./host/branch-runtime-io.js";
export { detectMime } from "./host/branch-runtime-io.js";
export { resolveGlobalSingleton } from "./host/branch-runtime-io.js";
export { onSessionTranscriptUpdate } from "./host/branch-runtime-session.js";
export { splitShellArgs } from "./host/branch-runtime-io.js";
export { runTasksWithConcurrency } from "./host/branch-runtime-io.js";
export {
  shortenHomeInString,
  shortenHomePath,
  resolveUserPath,
  truncateUtf16Safe,
} from "./host/branch-runtime-io.js";
export type { BranchConfig } from "./host/branch-runtime-config.js";
export type { SecretInput } from "./host/branch-runtime-config.js";
export type { MemoryCitationsMode } from "./host/branch-runtime-config.js";
export type { MemorySearchConfig } from "./host/branch-runtime-config.js";

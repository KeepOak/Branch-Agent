// Focused runtime contract for memory plugin config/state/helpers.

export type { AnyAgentTool } from "./host/branch-runtime-agent.js";
export { resolveCronStyleNow } from "./host/branch-runtime-agent.js";
export { DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR } from "./host/branch-runtime-agent.js";
export { resolveDefaultAgentId, resolveSessionAgentId } from "./host/branch-runtime-agent.js";
export { resolveMemorySearchConfig } from "./host/branch-runtime-agent.js";
export {
  asToolParamsRecord,
  jsonResult,
  readNumberParam,
  readStringParam,
} from "./host/branch-runtime-agent.js";
export { SILENT_REPLY_TOKEN } from "./host/branch-runtime-session.js";
export { parseNonNegativeByteSize } from "./host/branch-runtime-config.js";
export { getRuntimeConfig } from "./host/branch-runtime-session.js";
export { resolveStateDir } from "./host/branch-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/branch-runtime-config.js";
export { emptyPluginConfigSchema } from "./host/branch-runtime-memory.js";
export {
  buildActiveMemoryPromptSection,
  getMemoryCapabilityRegistration,
  listActiveMemoryPublicArtifacts,
} from "./host/branch-runtime-memory.js";
export { parseAgentSessionKey } from "./host/branch-runtime-agent.js";
export type { BranchConfig } from "./host/branch-runtime-config.js";
export type { MemoryCitationsMode } from "./host/branch-runtime-config.js";
export type {
  MemoryFlushPlan,
  MemoryFlushPlanResolver,
  MemoryPluginCapability,
  MemoryPluginPublicArtifact,
  MemoryPluginPublicArtifactsProvider,
  MemoryPluginRuntime,
  MemoryPromptSectionBuilder,
} from "./host/branch-runtime-memory.js";
export type { BranchPluginApi } from "./host/branch-runtime-memory.js";

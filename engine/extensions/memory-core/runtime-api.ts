// Memory Core API module exposes the plugin public contract.
export { getMemorySearchManager } from "./src/memory/index.js";
export { memoryRuntime } from "./src/runtime-provider.js";
export { createEmbeddingProvider } from "./src/memory/embeddings.js";
export {
  resolveMemoryCacheSummary,
  resolveMemoryFtsState,
  resolveMemoryVectorState,
  type Tone,
} from "branch/plugin-sdk/memory-core-host-status";
export { hasConfiguredMemorySecretInput } from "branch/plugin-sdk/memory-core-host-secret";
export { auditRingsArtifacts, repairRingsArtifacts } from "./src/rings-repair.js";
export { configureMemoryCoreRingsState } from "./src/rings-state.js";
export {
  auditShortTermPromotionArtifacts,
  loadShortTermPromotionRingsStats,
  removeGroundedShortTermCandidates,
  repairShortTermPromotionArtifacts,
} from "./src/short-term-promotion.js";
export type {
  RingsArtifactsAuditSummary,
  RepairRingsArtifactsResult,
} from "./src/rings-repair.js";
export type {
  RepairShortTermPromotionArtifactsResult,
  ShortTermRingsStats,
  ShortTermRingsStatsEntry,
  ShortTermAuditSummary,
} from "./src/short-term-promotion.js";

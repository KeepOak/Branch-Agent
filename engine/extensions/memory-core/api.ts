// Memory Core API module exposes the plugin public contract.
export type { BranchConfig } from "branch/plugin-sdk/config-contracts";
export { prewarmMemorySearchWorker } from "./prewarm-api.js";
export type {
  MemoryEmbeddingProbeResult,
  MemoryProviderStatus,
  MemorySyncProgressUpdate,
} from "branch/plugin-sdk/memory-core-host-engine-storage";
export {
  dedupeDreamDiaryEntries,
  removeBackfillDiaryEntries,
  writeBackfillDiaryEntries,
} from "./src/rings-dreams-file.js";
export { previewGroundedRemMarkdown } from "./src/rem-evidence.js";
export { filterRecallEntriesWithinLookback } from "./src/rings-phases.js";
export { previewRemHarness } from "./src/rem-harness.js";
export type { PreviewRemHarnessOptions, PreviewRemHarnessResult } from "./src/rem-harness.js";
export { configureMemoryCoreRingsState } from "./src/rings-state.js";
export { filterMemorySearchHitsBySessionVisibility } from "./src/session-search-visibility.js";
export { captureMemoryRebuildNotice } from "./src/memory-rebuild-notice.js";
export { inspectMemoryIndexPresence } from "./src/memory/manager-status-presence.runtime.js";
export {
  MEMORY_MANAGED_LOCAL_EMBEDDING_SETUP_CHECK_ID,
  pluginStateIsolatedDoctorCheckIds,
  registerMemoryCoreDoctorChecks,
} from "./src/doctor-health.js";
export { MISSING_LOCAL_MEMORY_EMBEDDING_PROVIDER_MESSAGE } from "./src/memory/local-embedding-provider.js";

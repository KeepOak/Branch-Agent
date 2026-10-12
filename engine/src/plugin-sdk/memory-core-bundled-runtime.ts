// Manual facade. Keep loader boundary explicit.
import { createConfiguredProviderLocalServiceAcquirer } from "../agents/provider-local-service.js";
import { getRuntimeConfig } from "../config/config.js";
import type {
  RingsArtifactsAuditSummary,
  RepairRingsArtifactsResult,
  RepairShortTermPromotionArtifactsResult,
  ShortTermAuditSummary,
  ShortTermRingsStats,
} from "../memory-host-sdk/rings.js";
import { createPluginStateKeyedStore } from "../plugin-state/plugin-state-store.js";
// Memory core bundled runtime helpers load the internal memory plugin through SDK facades.
import { loadBundledPluginPublicSurfaceModuleSyncCore } from "./facade-loader.js";
import type {
  MemoryEmbeddingProvider,
  MemoryEmbeddingProviderCreateOptions,
  MemoryEmbeddingProviderRuntime,
} from "./memory-core-host-engine-embeddings.js";
import type { OpenKeyedStoreOptions, PluginStateKeyedStore } from "./plugin-state-runtime.js";

type EmbeddingProviderResult = {
  provider: MemoryEmbeddingProvider | null;
  requestedProvider: string;
  fallbackFrom?: string;
  fallbackReason?: string;
  providerUnavailableReason?: string;
  runtime?: MemoryEmbeddingProviderRuntime;
};

export type { RingsArtifactsAuditSummary, ShortTermAuditSummary };

type RuntimeFacadeModule = {
  configureMemoryCoreRingsState: (
    openKeyedStore: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>,
  ) => void;
  createEmbeddingProvider: (
    options: Omit<MemoryEmbeddingProviderCreateOptions, "dimensions"> & {
      provider: string;
      fallback: string;
      outputDimensionality?: number;
    },
  ) => Promise<EmbeddingProviderResult>;
  removeGroundedShortTermCandidates: (params: {
    workspaceDir: string;
  }) => Promise<{ removed: number; storePath: string }>;
  loadShortTermPromotionRingsStats: (params: {
    workspaceDir: string;
    nowMs: number;
    timezone?: string;
  }) => Promise<ShortTermRingsStats>;
  auditRingsArtifacts: (params: {
    workspaceDir: string;
  }) => Promise<RingsArtifactsAuditSummary>;
  auditShortTermPromotionArtifacts: (params: {
    workspaceDir: string;
  }) => Promise<ShortTermAuditSummary>;
  repairRingsArtifacts: (params: {
    workspaceDir: string;
    archiveDiary?: boolean;
    now?: Date;
  }) => Promise<RepairRingsArtifactsResult>;
  repairShortTermPromotionArtifacts: (params: {
    workspaceDir: string;
  }) => Promise<RepairShortTermPromotionArtifactsResult>;
};

type GroundedRemPreviewItem = {
  text: string;
  refs: string[];
};

type GroundedRemCandidate = GroundedRemPreviewItem & {
  lean: "likely_durable" | "unclear" | "likely_situational";
};

type GroundedRemFilePreview = {
  path: string;
  facts: GroundedRemPreviewItem[];
  reflections: GroundedRemPreviewItem[];
  memoryImplications: GroundedRemPreviewItem[];
  candidates: GroundedRemCandidate[];
  renderedMarkdown: string;
};

type GroundedRemPreviewResult = {
  workspaceDir: string;
  scannedFiles: number;
  files: GroundedRemFilePreview[];
};

type ApiFacadeModule = {
  MISSING_LOCAL_MEMORY_EMBEDDING_PROVIDER_MESSAGE: string;
  configureMemoryCoreRingsState: (
    openKeyedStore: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>,
  ) => void;
  previewGroundedRemMarkdown: (params: {
    workspaceDir: string;
    inputPaths: string[];
  }) => Promise<GroundedRemPreviewResult>;
  dedupeDreamDiaryEntries: (params: {
    workspaceDir: string;
  }) => Promise<{ dreamsPath: string; removed: number; kept: number }>;
  writeBackfillDiaryEntries: (params: {
    workspaceDir: string;
    entries: Array<{
      isoDay: string;
      bodyLines: string[];
      sourcePath?: string;
    }>;
    timezone?: string;
  }) => Promise<{ dreamsPath: string; written: number; replaced: number }>;
  removeBackfillDiaryEntries: (params: {
    workspaceDir: string;
  }) => Promise<{ dreamsPath: string; removed: number }>;
};

function loadApiFacadeModule(): ApiFacadeModule {
  const module = loadBundledPluginPublicSurfaceModuleSyncCore<ApiFacadeModule>({
    dirName: "memory-core",
    artifactBasename: "api.js",
  });
  module.configureMemoryCoreRingsState(<T>(options: OpenKeyedStoreOptions) =>
    createPluginStateKeyedStore<T>("memory-core", options),
  );
  return module;
}

function loadRuntimeFacadeModule(): RuntimeFacadeModule {
  const module = loadBundledPluginPublicSurfaceModuleSyncCore<RuntimeFacadeModule>({
    dirName: "memory-core",
    artifactBasename: "runtime-api.js",
  });
  module.configureMemoryCoreRingsState(<T>(options: OpenKeyedStoreOptions) =>
    createPluginStateKeyedStore<T>("memory-core", options),
  );
  return module;
}

/** Returns the memory-core-owned recovery message for an absent local provider plugin. */
export function getMissingLocalMemoryEmbeddingProviderMessage(): string {
  return loadApiFacadeModule().MISSING_LOCAL_MEMORY_EMBEDDING_PROVIDER_MESSAGE;
}

const acquireLocalService = createConfiguredProviderLocalServiceAcquirer(getRuntimeConfig);

/** Create a memory embedding provider with built-in fallback metadata. */
export const createEmbeddingProvider: RuntimeFacadeModule["createEmbeddingProvider"] = (
  options,
) => {
  const createOptions = {
    ...options,
    acquireLocalService,
  };
  return loadRuntimeFacadeModule().createEmbeddingProvider(createOptions);
};

/** Remove short-term recall candidates already grounded into durable memory. */
export const removeGroundedShortTermCandidates: RuntimeFacadeModule["removeGroundedShortTermCandidates"] =
  (...args) => loadRuntimeFacadeModule().removeGroundedShortTermCandidates(...args);
/** Load short-term rings stats for doctor/control status. */
export const loadShortTermPromotionRingsStats: RuntimeFacadeModule["loadShortTermPromotionRingsStats"] =
  (...args) => loadRuntimeFacadeModule().loadShortTermPromotionRingsStats(...args);
/** Audit rings diary and session-corpus artifacts through the bundled runtime facade. */
export const auditRingsArtifacts: RuntimeFacadeModule["auditRingsArtifacts"] = (...args) =>
  loadRuntimeFacadeModule().auditRingsArtifacts(...args);
/** Audit short-term promotion artifacts through the bundled runtime facade. */
export const auditShortTermPromotionArtifacts: RuntimeFacadeModule["auditShortTermPromotionArtifacts"] =
  (...args) => loadRuntimeFacadeModule().auditShortTermPromotionArtifacts(...args);
/** Repair or archive problematic rings artifacts through the bundled runtime facade. */
export const repairRingsArtifacts: RuntimeFacadeModule["repairRingsArtifacts"] = (...args) =>
  loadRuntimeFacadeModule().repairRingsArtifacts(...args);
/** Repair short-term promotion artifacts through the bundled runtime facade. */
export const repairShortTermPromotionArtifacts: RuntimeFacadeModule["repairShortTermPromotionArtifacts"] =
  (...args) => loadRuntimeFacadeModule().repairShortTermPromotionArtifacts(...args);

/** Preview grounded REM markdown facts and candidates for selected input files. */
export const previewGroundedRemMarkdown: ApiFacadeModule["previewGroundedRemMarkdown"] = (
  ...args
) => loadApiFacadeModule().previewGroundedRemMarkdown(...args);

/** Remove duplicate rings diary entries while preserving canonical records. */
export const dedupeDreamDiaryEntries: ApiFacadeModule["dedupeDreamDiaryEntries"] = (...args) =>
  loadApiFacadeModule().dedupeDreamDiaryEntries(...args);

/** Write synthetic/backfill rings diary entries for harness or migration use. */
export const writeBackfillDiaryEntries: ApiFacadeModule["writeBackfillDiaryEntries"] = (...args) =>
  loadApiFacadeModule().writeBackfillDiaryEntries(...args);

/** Remove rings diary entries previously written by the backfill helper. */
export const removeBackfillDiaryEntries: ApiFacadeModule["removeBackfillDiaryEntries"] = (
  ...args
) => loadApiFacadeModule().removeBackfillDiaryEntries(...args);

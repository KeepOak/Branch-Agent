/**
 * Tests bundled memory core runtime facade loading.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../test-utils/prepare-compiled-subprocesses.js";

const loadBundledPluginPublicSurfaceModuleSyncCore = vi.hoisted(() => vi.fn());
const configureMemoryCoreRingsStateImpl = vi.hoisted(() => vi.fn());
const createEmbeddingProviderImpl = vi.hoisted(() => vi.fn());
const removeGroundedShortTermCandidatesImpl = vi.hoisted(() => vi.fn());
const loadShortTermPromotionRingsStatsImpl = vi.hoisted(() => vi.fn());
const auditRingsArtifactsImpl = vi.hoisted(() => vi.fn());
const auditShortTermPromotionArtifactsImpl = vi.hoisted(() => vi.fn());
const repairRingsArtifactsImpl = vi.hoisted(() => vi.fn());
const repairShortTermPromotionArtifactsImpl = vi.hoisted(() => vi.fn());
const previewGroundedRemMarkdownImpl = vi.hoisted(() => vi.fn());
const writeBackfillDiaryEntriesImpl = vi.hoisted(() => vi.fn());
const removeBackfillDiaryEntriesImpl = vi.hoisted(() => vi.fn());

vi.mock("./facade-loader.js", async () => {
  const actual = await vi.importActual<typeof import("./facade-loader.js")>("./facade-loader.js");
  return {
    ...actual,
    loadBundledPluginPublicSurfaceModuleSyncCore,
  };
});

describe("plugin-sdk memory-core bundled runtime", () => {
  beforeEach(() => {
    configureMemoryCoreRingsStateImpl.mockReset();
    createEmbeddingProviderImpl.mockReset().mockResolvedValue({ provider: { id: "openai" } });
    removeGroundedShortTermCandidatesImpl.mockReset().mockResolvedValue({ removed: 1 });
    loadShortTermPromotionRingsStatsImpl.mockReset().mockResolvedValue({ shortTermCount: 0 });
    auditRingsArtifactsImpl.mockReset().mockResolvedValue({ issues: [] });
    auditShortTermPromotionArtifactsImpl.mockReset().mockResolvedValue({ issues: [] });
    repairRingsArtifactsImpl.mockReset().mockResolvedValue({ changed: false });
    repairShortTermPromotionArtifactsImpl.mockReset().mockResolvedValue({ changed: false });
    previewGroundedRemMarkdownImpl.mockReset().mockResolvedValue({ files: [] });
    writeBackfillDiaryEntriesImpl.mockReset().mockResolvedValue({ writtenCount: 1 });
    removeBackfillDiaryEntriesImpl.mockReset().mockResolvedValue({ removedCount: 1 });
    loadBundledPluginPublicSurfaceModuleSyncCore
      .mockReset()
      .mockImplementation(({ artifactBasename }) => {
        if (artifactBasename === "runtime-api.js") {
          return {
            configureMemoryCoreRingsState: configureMemoryCoreRingsStateImpl,
            createEmbeddingProvider: createEmbeddingProviderImpl,
            removeGroundedShortTermCandidates: removeGroundedShortTermCandidatesImpl,
            loadShortTermPromotionRingsStats: loadShortTermPromotionRingsStatsImpl,
            auditRingsArtifacts: auditRingsArtifactsImpl,
            auditShortTermPromotionArtifacts: auditShortTermPromotionArtifactsImpl,
            repairRingsArtifacts: repairRingsArtifactsImpl,
            repairShortTermPromotionArtifacts: repairShortTermPromotionArtifactsImpl,
          };
        }
        if (artifactBasename === "api.js") {
          return {
            configureMemoryCoreRingsState: configureMemoryCoreRingsStateImpl,
            previewGroundedRemMarkdown: previewGroundedRemMarkdownImpl,
            writeBackfillDiaryEntries: writeBackfillDiaryEntriesImpl,
            removeBackfillDiaryEntries: removeBackfillDiaryEntriesImpl,
          };
        }
        throw new Error(`unexpected artifact ${String(artifactBasename)}`);
      });
  });

  it("keeps the bundled memory facade cold until a helper is used", async () => {
    const module = await import("./memory-core-bundled-runtime.js");

    expect(loadBundledPluginPublicSurfaceModuleSyncCore).not.toHaveBeenCalled();
    await module.createEmbeddingProvider({} as never);
    expect(loadBundledPluginPublicSurfaceModuleSyncCore).toHaveBeenCalledWith({
      dirName: "memory-core",
      artifactBasename: "runtime-api.js",
    });
    expect(configureMemoryCoreRingsStateImpl).toHaveBeenCalledWith(expect.any(Function));
    expect(createEmbeddingProviderImpl).toHaveBeenCalledWith({
      acquireLocalService: expect.any(Function),
    });
  });

  it("delegates doctor and embedding helpers through the bundled public surfaces", async () => {
    const module = await import("./memory-core-bundled-runtime.js");

    await module.previewGroundedRemMarkdown({} as never);
    await module.removeGroundedShortTermCandidates({} as never);
    await module.loadShortTermPromotionRingsStats({} as never);
    await module.auditRingsArtifacts({} as never);
    await module.auditShortTermPromotionArtifacts({} as never);
    await module.repairRingsArtifacts({} as never);
    await module.repairShortTermPromotionArtifacts({} as never);

    expect(previewGroundedRemMarkdownImpl).toHaveBeenCalledWith({} as never);
    expect(removeGroundedShortTermCandidatesImpl).toHaveBeenCalledWith({} as never);
    expect(loadShortTermPromotionRingsStatsImpl).toHaveBeenCalledWith({} as never);
    expect(auditRingsArtifactsImpl).toHaveBeenCalledWith({} as never);
    expect(auditShortTermPromotionArtifactsImpl).toHaveBeenCalledWith({} as never);
    expect(repairRingsArtifactsImpl).toHaveBeenCalledWith({} as never);
    expect(repairShortTermPromotionArtifactsImpl).toHaveBeenCalledWith({} as never);
    expect(loadBundledPluginPublicSurfaceModuleSyncCore).toHaveBeenCalledWith({
      dirName: "memory-core",
      artifactBasename: "api.js",
    });
    expect(loadBundledPluginPublicSurfaceModuleSyncCore).toHaveBeenCalledWith({
      dirName: "memory-core",
      artifactBasename: "runtime-api.js",
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { createManagerIndexFixture } from "./manager-index.test-support.js";

const { closeAllMemorySearchManagers, getMemorySearchManager } = await import("./index.js");

describe("memory provider change", () => {
  const fixture = createManagerIndexFixture({ getMemorySearchManager, closeAllMemorySearchManagers });

  it("serves FTS while rebuilding vectors after a provider change", async () => {
    const oldManager = await fixture.getFreshManager(fixture.createConfig({ provider: "none", minScore: 0 }));
    await oldManager.sync({ reason: "baseline", force: true });
    await oldManager.close();

    let releaseEmbedding!: () => void;
    const embeddingGate = new Promise<void>((resolve) => { releaseEmbedding = resolve; });
    let embeddingStarted = false;
    fixture.provider.beforeEmbedBatch = () => {
      embeddingStarted = true;
      return embeddingGate;
    };
    const manager = await fixture.getFreshManager(fixture.createConfig({ provider: "local", model: "local-embed", minScore: 0 }));
    try {
      expect(manager.status().custom?.indexIdentity).toMatchObject({ status: "mismatched" });
      const results = await manager.search("zebra", { minScore: 0 });
      expect(results.some((entry) => entry.path === "memory/2026-01-12.md")).toBe(true);
      await vi.waitFor(() => expect(embeddingStarted).toBe(true));
      expect(manager.status().custom?.indexIdentity).toMatchObject({ status: "mismatched" });
      releaseEmbedding();
      await vi.waitFor(async () => {
        await manager.search("zebra", { minScore: 0 });
        expect(manager.status().custom?.indexIdentity).toEqual({ status: "valid" });
      }, { timeout: 30_000 });
    } finally {
      releaseEmbedding();
      fixture.provider.beforeEmbedBatch = null;
      await manager.close();
    }
  });
});

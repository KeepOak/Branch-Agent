import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createMemorySearchTool, testing } from "../tools.js";
import { loadMemoryToolRuntime } from "../tools.shared.js";
import { createManagerIndexFixture } from "./manager-index.test-support.js";

const { closeAllMemorySearchManagers, getMemorySearchManager } = await import("./index.js");

describe("memory index keyword fallback", () => {
  const fixture = createManagerIndexFixture({
    getMemorySearchManager,
    stateLifetime: "file",
    closeAllMemorySearchManagers,
  });
  beforeAll(async () => {
    await loadMemoryToolRuntime();
  });
  const { provider: providerFixture } = fixture;
  const { createConfig: createCfg, getFreshManager } = fixture;

  it("serves a published FTS-only index while an embedding rebuild is pending", async () => {
    const writer = await getFreshManager(createCfg({ provider: "none", minScore: 0 }), "cli");
    await writer.sync({ reason: "test", force: true });
    const db = Reflect.get(writer, "db") as DatabaseSync;
    const row = db
      .prepare("SELECT value FROM memory_index_meta WHERE key = 'memory_index_meta_v1'")
      .get() as { value: string };
    expect(JSON.parse(row.value)).toMatchObject({ model: "fts-only" });
    await writer.close();

    const manager = await getFreshManager(createCfg({ provider: "openai", minScore: 0 }));
    const maintenance = vi
      .spyOn(
        manager as unknown as {
          syncPublishedIndexInBackground: (params: { reason: string }) => Promise<void>;
        },
        "syncPublishedIndexInBackground",
      )
      .mockResolvedValue();
    const embeddingCalls = providerFixture.embedQueryCalls;

    const results = await manager.search("zebra", { minScore: 0 });

    expect(results).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "memory/2026-01-12.md" })]),
    );
    expect(providerFixture.embedQueryCalls).toBe(embeddingCalls);
    expect(maintenance).toHaveBeenCalledWith({ reason: "search" });
  });

  it.each(["sources", "scope"] as const)(
    "does not serve a published keyword index when the %s changed too",
    async (change) => {
      const writer = await getFreshManager(createCfg({ provider: "none", minScore: 0 }), "cli");
      await writer.sync({ reason: "test", force: true });
      await writer.close();

      const cfg = createCfg({
        provider: "openai",
        minScore: 0,
        ...(change === "sources"
          ? { sources: ["memory", "sessions"] as Array<"memory" | "sessions">, sessionMemory: true }
          : { extraPaths: [fixture.paths.workspace] }),
      });
      const manager = await getFreshManager(cfg);

      await expect(manager.search("zebra", { minScore: 0 })).resolves.toEqual([]);
    },
  );

  it.each(["matching", "sources", "scope"] as const)(
    "finalizes agent-tool keyword fallback with %s content scope while rebuilding is pending",
    async (change) => {
      testing.resetMemorySearchToolCooldowns();
      const writer = await getFreshManager(createCfg({ provider: "none", minScore: 0 }), "cli");
      await writer.sync({ reason: "test", force: true });
      await writer.close();
      const cfg = createCfg({
        provider: "openai",
        minScore: 0,
        ...(change === "sources"
          ? { sources: ["memory", "sessions"] as Array<"memory" | "sessions">, sessionMemory: true }
          : change === "scope"
            ? { extraPaths: [fixture.paths.workspace] }
            : {}),
      });
      // This test owns retrieval only, not asynchronous recall-promotion writes.
      cfg.plugins = {
        ...cfg.plugins,
        entries: { "memory-core": { config: { rings: { enabled: false } } } },
      };
      const manager = await getFreshManager(cfg);
      let releaseRebuild!: () => void;
      const rebuild = new Promise<void>((resolve) => {
        releaseRebuild = resolve;
      });
      const maintenance = vi
        .spyOn(
          manager as unknown as {
            syncPublishedIndexInBackground: (params: { reason: string }) => Promise<void>;
          },
          "syncPublishedIndexInBackground",
        )
        .mockReturnValue(rebuild);
      const tool = createMemorySearchTool({ config: cfg, agentId: "main" });
      if (!tool) {
        throw new Error("memory_search tool missing");
      }
      const embeddingCalls = providerFixture.embedQueryCalls;
      const batchCalls = providerFixture.embedBatchCalls;
      try {
        // Prime the lexical worker outside the tool's reply deadline. The
        // embedding rebuild remains held pending for both searches.
        await manager.search("zebra", { minScore: 0 });
        const result = await tool.execute("keyword-fallback", {
          query: "zebra",
          corpus: "memory",
          minScore: 0,
        });
        if (change === "matching") {
          expect(result.details).toMatchObject({
            results: [expect.objectContaining({ path: "memory/2026-01-12.md" })],
            mode: "keyword-only",
          });
          expect(result.details).not.toHaveProperty("disabled", true);
          expect(maintenance).toHaveBeenCalledWith({ reason: "search" });
        } else {
          expect(result.details).toMatchObject({ results: [], disabled: true, unavailable: true });
        }
        expect(providerFixture.embedQueryCalls).toBe(embeddingCalls);
        expect(providerFixture.embedBatchCalls).toBe(batchCalls);
      } finally {
        releaseRebuild();
        await rebuild;
        maintenance.mockRestore();
      }
    },
  );
});

import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { createManagerIndexFixture } from "./manager-index.test-support.js";

const { closeAllMemorySearchManagers, getMemorySearchManager } = await import("./index.js");

describe("memory index keyword fallback", () => {
  const fixture = createManagerIndexFixture({
    getMemorySearchManager,
    closeAllMemorySearchManagers,
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
    const maintenance = vi.spyOn(
      manager as unknown as {
        syncPublishedIndexInBackground: (params: { reason: string }) => Promise<void>;
      },
      "syncPublishedIndexInBackground",
    ).mockResolvedValue();
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
});

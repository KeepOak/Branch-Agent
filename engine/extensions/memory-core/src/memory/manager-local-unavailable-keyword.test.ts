import { describe, expect, it, vi } from "vitest";
import { LOCAL_MEMORY_SEARCH_UNAVAILABLE_MESSAGE } from "./local-embedding-provider.js";
import { createManagerIndexFixture } from "./manager-index.test-support.js";

const memoryWarn = vi.hoisted(() => vi.fn());

vi.mock("branch/plugin-sdk/memory-core-host-engine-foundation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("branch/plugin-sdk/memory-core-host-engine-foundation")>();
  return {
    ...actual,
    createSubsystemLogger: (subsystem: string) => {
      const logger = actual.createSubsystemLogger(subsystem);
      if (subsystem !== "memory") {
        return logger;
      }
      return {
        ...logger,
        warn(message: string, meta?: Record<string, unknown>) {
          memoryWarn(message, meta);
          logger.warn(message, meta);
        },
      };
    },
  };
});

const { closeAllMemorySearchManagers, getMemorySearchManager } = await import("./index.js");

describe("memory index local unavailable keyword search", () => {
  const fixture = createManagerIndexFixture({
    getMemorySearchManager,
    closeAllMemorySearchManagers,
  });
  const { provider: providerFixture } = fixture;
  const { createConfig: createCfg, getFreshManager } = fixture;

  it("keeps keyword search when the local model fails to load and warns once", async () => {
    memoryWarn.mockClear();
    providerFixture.providerCreationFailure = "local";
    const manager = await getFreshManager(createCfg({ provider: "local", minScore: 0 }));

    await manager.sync({ reason: "test", force: true });
    const results = await manager.search("zebra", { minScore: 0 });
    expect(results).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "memory/2026-01-12.md" })]),
    );
    expect(manager.status().vector.semanticAvailable).toBe(false);
    expect(
      manager as unknown as { embeddingBootstrapFailure?: { degradedTo?: string } },
    ).toMatchObject({
      embeddingBootstrapFailure: expect.objectContaining({ degradedTo: "keyword-only" }),
    });

    await manager.sync({ reason: "test" });
    await expect(manager.search("zebra", { minScore: 0 })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "memory/2026-01-12.md" })]),
    );

    expect(
      memoryWarn.mock.calls.filter((call) => call[0] === LOCAL_MEMORY_SEARCH_UNAVAILABLE_MESSAGE),
    ).toHaveLength(1);
  });
});

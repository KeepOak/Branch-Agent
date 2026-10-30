import fs from "node:fs/promises";
import path from "node:path";
import type { BranchConfig } from "branch/plugin-sdk/memory-core-host-runtime-core";
import { clearMemoryPluginState } from "branch/plugin-sdk/memory-host-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createManagerIndexFixture,
  type ManagerIndexFixture,
} from "./memory/manager-index.test-support.js";
import { createMemorySearchTool, testing } from "./tools.js";

const warnings = vi.hoisted(() => vi.fn());
vi.mock("branch/plugin-sdk/memory-core-host-engine-foundation", async (original) => {
  const actual =
    await original<typeof import("branch/plugin-sdk/memory-core-host-engine-foundation")>();
  return {
    ...actual,
    createSubsystemLogger: (...args: Parameters<typeof actual.createSubsystemLogger>) => ({
      ...actual.createSubsystemLogger(...args),
      warn: warnings,
    }),
  };
});

const { closeAllMemorySearchManagers, getMemorySearchManager } = await import("./memory/index.js");

const EMBEDDING_QUOTA_MESSAGE =
  "openai embeddings failed (429): You have no credits remaining. Add credits to continue using the API. [type=insufficient_quota, code=credit_balance_exhausted]";

// Mirrors ProviderHttpError for an OpenAI account with no credits.
function embeddingQuotaError() {
  return Object.assign(new Error(EMBEDDING_QUOTA_MESSAGE), {
    status: 429,
    errorType: "insufficient_quota",
    errorCode: "credit_balance_exhausted",
  });
}

// Kept apart from tools.real-manager.test.ts: these few real-manager cases
// fit the Windows touched-test lane, which the larger file does not. One
// state root serves the whole file to keep per-case setup and cleanup light.
describe("memory_search real manager embedding account backoff", () => {
  const fixture: ManagerIndexFixture = createManagerIndexFixture({
    getMemorySearchManager,
    stateLifetime: "file",
    closeAllMemorySearchManagers,
  });
  const { provider, createConfig } = fixture;
  const memoryPath = "memory/2026-01-12.md";
  const alphaQuery = Object.freeze({ query: "alpha", corpus: "memory" });

  function searchTool(config: BranchConfig) {
    const tool = createMemorySearchTool({ config, agentId: "main" });
    if (!tool) {
      throw new Error("memory_search tool missing");
    }
    return tool;
  }

  async function indexedManager(cfg: BranchConfig) {
    const manager = await fixture.getFreshManager(cfg, "cli");
    await manager.sync({ reason: "cli", force: true });
    return manager;
  }

  async function settleSearchMaintenance(manager: object) {
    const active = Reflect.get(manager, "activeBackgroundSearchSyncs") as Set<Promise<void>>;
    while (active.size > 0) {
      await Promise.all(Array.from(active));
    }
  }

  function warningLines(): string[] {
    return warnings.mock.calls.map((call) => String(call[0]));
  }

  beforeEach(() => {
    testing.resetMemorySearchToolCooldowns();
    warnings.mockClear();
  });
  afterEach(() => {
    clearMemoryPluginState();
    vi.restoreAllMocks();
  });

  it("answers from the existing index while the embedding quota is exhausted", async () => {
    const cfg = createConfig({ vectorEnabled: false });
    cfg.memory = { ...cfg.memory, search: { ...cfg.memory?.search, cache: { enabled: false } } };
    const manager = await indexedManager(cfg);
    await manager.close();
    const quota = embeddingQuotaError();
    let queryAttempts = 0;
    provider.embedBatchPermanentFailure = quota;
    provider.beforeEmbedQuery = async () => {
      queryAttempts += 1;
      throw quota;
    };
    const tool = searchTool(cfg);
    warnings.mockClear();

    const first = await tool.execute("quota-first", alphaQuery);
    expect(first.details).toMatchObject({
      results: [expect.objectContaining({ path: memoryPath })],
    });
    expect(first.details).not.toHaveProperty("unavailable");
    const attemptsAfterFirst = queryAttempts;
    // The query failure opened the window, so its one warning says what is
    // paused and for how long.
    const quotaWarnings = warningLines().filter((line) => line.includes("no credits remaining"));
    expect(quotaWarnings).toHaveLength(1);
    expect(quotaWarnings[0]).toContain("automatic memory indexing pauses for 5 min");

    // The account backoff answers from the keyword index without asking the
    // provider again until the window ends.
    const second = await tool.execute("quota-second", alphaQuery);
    expect(second.details).toMatchObject({
      results: [expect.objectContaining({ path: memoryPath })],
    });
    expect(second.details).not.toHaveProperty("unavailable");
    expect(queryAttempts).toBe(attemptsAfterFirst);
    expect(warningLines().filter((line) => line.includes("no credits remaining"))).toHaveLength(1);
  });

  it("stops asking the rejected account when there is no keyword fallback", async () => {
    const cfg = createConfig({ vectorEnabled: false });
    cfg.memory = { ...cfg.memory, search: { ...cfg.memory?.search, cache: { enabled: false } } };
    const manager = await indexedManager(cfg);
    // Hybrid keyword search off, as on a SQLite build without FTS5.
    const fts = Reflect.get(manager, "fts") as { enabled: boolean; available: boolean };
    fts.enabled = false;
    fts.available = false;
    const quota = embeddingQuotaError();
    let queryAttempts = 0;
    provider.embedBatchPermanentFailure = quota;
    provider.beforeEmbedQuery = async () => {
      queryAttempts += 1;
      throw quota;
    };

    // Keyword search is off, so the first failure has no keyword index to
    // answer from and surfaces as is; it also opens the account window.
    await expect(manager.search("alpha")).rejects.toThrow("no credits remaining");
    const attemptsAfterFirst = queryAttempts;
    expect(attemptsAfterFirst).toBeGreaterThan(0);

    // Later searches fail fast with the window message instead of resending
    // the query to the rejected account.
    await expect(manager.search("alpha")).rejects.toThrow(
      "the embedding provider rejected the account",
    );
    await expect(manager.search("alpha")).rejects.toThrow(
      "tries the provider again in about 5 min",
    );
    expect(queryAttempts).toBe(attemptsAfterFirst);
  });

  it("defers automatic syncs while the embedding quota is exhausted", async () => {
    const cfg = createConfig({ vectorEnabled: false });
    const manager = await indexedManager(cfg);
    let batchAttempts = 0;
    provider.embedBatchPermanentFailure = embeddingQuotaError();
    provider.beforeEmbedBatch = async () => {
      batchAttempts += 1;
    };
    await fs.writeFile(
      path.join(fixture.paths.workspace, "memory", "2026-01-13.md"),
      "Zebra notes written while the quota is exhausted.\n",
    );
    await expect(manager.sync({ reason: "cli", force: true })).rejects.toThrow(
      "no credits remaining",
    );
    const attemptsAfterFailure = batchAttempts;
    expect(attemptsAfterFailure).toBeGreaterThan(0);

    await manager.sync({ reason: "watch" });
    await manager.sync({ reason: "interval" });
    expect(batchAttempts).toBe(attemptsAfterFailure);
    // The dirty manager's search maintenance waits out the window as well.
    await expect(manager.search("alpha")).resolves.toEqual([
      expect.objectContaining({ path: memoryPath }),
    ]);
    await settleSearchMaintenance(manager);
    expect(batchAttempts).toBe(attemptsAfterFailure);
  });

  it("keeps the backoff opened by a closed search maintenance manager", async () => {
    const cfg = createConfig({ vectorEnabled: false });
    await (await indexedManager(cfg)).close();
    await fs.writeFile(
      path.join(fixture.paths.workspace, "memory", "2026-01-14.md"),
      "Yak notes written while the quota is exhausted.\n",
    );
    const manager = await fixture.getFreshManager(cfg);
    let batchAttempts = 0;
    let releaseBatch = () => {};
    const firstSearchReturned = new Promise<void>((resolve) => {
      releaseBatch = () => resolve();
    });
    provider.embedBatchPermanentFailure = embeddingQuotaError();
    provider.beforeEmbedBatch = async () => {
      batchAttempts += 1;
      await firstSearchReturned;
    };

    // The query succeeds; only the detached maintenance pass, which runs on
    // its own transient manager, sees the quota failure.
    await manager.search("alpha");
    releaseBatch();
    await settleSearchMaintenance(manager);
    const attemptsAfterFirst = batchAttempts;
    expect(attemptsAfterFirst).toBeGreaterThan(0);

    await expect(manager.search("alpha")).resolves.toEqual([
      expect.objectContaining({ path: memoryPath }),
    ]);
    await manager.search("alpha");
    await settleSearchMaintenance(manager);
    expect(batchAttempts).toBe(attemptsAfterFirst);
  });
});

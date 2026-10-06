// Memory Core tests cover manager registry behavior.
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { memoryRuntime } from "../runtime-provider.js";
import { createManagerIndexFixture } from "./manager-index.test-support.js";
import {
  closeAllMemoryIndexManagers,
  closeMemoryIndexManagersForAgent,
} from "./manager-runtime.js";
import { MemoryIndexManager as RuntimeMemoryIndexManager } from "./manager.js";

const { closeAllMemorySearchManagers, getMemorySearchManager } = await import("./index.js");

describe("memory index", () => {
  const fixture = createManagerIndexFixture({
    getMemorySearchManager,
    closeAllMemorySearchManagers,
  });
  const { provider: providerFixture } = fixture;
  const { createConfig: createCfg, getFreshManager, requireManager, trackManager } = fixture;

  it("waits for scoped manager close before initializing a replacement", async () => {
    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });
    const cfg = createCfg({});
    const first = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(first);
    await first.probeEmbeddingAvailability();
    const closePromise = closeMemoryIndexManagersForAgent({ agentId: "main" });
    const callsBeforeReplacement = providerFixture.providerCalls.length;
    const secondPromise = getMemorySearchManager({ cfg, agentId: "main" }).then((result) =>
      requireManager(result),
    );
    const concurrentSecondPromise = getMemorySearchManager({ cfg, agentId: "main" }).then(
      (result) => requireManager(result),
    );
    const secondProbe = secondPromise.then(async (manager) => {
      await manager.probeEmbeddingAvailability();
    });
    let secondSettled = false;
    void secondPromise.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );
    try {
      await vi.waitFor(() => {
        expect(providerFixture.providerCloseCalls).toBe(1);
      });
      await Promise.resolve();
      expect(secondSettled).toBe(false);
      expect(providerFixture.providerCalls).toHaveLength(callsBeforeReplacement);
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }
    await closePromise;
    const second = await secondPromise;
    const concurrentSecond = await concurrentSecondPromise;
    await secondProbe;
    trackManager(second);
    expect(second === first).toBe(false);
    expect(concurrentSecond).toBe(second);

    const third = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(third);
    expect(third).toBe(second);
  });

  it("does not reuse a cached manager after direct close starts", async () => {
    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });
    const cfg = createCfg({});
    const first = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(first);
    await first.probeEmbeddingAvailability();

    const closePromise = first.close();
    const replacementPromise = getMemorySearchManager({ cfg, agentId: "main" }).then((result) =>
      requireManager(result),
    );
    let replacementSettled = false;
    void replacementPromise.then(
      () => {
        replacementSettled = true;
      },
      () => {
        replacementSettled = true;
      },
    );
    try {
      await vi.waitFor(() => expect(providerFixture.providerCloseCalls).toBe(1));
      await Promise.resolve();
      expect(replacementSettled).toBe(false);
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }

    await closePromise;
    const replacement = await replacementPromise;
    trackManager(replacement);
    expect(replacement === first).toBe(false);
  });

  it("serializes concurrent acquisitions with different cache identities", async () => {
    const firstCfg = createCfg({
      model: "first-model",
    });
    const first = requireManager(await getMemorySearchManager({ cfg: firstCfg, agentId: "main" }));
    trackManager(first);
    await first.probeEmbeddingAvailability();
    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });

    const secondPromise = getMemorySearchManager({
      cfg: createCfg({ model: "second-model" }),
      agentId: "main",
    }).then((result) => requireManager(result));
    await vi.waitFor(() => expect(providerFixture.providerCloseCalls).toBe(1));
    const thirdPromise = getMemorySearchManager({
      cfg: createCfg({ model: "third-model" }),
      agentId: "main",
    }).then((result) => requireManager(result));
    try {
      await Promise.resolve();
      expect(providerFixture.providerCalls).toHaveLength(1);
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }

    const [second, third] = await Promise.all([secondPromise, thirdPromise]);
    trackManager(second);
    trackManager(third);
    expect(second === first).toBe(false);
    expect(third === second).toBe(false);
    expect((second as unknown as { closed: boolean }).closed).toBe(true);
    expect((third as unknown as { closed: boolean }).closed).toBe(false);
  });

  it("canonicalizes agent ids before builtin manager acquisition", async () => {
    const cfg = createCfg({ model: "canonical-model" });
    const first = await RuntimeMemoryIndexManager.get({ cfg, agentId: "Main-Agent" });
    const second = await RuntimeMemoryIndexManager.get({ cfg, agentId: "main-agent" });
    if (!first || !second) {
      throw new Error("Expected canonical memory index managers");
    }
    trackManager(first);
    trackManager(second);
    expect(second).toBe(first);
  });

  it("projects downloading, rebuilding, and text-only fallback from a separate live manager", async () => {
    const cfg = createCfg({ provider: "local" });
    const live = await RuntimeMemoryIndexManager.get({ cfg, agentId: "main" });
    const status = await RuntimeMemoryIndexManager.get({ cfg, agentId: "main", purpose: "status" });
    if (!live || !status) {
      throw new Error("Expected live and status memory managers");
    }
    trackManager(live);
    trackManager(status);
    expect(status).not.toBe(live);

    let releaseProviderInit: () => void = () => {};
    providerFixture.providerInitGate = new Promise<void>((resolve) => {
      releaseProviderInit = resolve;
    });
    providerFixture.providerPreparationUpdate = { downloadedSize: 32, totalSize: 128 };
    const probe = live.probeEmbeddingAvailability();
    try {
      await vi.waitFor(() => expect(providerFixture.providerCalls).toHaveLength(1));
      expect(status.status()).toMatchObject({
        provider: "none",
        custom: {
          searchMode: "fts-only",
          providerPreparationProgress: { downloadedSize: 32, totalSize: 128 },
        },
      });
    } finally {
      releaseProviderInit();
      providerFixture.providerInitGate = null;
    }
    await probe;
    expect(status.status()).toMatchObject({ provider: "mock", custom: { searchMode: "hybrid" } });
    expect(status.status().custom?.providerPreparationProgress).toBeUndefined();

    // The rebuild callback writes this field on the live manager while maintenance runs.
    (live as unknown as { providerChangeProgress: { completed: number; total: number } }).providerChangeProgress =
      { completed: 3, total: 8 };
    expect(status.status().custom?.providerChangeProgress).toEqual({ completed: 3, total: 8 });

    providerFixture.forceNoProvider = true;
    const fallbackCfg = createCfg({ provider: "local", model: "fallback-model" });
    const fallback = await RuntimeMemoryIndexManager.get({ cfg: fallbackCfg, agentId: "main" });
    const fallbackStatus = await RuntimeMemoryIndexManager.get({
      cfg: fallbackCfg,
      agentId: "main",
      purpose: "status",
    });
    if (!fallback || !fallbackStatus) {
      throw new Error("Expected fallback memory managers");
    }
    trackManager(fallback);
    trackManager(fallbackStatus);
    await fallback.probeEmbeddingAvailability();
    expect(fallbackStatus.status()).toMatchObject({
      provider: "none",
      custom: { searchMode: "fts-only" },
    });
  });

  it("reports a probed status manager's provider without a cached writer", async () => {
    const cfg = createCfg({ provider: "local" });
    const status = await RuntimeMemoryIndexManager.get({ cfg, agentId: "main", purpose: "status" });
    if (!status) {
      throw new Error("Expected a status memory manager");
    }
    trackManager(status);

    expect(status.status()).toMatchObject({
      provider: "local",
      custom: { searchMode: "hybrid" },
    });
    await expect(status.probeEmbeddingAvailability()).resolves.toEqual({ ok: true });
    expect(status.status()).toMatchObject({
      provider: "mock",
      custom: { searchMode: "hybrid" },
    });
  });

  it("retires the prior builtin manager when an agent workspace changes", async () => {
    const firstCfg = createCfg({ model: "workspace-model" });
    const secondCfg = createCfg({ model: "workspace-model" });
    if (!firstCfg.agents?.defaults || !secondCfg.agents?.defaults) {
      throw new Error("Expected agent defaults");
    }
    firstCfg.agents.defaults.workspace = path.join(fixture.paths.root, "workspace-a");
    secondCfg.agents.defaults.workspace = path.join(fixture.paths.root, "workspace-b");

    const first = await RuntimeMemoryIndexManager.get({ cfg: firstCfg, agentId: "main" });
    const second = await RuntimeMemoryIndexManager.get({ cfg: secondCfg, agentId: "main" });
    if (!first || !second) {
      throw new Error("Expected workspace memory index managers");
    }
    trackManager(first);
    trackManager(second);
    expect(second === first).toBe(false);
    expect((first as unknown as { closed: boolean }).closed).toBe(true);
  });

  it("does not block another agent while one scope retires its manager", async () => {
    const firstCfg = createCfg({
      model: "first-model",
    });
    const first = requireManager(await getMemorySearchManager({ cfg: firstCfg, agentId: "main" }));
    trackManager(first);
    await first.probeEmbeddingAvailability();
    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });

    const replacementPromise = getMemorySearchManager({
      cfg: createCfg({ model: "second-model" }),
      agentId: "main",
    });
    await vi.waitFor(() => expect(providerFixture.providerCloseCalls).toBe(1));
    const otherAgentPromise = getMemorySearchManager({
      cfg: createCfg({ model: "other-model" }),
      agentId: "other",
    });
    let otherAgentSettled = false;
    void otherAgentPromise.then(
      () => {
        otherAgentSettled = true;
      },
      () => {
        otherAgentSettled = true;
      },
    );
    try {
      await vi.waitFor(() => expect(otherAgentSettled).toBe(true));
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }

    const otherAgent = requireManager(await otherAgentPromise);
    const replacement = requireManager(await replacementPromise);
    trackManager(otherAgent);
    trackManager(replacement);
    expect((otherAgent as unknown as { closed: boolean }).closed).toBe(false);
  });

  it("global teardown waits for an admitted builtin manager replacement", async () => {
    const first = await RuntimeMemoryIndexManager.get({
      cfg: createCfg({ model: "first-model" }),
      agentId: "main",
    });
    if (!first) {
      throw new Error("Expected first memory index manager");
    }
    trackManager(first);
    await first.probeEmbeddingAvailability();
    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });

    const replacementPromise = RuntimeMemoryIndexManager.get({
      cfg: createCfg({ model: "second-model" }),
      agentId: "main",
    });
    await vi.waitFor(() => expect(providerFixture.providerCloseCalls).toBe(1));
    const globalClosePromise = closeAllMemoryIndexManagers();
    let globalCloseSettled = false;
    void globalClosePromise.then(
      () => {
        globalCloseSettled = true;
      },
      () => {
        globalCloseSettled = true;
      },
    );
    try {
      await Promise.resolve();
      expect(globalCloseSettled).toBe(false);
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }

    const replacement = await replacementPromise;
    await globalClosePromise;
    if (!replacement) {
      throw new Error("Expected replacement memory index manager");
    }
    trackManager(replacement);
    expect((replacement as unknown as { closed: boolean }).closed).toBe(true);
  });

  it("declines a maintenance manager that arrives during global teardown", async () => {
    const cfg = createCfg({});
    const manager = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(manager);
    await manager.probeEmbeddingAvailability();
    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });

    const globalClose = closeAllMemoryIndexManagers();
    try {
      await vi.waitFor(() => expect(providerFixture.providerCloseCalls).toBe(1));
      await expect(
        RuntimeMemoryIndexManager.get({ cfg, agentId: "main", purpose: "maintenance" }),
      ).resolves.toBeNull();
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }
    await globalClose;
  });

  it("retains failed reload retirement through healthy acquisition and final close", async () => {
    const cfg = createCfg({});
    const first = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(first);
    await first.probeEmbeddingAvailability();
    providerFixture.providerCloseFailuresRemaining = 2;
    const retirement = memoryRuntime.prepareReload({
      retireRuntime: true,
      retiringEmbeddingProviders: [],
    });
    try {
      await expect(retirement.drain()).resolves.toEqual({
        errors: [expect.objectContaining({ message: "provider close failed" })],
      });
      expect(providerFixture.providerCloseCalls).toBe(2);
    } finally {
      retirement.resume();
    }

    const replacement = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(replacement);
    expect(replacement).not.toBe(first);
    expect(providerFixture.providerCloseCalls).toBe(2);
    await replacement.probeEmbeddingAvailability();
    expect(requireManager(await getMemorySearchManager({ cfg, agentId: "main" }))).toBe(
      replacement,
    );

    await closeAllMemoryIndexManagers();
    expect(providerFixture.providerCloseCalls).toBe(4);
    await closeAllMemoryIndexManagers();
    expect(providerFixture.providerCloseCalls).toBe(4);
  });

  it("retains a failed scoped close owner until provider retirement succeeds", async () => {
    const cfg = createCfg({});
    const first = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(first);
    await first.probeEmbeddingAvailability();
    providerFixture.providerCloseFailuresRemaining = 2;

    await expect(closeMemoryIndexManagersForAgent({ agentId: "main" })).rejects.toThrow(
      "provider close failed",
    );
    expect(providerFixture.providerCloseCalls).toBe(2);

    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });
    const callsBeforeReplacement = providerFixture.providerCalls.length;
    const replacementPromise = getMemorySearchManager({ cfg, agentId: "main" }).then((result) =>
      requireManager(result),
    );
    try {
      await vi.waitFor(() => expect(providerFixture.providerCloseCalls).toBe(3));
      expect(providerFixture.providerCalls).toHaveLength(callsBeforeReplacement);
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }

    const replacement = await replacementPromise;
    trackManager(replacement);
    expect(replacement === first).toBe(false);
  });

  it("retains a failed global close owner until provider retirement succeeds", async () => {
    const cfg = createCfg({});
    const first = requireManager(await getMemorySearchManager({ cfg, agentId: "main" }));
    trackManager(first);
    await first.probeEmbeddingAvailability();
    providerFixture.providerCloseFailuresRemaining = 2;
    providerFixture.providerCloseFailure = undefined;

    let globalCloseRejected = false;
    await closeAllMemorySearchManagers().then(
      () => {},
      () => {
        globalCloseRejected = true;
      },
    );
    expect(globalCloseRejected).toBe(true);
    expect(providerFixture.providerCloseCalls).toBe(2);

    let releaseProviderClose: () => void = () => {};
    providerFixture.providerCloseGate = new Promise<void>((resolve) => {
      releaseProviderClose = resolve;
    });
    const callsBeforeReplacement = providerFixture.providerCalls.length;
    const replacementPromise = getMemorySearchManager({ cfg, agentId: "main" }).then((result) =>
      requireManager(result),
    );
    let concurrentGlobalClose: Promise<void> = Promise.resolve();
    try {
      await vi.waitFor(() => expect(providerFixture.providerCloseCalls).toBe(3));
      expect(providerFixture.providerCalls).toHaveLength(callsBeforeReplacement);
      concurrentGlobalClose = closeAllMemorySearchManagers();
    } finally {
      releaseProviderClose();
      providerFixture.providerCloseGate = null;
    }

    const replacement = await replacementPromise;
    await concurrentGlobalClose;
    trackManager(replacement);
    expect(replacement === first).toBe(false);
    expect((replacement as unknown as { closed: boolean }).closed).toBe(false);
  });

  it("does not reuse memory index managers across local-service hosts", async () => {
    const cfg = createCfg({});
    const firstAcquire = vi.fn(async () => undefined);
    const secondAcquire = vi.fn(async () => undefined);
    const first = requireManager(
      await getMemorySearchManager({
        cfg,
        agentId: "main",
        acquireLocalService: firstAcquire,
      }),
    );
    trackManager(first);

    const second = requireManager(
      await getMemorySearchManager({
        cfg,
        agentId: "main",
        acquireLocalService: secondAcquire,
      }),
    );
    trackManager(second);
    const secondAgain = requireManager(
      await getMemorySearchManager({
        cfg,
        agentId: "main",
        acquireLocalService: secondAcquire,
      }),
    );

    expect(Object.is(second, first)).toBe(false);
    expect(Object.is(secondAgain, second)).toBe(true);
  });

  it("retries embedding provider close before releasing the manager", async () => {
    providerFixture.providerCloseFailuresRemaining = 1;
    const cfg = createCfg({});
    const manager = await getFreshManager(cfg);

    await manager.probeEmbeddingAvailability();
    await manager.close();

    expect(providerFixture.providerCloseCalls).toBe(2);
  });
});

// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { ModelCatalogSnapshot } from "./model-catalog.types.js";
import {
  getPreparedModelRuntimeSnapshot,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";
import { refreshCommittedProviderCatalogs } from "./prepared-model-runtime.refresh-scope.js";
import type { PreparedModelRuntimeOwner } from "./prepared-model-runtime.types.js";

const fixture = usePreparedModelRuntimeHarness({ label: "captured-model-runtime" });
const { mocks } = fixture;
async function prepareCatalogOwner(
  config: BranchConfig,
  catalogs: readonly ModelCatalogSnapshot[],
) {
  mocks.configuredAgentIds = ["pro"];
  for (const catalog of catalogs) {
    mocks.runPreparedModelCatalogWorker.mockResolvedValue(catalog);
  }
  await refreshPreparedModelRuntimeSnapshots(config, {
    gatewayLifecycle: true,
    catalogMode: "static",
    allowGatewaySubagentBinding: true,
  });
  return getPreparedModelRuntimeSnapshot({
    config,
    agentId: "pro",
    agentDir: fixture.state.agentDir("pro"),
  })!;
}

describe("captured startup inventory refresh", () => {
  it("backs off repeated committed refresh failures and logs once until recovery", async () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn().mockRejectedValue(new Error("catalog unavailable"));
      const owner = {
        provenance: "configured",
        needsRefresh: false,
        input: { agentDir: fixture.state.agentDir("backoff") },
        snapshot: { loadFullModelCatalog: load },
      } as unknown as PreparedModelRuntimeOwner;
      const refresh = async () => {
        refreshCommittedProviderCatalogs([owner]);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      await refresh();
      expect(mocks.warn).toHaveBeenCalledOnce();
      // Re-publication may install a new owner for the same agent directory.
      refreshCommittedProviderCatalogs([{ ...owner }]);
      expect(load).toHaveBeenCalledTimes(1);
      const otherOwner = {
        ...owner,
        input: { ...owner.input, agentDir: fixture.state.agentDir("other-backoff") },
      };
      refreshCommittedProviderCatalogs([otherOwner]);
      await Promise.resolve();
      await Promise.resolve();
      expect(load).toHaveBeenCalledTimes(2);
      expect(mocks.warn).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(60_000);
      await refresh();
      expect(load).toHaveBeenCalledTimes(3);
      expect(mocks.warn).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(60_000);
      refreshCommittedProviderCatalogs([owner]);
      expect(load).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(60_000);
      load.mockResolvedValueOnce({ entries: [], routeVariants: [] });
      await refresh();
      expect(load).toHaveBeenCalledTimes(4);
      await refresh();
      expect(load).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports redacted nested failures from the committed catalog refresh", async () => {
    const warning = createDeferred<string>();
    const token = "sk-abcdefghijklmnopqrstuv";
    const failure = new AggregateError(
      [
        new Error("registry release failed", {
          cause: new Error(`Authorization: Bearer ${token}`),
        }),
        new Error("donor close failed"),
      ],
      "Prepared plugin resources failed to close",
    );
    mocks.configuredAgentIds = ["pro"];
    mocks.runPreparedModelCatalogWorker.mockRejectedValue(failure);
    mocks.warn.mockImplementation((message: string) => warning.resolve(message));

    await refreshPreparedModelRuntimeSnapshots(
      { agents: { entries: { pro: {} } } },
      { gatewayLifecycle: true, catalogMode: "static" },
    );
    const message = await warning.promise;

    expect(message).toContain("provider catalog refresh failed:");
    expect(message).toContain("Prepared plugin resources failed to close");
    expect(message).toContain("registry release failed");
    expect(message).toContain("donor close failed");
    expect(message).toContain("Authorization: Bearer");
    expect(message).not.toContain(token);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });

  it("does not refill a successful empty refresh from the captured startup registry", async () => {
    const captured = {
      provider: "custom",
      id: "removed",
      name: "Previously discovered",
      api: "openai-completions" as const,
      baseUrl: "https://custom.example.test/v1",
    };
    mocks.modelRegistry.getAll.mockReturnValue([captured]);
    const owner = await prepareCatalogOwner(
      { models: { mode: "merge" }, agents: { entries: { pro: {} } } },
      [
        {
          entries: [],
          routeVariants: [],
          providerOutcomes: [{ provider: "custom", status: "ready" }],
        },
      ],
    );
    expect(owner.modelCatalog.entries).toContainEqual(expect.objectContaining({ id: "removed" }));

    const refreshed = await owner.loadFullModelCatalog!({ refresh: true });

    expect(refreshed.entries).toEqual([]);
    expect(refreshed.routeVariants).toEqual([]);
    expect(refreshed.providerOutcomes).toEqual([{ provider: "custom", status: "ready" }]);
  });
});

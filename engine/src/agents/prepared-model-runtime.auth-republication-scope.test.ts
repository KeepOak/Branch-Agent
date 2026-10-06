// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { readPreparedGatewayModelCatalogOwnerSnapshot } from "../gateway/server-model-catalog.js";
import {
  readOnlyWorkerScope,
  type SqliteReadOnlyWorkerScope,
} from "../infra/sqlite-readonly-worker-context.js";
import {
  getPendingPreparedModelRuntimeReplacement,
  loadPublishedGatewayReplyDispatchRuntime,
  prepareModelRuntimeSnapshot,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";
import { loadPublishedPreparedModelCatalogOwnerSnapshot } from "./prepared-model-catalog.js";

const fixture = usePreparedModelRuntimeHarness({ label: "prepared-model-runtime-auth-scope" });
const { mocks } = fixture;

function createCallerScope(): SqliteReadOnlyWorkerScope {
  return {
    active: true,
    busy: false,
    controller: new AbortController(),
    pending: new Set(),
    deadlineOwnedByCaller: false,
    readTail: Promise.resolve(),
  };
}

describe("prepared model runtime auth republication scope", () => {
  it("serves another Trunk's system.info and models.list reads while a scoped publication aborts", async () => {
    const config: BranchConfig = { agents: { ownership: "explicit", entries: { default: {}, worker: {} } } };
    mocks.configuredAgentIds = ["default", "worker"];
    await refreshPreparedModelRuntimeSnapshots(config, { gatewayLifecycle: true });
    const workerInput = fixture.agentInput("worker", config);
    const workerSnapshot = await prepareModelRuntimeSnapshot(workerInput, { readPublished: true });

    let buildEntered!: () => void;
    let failBuild!: (error: Error) => void;
    const entered = new Promise<void>((resolve) => { buildEntered = resolve; });
    const heldBuild = new Promise<never>((_resolve, reject) => { failBuild = reject; });
    const defaultDir = fixture.agentInput("default", config).agentDir;
    mocks.ensureBranchModelsJson.mockImplementation(async (_config, agentDir) => {
      if (agentDir === defaultDir) {
        buildEntered();
        return await heldBuild;
      }
      return { agentDir: String(agentDir), wrote: false };
    });
    const publication = refreshPreparedModelRuntimeSnapshots(config, {
      gatewayLifecycle: true,
      agentIds: new Set(["default"]),
    });
    await entered;
    expect(getPendingPreparedModelRuntimeReplacement("worker")).toBeUndefined();
    expect(getPendingPreparedModelRuntimeReplacement("default")).toBeDefined();
    const readSystemInfoCatalog = () => readPreparedGatewayModelCatalogOwnerSnapshot({
      agentId: "worker", getConfig: () => config,
    });
    const readModelsListOwner = () => loadPublishedPreparedModelCatalogOwnerSnapshot({
      agentId: "worker", config, readOnly: true,
    });
    const heldAgentRead = readPreparedGatewayModelCatalogOwnerSnapshot({
      agentId: "default", getConfig: () => config,
    });
    const [systemInfoCatalog, modelsListOwner] = await Promise.race([
      Promise.all([readSystemInfoCatalog(), readModelsListOwner()]),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("other Trunk read waited for scoped replacement")), 5_000)),
    ]);
    expect(systemInfoCatalog?.agentId).toBe("worker");
    expect(modelsListOwner.agentId).toBe("worker");
    expect(workerSnapshot.isCurrent()).toBe(true);

    failBuild(new Error("default preparation watchdog expired"));
    await expect(publication).rejects.toThrow("default preparation watchdog expired");
    await expect(heldAgentRead).rejects.toThrow("default preparation watchdog expired");
    await expect(readSystemInfoCatalog()).resolves.toMatchObject({ agentId: "worker" });
    await expect(readModelsListOwner()).resolves.toMatchObject({ agentId: "worker" });
  });

  it("republishes every configured reply dispatch owner after the mutating caller's reader scope closes", async () => {
    mocks.configuredAgentIds = ["default", "worker"];
    await refreshPreparedModelRuntimeSnapshots({}, { gatewayLifecycle: true });
    mocks.ensureBranchModelsJson.mockImplementation(async (_config, agentDir) => {
      if (readOnlyWorkerScope.getStore()?.active === false) {
        throw new Error("SQLite read-only worker scope closed");
      }
      return { agentDir: String(agentDir), wrote: false };
    });

    // One agent's startup preparation writes the shared auth store inside its own reader scope,
    // which closes as soon as that preparation finishes.
    const callerScope = createCallerScope();
    readOnlyWorkerScope.run(callerScope, () =>
      mocks.mutationListener?.({ affectsInheritedStores: true }),
    );
    callerScope.active = false;

    await expect(
      loadPublishedGatewayReplyDispatchRuntime({ agentId: "worker" }),
    ).resolves.toMatchObject({ agentId: "worker" });
    await expect(
      loadPublishedGatewayReplyDispatchRuntime({ agentId: "default" }),
    ).resolves.toMatchObject({ agentId: "default" });
    expect(mocks.warn).not.toHaveBeenCalled();
  });
});

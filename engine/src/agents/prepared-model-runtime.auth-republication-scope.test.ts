// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it } from "vitest";
import {
  readOnlyWorkerScope,
  type SqliteReadOnlyWorkerScope,
} from "../infra/sqlite-readonly-worker-context.js";
import {
  loadPublishedGatewayReplyDispatchRuntime,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";

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

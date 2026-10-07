// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import {
  acquireAgentRunPreparedModelRuntime,
  loadPublishedGatewayReplyDispatchRuntime,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";

const fixture = usePreparedModelRuntimeHarness({ label: "runtime-supersession-retry" });
const { mocks } = fixture;

describe("model runtime publication supersession", () => {
  it("admits a turn on the successor after its first publication is superseded", async () => {
    const config = {};
    mocks.configuredAgentIds = ["worker"];
    const started = createDeferred();
    const release = createDeferred();
    mocks.ensureBranchModelsJson.mockImplementationOnce(async (_config, agentDir) => {
      started.resolve();
      await release.promise;
      return { agentDir: String(agentDir), wrote: false };
    });
    const initial = refreshPreparedModelRuntimeSnapshots(config, { gatewayLifecycle: true });
    void initial.catch(() => undefined);
    let turn: ReturnType<typeof acquireAgentRunPreparedModelRuntime> | undefined;
    let successor: Promise<void> | undefined;
    try {
      await started.promise;
      turn = acquireAgentRunPreparedModelRuntime(fixture.agentInput("worker", config));
      successor = refreshPreparedModelRuntimeSnapshots(config, { gatewayLifecycle: true });
      release.resolve();
      await successor;
      const lease = await turn;
      expect(lease.snapshot.isCurrent()).toBe(true);
      await lease[Symbol.asyncDispose]();
    } finally {
      release.resolve();
      await Promise.allSettled([initial, turn, successor]);
    }
  });

  it("keeps an admitted turn alive across a config publication", async () => {
    const config = {};
    mocks.configuredAgentIds = ["worker"];
    await refreshPreparedModelRuntimeSnapshots(config, { gatewayLifecycle: true });
    const lease = await acquireAgentRunPreparedModelRuntime(fixture.agentInput("worker", config));
    try {
      await refreshPreparedModelRuntimeSnapshots({ messages: { responsePrefix: "new" } });
      expect(lease.pluginGeneration).toBeDefined();
      expect(lease.snapshot.agentId).toBe("worker");
    } finally {
      await lease[Symbol.asyncDispose]();
    }
  });

  it("delivers reply dispatch after a superseding config publication", async () => {
    mocks.configuredAgentIds = ["worker"];
    await refreshPreparedModelRuntimeSnapshots({}, { gatewayLifecycle: true });
    const started = createDeferred();
    const release = createDeferred();
    mocks.ensureBranchModelsJson.mockImplementationOnce(async (_config, agentDir) => {
      started.resolve();
      await release.promise;
      return { agentDir: String(agentDir), wrote: false };
    });
    const first = refreshPreparedModelRuntimeSnapshots({ messages: { responsePrefix: "old" } });
    void first.catch(() => undefined);
    await started.promise;
    const dispatch = loadPublishedGatewayReplyDispatchRuntime({ agentId: "worker" });
    const successor = refreshPreparedModelRuntimeSnapshots({ messages: { responsePrefix: "new" } });
    release.resolve();
    await Promise.allSettled([first]);
    await successor;
    await expect(dispatch).resolves.toMatchObject({ agentId: "worker" });
  });
});

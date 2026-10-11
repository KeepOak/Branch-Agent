// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import {
  publishPreparedModelRuntimeSnapshot,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";

// Shared-state admission is main-thread only; this harness runs test files in a worker thread.
vi.mock("node:worker_threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:worker_threads")>()),
  isMainThread: true,
}));

const fixture = usePreparedModelRuntimeHarness({ label: "prepared-model-runtime-concurrent-runs" });
const { mocks } = fixture;

function holdNextCatalogWrite() {
  const started = createDeferred();
  const release = createDeferred();
  mocks.ensureBranchModelsJson.mockImplementationOnce(async (_config, agentDir) => {
    started.resolve();
    await release.promise;
    return { agentDir: String(agentDir), wrote: false };
  });
  return { started, release };
}

describe("prepared model runtime concurrent runs", () => {
  it("lets two runs that start at the same moment both complete", async () => {
    mocks.configuredAgentIds = ["worker"];
    const agentDir = fixture.state.agentDir("worker");
    mocks.configuredAgentDirs.set("worker", agentDir);
    await refreshPreparedModelRuntimeSnapshots({}, { gatewayLifecycle: true });
    const input = { config: {}, agentId: "worker", agentDir };
    const hold = holdNextCatalogWrite();

    const runA = publishPreparedModelRuntimeSnapshot(input);
    await hold.started.promise;
    const runB = publishPreparedModelRuntimeSnapshot(input, { force: true });
    hold.release.resolve();

    const [a, b] = await Promise.allSettled([runA, runB]);
    expect(a.status, a.status === "rejected" ? String(a.reason) : "").toBe("fulfilled");
    expect(b.status, b.status === "rejected" ? String(b.reason) : "").toBe("fulfilled");
  });
});

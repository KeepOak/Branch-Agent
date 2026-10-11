// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import { acquirePreparedModelRuntimeLeaseFromOwners } from "./prepared-model-runtime-lease.js";
import {
  acquireAgentRunPreparedModelRuntime,
  loadPublishedGatewayReplyDispatchRuntime,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";
import { createPreparedModelRuntimeReplacement } from "./prepared-model-runtime.lifecycle.js";
import { PreparedModelRuntimePublicationSupersededError } from "./prepared-model-runtime.owner.js";
import { PreparedModelRuntimeOwnerRetention } from "./prepared-model-runtime.retention.js";

const fixture = usePreparedModelRuntimeHarness({ label: "runtime-supersession-retry" });
const { mocks } = fixture;

// Route the admission poll through the fake clock, preserving other timer exports.
vi.mock("node:timers/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:timers/promises")>()),
  setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}));

function startSupersededAdmission() {
  let replacement: ReturnType<typeof createPreparedModelRuntimeReplacement> | undefined =
    createPreparedModelRuntimeReplacement();
  const error = new PreparedModelRuntimePublicationSupersededError("test publication superseded");
  const abort = new AbortController();
  const turn = acquirePreparedModelRuntimeLeaseFromOwners(
    fixture.agentInput("worker", {}),
    "run",
    {
      captureLifetime: () => () => {},
      owners: new Map(),
      agentBuildCompletions: new Map(),
      retainedDirectRunOwners: new PreparedModelRuntimeOwnerRetention(1),
      retainedGatewayRunOwners: new PreparedModelRuntimeOwnerRetention(8),
      getBuildTimeoutMs: () => 120_000,
      getGatewayLifecycleActive: () => false,
      getPendingReplacement: () => replacement,
    },
    { abortSignal: abort.signal },
  );
  const outcome = turn.then(
    (lease) => ({ lease, error: undefined, settledAt: Date.now() }),
    (error: unknown) => ({ lease: undefined, error, settledAt: Date.now() }),
  );
  replacement.reject(error);
  return {
    outcome,
    error,
    abort,
    supersede: () => {
      replacement = createPreparedModelRuntimeReplacement();
      replacement.reject(error);
    },
    publish: () => {
      replacement = undefined;
    },
  };
}

describe("model runtime publication supersession", () => {
  it("admits the last generation after three successive supersessions 60 seconds apart", async () => {
    vi.useFakeTimers();
    const admission = startSupersededAdmission();
    try {
      await vi.advanceTimersByTimeAsync(60_000);
      admission.supersede();
      await vi.advanceTimersByTimeAsync(60_000);
      admission.supersede();
      await vi.advanceTimersByTimeAsync(60_000);
      admission.publish();
      await vi.advanceTimersByTimeAsync(250);
      const result = await admission.outcome;
      expect(result.error).toBeUndefined();
      expect(result.lease?.snapshot.agentId).toBe("worker");
      expect(result.lease?.snapshot.isCurrent()).toBe(true);
      await result.lease?.[Symbol.asyncDispose]();
    } finally {
      admission.abort.abort();
      await admission.outcome;
      vi.useRealTimers();
    }
  });

  it("throws after 120 seconds without publication progress", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const admission = startSupersededAdmission();
    try {
      await vi.advanceTimersByTimeAsync(119_750);
      let settled = false;
      void admission.outcome.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(250);
      const result = await admission.outcome;
      expect(result.error).toBe(admission.error);
      expect(result.settledAt - startedAt).toBe(120_000);
    } finally {
      admission.abort.abort();
      await admission.outcome;
      vi.useRealTimers();
    }
  });

  it("caps admission at 600 seconds despite supersessions every 60 seconds", async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const admission = startSupersededAdmission();
    try {
      for (let elapsed = 60_000; elapsed < 600_000; elapsed += 60_000) {
        await vi.advanceTimersByTimeAsync(60_000);
        admission.supersede();
      }
      await vi.advanceTimersByTimeAsync(60_000);
      const result = await admission.outcome;
      expect(result.error).toBe(admission.error);
      expect(result.settledAt - startedAt).toBe(600_000);
    } finally {
      admission.abort.abort();
      await admission.outcome;
      vi.useRealTimers();
    }
  });

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

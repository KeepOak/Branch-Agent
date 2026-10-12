// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import {
  MAX_STARTUP_PUBLICATION_SKIPS,
  publishStartupModelsUntilUnskipped,
} from "../gateway/server-agent-database-startup.js";
import { AgentDatabasePreparationSupersededError } from "../state/agent-database-admission.js";
import { acquirePreparedModelRuntimeLeaseFromOwners } from "./prepared-model-runtime-lease.js";
import {
  acquireAgentRunPreparedModelRuntime,
  getPreparedModelRuntimeSnapshot,
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

  it("reports a publication that a superseding refresh drops before its auth drain (the queued task's currency check), so startup can publish it again", async () => {
    const config = {};
    mocks.configuredAgentIds = ["worker"];
    const started = createDeferred();
    const release = createDeferred();
    mocks.ensureBranchModelsJson.mockImplementationOnce(async (_config, agentDir) => {
      started.resolve();
      await release.promise;
      return { agentDir: String(agentDir), wrote: false };
    });
    let skipped = 0;
    const first = refreshPreparedModelRuntimeSnapshots(config, {
      gatewayLifecycle: true,
      onPublicationSkipped: () => {
        skipped += 1;
      },
    });
    void first.catch(() => undefined);
    await started.promise;
    const successor = refreshPreparedModelRuntimeSnapshots(config, { gatewayLifecycle: true });
    release.resolve();
    await Promise.allSettled([first]);
    await successor;
    expect(skipped).toBeGreaterThan(0);
    expect(getPreparedModelRuntimeSnapshot(fixture.agentInput("worker", config))).toBeDefined();
  });

  it("republishes a superseded startup publication within the same attempt", async () => {
    const config = {};
    mocks.configuredAgentIds = ["worker", "sibling"];
    const started = createDeferred();
    const release = createDeferred();
    mocks.ensureBranchModelsJson.mockImplementationOnce(async (_config, agentDir) => {
      started.resolve();
      await release.promise;
      return { agentDir: String(agentDir), wrote: false };
    });
    let attempts = 0;
    let successor: Promise<void> | undefined;
    let republished = 0;
    const attempt = publishStartupModelsUntilUnskipped({
      assertCurrent: () => undefined,
      onRepublish: () => {
        republished += 1;
      },
      publishOnce: async (onSkipped) => {
        attempts += 1;
        // A later attempt must not supersede the successor the first attempt started.
        await successor?.catch(() => undefined);
        const publication = refreshPreparedModelRuntimeSnapshots(config, {
          gatewayLifecycle: true,
          onPublicationSkipped: onSkipped,
        });
        if (attempts === 1) {
          void publication.catch(() => undefined);
          await started.promise;
          successor = refreshPreparedModelRuntimeSnapshots(config, {
            gatewayLifecycle: true,
          });
          release.resolve();
        }
        await publication.catch((error: unknown) => {
          if (!(error instanceof PreparedModelRuntimePublicationSupersededError)) {
            throw error;
          }
          onSkipped();
        });
      },
    });
    await attempt;
    await successor?.catch(() => undefined);
    expect(attempts).toBe(2);
    expect(republished).toBe(1);
    expect(getPreparedModelRuntimeSnapshot(fixture.agentInput("worker", config))).toBeDefined();
  });

  it("republishes a publication whose gate a newer scoped refresh replaces during its auth drain (commitReplacement's replaced-gate branch)", async () => {
    const config = {};
    mocks.configuredAgentIds = ["worker"];
    await refreshPreparedModelRuntimeSnapshots(config, { gatewayLifecycle: true });
    const worker = fixture.agentInput("worker", config);
    const buildStarted = createDeferred();
    const releaseBuild = createDeferred();
    const drainStarted = createDeferred();
    const releaseDrain = createDeferred();
    let draining = false;
    mocks.ensureBranchModelsJson
      .mockImplementationOnce(async (_config, agentDir) => {
        buildStarted.resolve();
        await releaseBuild.promise;
        return { agentDir: String(agentDir), wrote: false };
      })
      .mockImplementationOnce(async (_config, agentDir) => {
        // The auth drain's rebuild runs after the publication's last currency check.
        draining = true;
        drainStarted.resolve();
        await releaseDrain.promise;
        return { agentDir: String(agentDir), wrote: false };
      });
    const scoped = { agentIds: new Set(["worker"]), gatewayLifecycle: true };
    let attempts = 0;
    let republished = 0;
    let firstOutcome: Promise<unknown> | undefined;
    let successor: Promise<void> | undefined;
    await publishStartupModelsUntilUnskipped({
      assertCurrent: () => undefined,
      onRepublish: () => {
        republished += 1;
      },
      publishOnce: async (onSkipped) => {
        attempts += 1;
        await successor;
        const publication = refreshPreparedModelRuntimeSnapshots(config, {
          ...scoped,
          onPublicationSkipped: onSkipped,
        });
        if (attempts === 1) {
          firstOutcome = publication.then(
            () => "resolved",
            (error: unknown) => error,
          );
          await buildStarted.promise;
          // An auth change during the build joins this publication's gate, so it drains it.
          mocks.mutationListener?.({ agentDir: worker.agentDir, affectsInheritedStores: false });
          releaseBuild.resolve();
          await drainStarted.promise;
          // A newer scoped refresh replaces the pending gate while the drain runs.
          successor = refreshPreparedModelRuntimeSnapshots(config, scoped);
          releaseDrain.resolve();
        }
        await publication;
      },
    });
    expect(draining).toBe(true);
    // The replaced-gate branch returns quietly; the not-current branch rejects as superseded.
    await expect(firstOutcome).resolves.toBe("resolved");
    expect(attempts).toBe(2);
    expect(republished).toBe(1);
    expect(getPreparedModelRuntimeSnapshot(worker)).toBeDefined();
  });

  it("fails a startup publication whose config or secrets change while it is republished", async () => {
    let publishes = 0;
    let checks = 0;
    const attempt = publishStartupModelsUntilUnskipped({
      assertCurrent: () => {
        checks += 1;
        if (checks >= 1) {
          throw new AgentDatabasePreparationSupersededError("config changed");
        }
      },
      onRepublish: () => undefined,
      publishOnce: async (onSkipped) => {
        publishes += 1;
        onSkipped();
      },
    });
    await expect(attempt).rejects.toBeInstanceOf(AgentDatabasePreparationSupersededError);
    expect(publishes).toBe(1);
  });

  it("fails a startup publication as superseded after too many skips in a row", async () => {
    let publishes = 0;
    const attempt = publishStartupModelsUntilUnskipped({
      assertCurrent: () => undefined,
      onRepublish: () => undefined,
      publishOnce: async (onSkipped) => {
        publishes += 1;
        onSkipped();
      },
    });
    await expect(attempt).rejects.toThrow(/superseded/);
    expect(publishes).toBe(MAX_STARTUP_PUBLICATION_SKIPS);
  });

  it("does not report a successful publication as skipped", async () => {
    const config = {};
    mocks.configuredAgentIds = ["worker"];
    let skipped = 0;
    await refreshPreparedModelRuntimeSnapshots(config, {
      gatewayLifecycle: true,
      onPublicationSkipped: () => {
        skipped += 1;
      },
    });
    expect(skipped).toBe(0);
    expect(getPreparedModelRuntimeSnapshot(fixture.agentInput("worker", config))).toBeDefined();
  });
});

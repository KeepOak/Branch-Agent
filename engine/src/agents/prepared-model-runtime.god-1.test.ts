// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "./prepared-model-runtime.test-harness.js";
import { describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../packages/gateway-protocol/src/index.js";
import { createDeferred } from "../../test/helpers/promise.js";
import type { BranchConfig } from "../config/types.branch.js";
import * as admission from "../gateway/agent-turn/agent-run-admission-revalidation.js";
import { RUNTIME_RACE_SUMMARY } from "../sessions/session-run-error-presentation.js";
import * as modelLease from "./prepared-model-runtime-lease.js";
import {
  acquireAgentRunPreparedModelRuntime,
  loadPublishedGatewayReplyDispatchRuntime,
  publishPreparedModelRuntimeSnapshot,
  refreshPreparedModelRuntimeSnapshots,
} from "./prepared-model-runtime.js";
import { createPreparedModelRuntimeReplacement } from "./prepared-model-runtime.lifecycle.js";
import { PreparedModelRuntimeOwnerRetention } from "./prepared-model-runtime.retention.js";
import * as adoption from "./prepared-model-runtime.superseded-adoption.js";
import { PreparedReplyDispatchPublicationOwner } from "./prepared-reply-dispatch-runtime.js";

const fixture = usePreparedModelRuntimeHarness({ label: "runtime-god-1" });
const { mocks } = fixture;

vi.mock("node:timers/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:timers/promises")>()),
  setTimeout: (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
}));

describe("god-1 compatibility-based publication adoption", () => {
  it("god-1 test 1: two turns for different Trunks start while publication swaps and both complete", async () => {
    const config: BranchConfig = { agents: { defaults: { model: "custom/first" } } };
    const started = createDeferred();
    const release = createDeferred();
    mocks.ensureBranchModelsJson.mockImplementationOnce(async (_config, agentDir) => {
      started.resolve();
      await release.promise;
      return { agentDir: String(agentDir), wrote: false };
    });
    // Each turn is waiting for its lifecycle publication before taking its execution lease.
    const inputs = ["elm", "oak"].map((id) => fixture.agentInput(id, config));
    const publications = inputs.map((input) => publishPreparedModelRuntimeSnapshot(input));
    const turns = publications.map(async (publication, index) => {
      const snapshot = await publication;
      const lease = await acquireAgentRunPreparedModelRuntime({
        ...inputs[index]!,
        config: snapshot.config,
      });
      try {
        expect(lease.snapshot.isCurrent()).toBe(true);
        return lease.snapshot.agentId;
      } finally {
        await lease[Symbol.asyncDispose]();
      }
    });
    const outcomes = Promise.allSettled(turns);
    const successors: Promise<unknown>[] = [];
    try {
      await started.promise;
      const next = {
        ...structuredClone(config),
        logging: { level: "debug" as const },
        auth: { order: { unrelated: ["unrelated:default"] } },
      };
      successors.push(
        ...inputs.map((input) =>
          publishPreparedModelRuntimeSnapshot({ ...input, config: next }, { force: true }),
        ),
      );
      release.resolve();
      await Promise.all(successors);
      expect(await outcomes).toEqual([
        { status: "fulfilled", value: "elm" },
        { status: "fulfilled", value: "oak" },
      ]);
      const input = inputs[0]!;
      expect(adoption.hasCompatibleRuntimeInput(input, { ...input, config: next })).toBe(true);
      for (const incompatible of [
        { ...config, agents: { defaults: { model: "custom/second" } } },
        { ...config, auth: { order: { custom: ["custom:other"] } } },
        { ...config, tools: { deny: ["exec"] } },
      ]) {
        expect(adoption.hasCompatibleRuntimeInput(input, { ...input, config: incompatible })).toBe(
          false,
        );
      }
      expect(
        adoption.hasCompatibleRuntimeInput(input, {
          ...input,
          config: {
            ...config,
            agents: { ...config.agents, entries: { birch: { model: "custom/second" } } },
          },
        }),
      ).toBe(true);
    } finally {
      release.resolve();
      await Promise.allSettled([...publications, ...turns, ...successors]);
    }
  });

  it("god-1 test 2: different model config re-admits the waiting turn and completes without superseded text", async () => {
    const config: BranchConfig = { agents: { defaults: { model: "custom/first" } } };
    mocks.configuredAgentIds = ["elm"];
    await refreshPreparedModelRuntimeSnapshots(config, { gatewayLifecycle: true });
    const admitted = await loadPublishedGatewayReplyDispatchRuntime({ agentId: "elm" });
    const next: BranchConfig = { agents: { defaults: { model: "custom/second" } } };
    const started = createDeferred();
    const release = createDeferred();
    mocks.ensureBranchModelsJson.mockImplementationOnce(async (_config, agentDir) => {
      started.resolve();
      await release.promise;
      return { agentDir: String(agentDir), wrote: false };
    });
    const publication = refreshPreparedModelRuntimeSnapshots(next, { gatewayLifecycle: true });
    await started.promise;
    const derive = vi.fn(({ config: current }: { config: BranchConfig }) => [
      { provider: "custom", modelId: current === next ? "second" : "first", runtime: "branch" },
    ]);
    const turn = acquireAgentRunPreparedModelRuntime(fixture.agentInput("elm", config), {
      pluginGeneration: admitted!.pluginGeneration,
      rejoinSupersededPluginGeneration: true,
      deriveRuntimePluginSelections: derive,
    });
    const outcome = turn.then(
      (lease) => ({ lease, error: undefined }),
      (error: unknown) => ({ lease: undefined, error }),
    );
    try {
      release.resolve();
      await publication;
      const result = await outcome;
      expect(result.error).toBeUndefined();
      expect(result.lease?.snapshot.config).toBe(next);
      expect(derive).toHaveBeenCalledWith(expect.objectContaining({ config: next }));
      expect(derive.mock.calls.at(-1)?.[0].config).toBe(next);
      const dispatch = admission.rebindAgentRunReplyDispatchRuntime(admitted!, result.lease!);
      expect(dispatch.config).toBe(next);
      expect(dispatch.pluginGeneration).toBe(result.lease!.pluginGeneration);
      expect(admitted!.config).toBe(config);
      await result.lease?.[Symbol.asyncDispose]();
    } finally {
      release.resolve();
      const result = await outcome;
      await result.lease?.[Symbol.asyncDispose]();
      await publication;
    }
  });

  it("god-1 test 3: a publication that never lands fails after the bound with the plain sentence and no hang", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    let replacement = createPreparedModelRuntimeReplacement();
    const startedAt = Date.now();
    let result: { error: unknown; settledAt: number } | undefined;
    const context = {
      captureLifetime: () => () => {},
      owners: new Map(),
      agentBuildCompletions: new Map(),
      retainedDirectRunOwners: new PreparedModelRuntimeOwnerRetention(1),
      retainedGatewayRunOwners: new PreparedModelRuntimeOwnerRetention(8),
      getBuildTimeoutMs: () => 120_000,
      getGatewayLifecycleActive: () => true,
      getPendingReplacement: () => replacement,
    };
    const turn = modelLease.acquirePreparedModelRuntimeLeaseFromOwners(
      fixture.agentInput("elm", {}),
      "run",
      context,
      { abortSignal: abort.signal },
    );
    const outcome = turn.then(
      async (lease) => {
        await lease[Symbol.asyncDispose]();
      },
      (error: unknown) => {
        result = { error, settledAt: Date.now() };
      },
    );
    const phases: Promise<unknown>[] = [outcome];
    try {
      await vi.advanceTimersByTimeAsync(119_999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toBeDefined();
      expect(result!.settledAt - startedAt).toBe(120_000);
      const refusal = admission.resolveAgentRunAdmissionError(
        ErrorCodes.UNAVAILABLE,
        result!.error,
      );
      expect(refusal.message).toBe(RUNTIME_RACE_SUMMARY);
      expect(refusal.message).not.toMatch(/superseded|publication/i);

      // Actual Gateway dispatch admission sees a new publication each minute. Its progress
      // renews the idle bound, not the total budget subsequently handed to lease admission.
      const totalStartedAt = Date.now();
      const budget = modelLease.createPreparedModelRuntimeAdmissionBudget(abort.signal);
      replacement = createPreparedModelRuntimeReplacement();
      let active = true;
      const dispatch = new PreparedReplyDispatchPublicationOwner({
        isGatewayLifecycleActive: () => active,
        getConfiguredOwner: () => undefined,
        getPendingReplacement: () => replacement.promise,
      });
      let readerSignal: AbortSignal | undefined;
      let dispatchError: unknown;
      const dispatchOutcome = admission
        .waitForAgentRunRuntimePublication(budget, abort.signal, (signal) => {
          readerSignal = signal;
          return dispatch.load({ agentId: "elm", abortSignal: signal, admissionBudget: budget });
        })
        .catch((error: unknown) => {
          dispatchError = error;
        });
      phases.push(dispatchOutcome);
      for (let elapsed = 60_000; elapsed <= 540_000; elapsed += 60_000) {
        await vi.advanceTimersByTimeAsync(60_000);
        if (elapsed === 540_000) {
          active = false;
        }
        replacement.resolve();
        replacement = createPreparedModelRuntimeReplacement();
        await vi.advanceTimersByTimeAsync(0);
      }
      await dispatchOutcome;
      expect(dispatchError).toBeUndefined();
      expect(readerSignal?.aborted).toBe(true);
      expect(abort.signal.aborted).toBe(false);
      result = undefined;
      const readmission = modelLease
        .acquirePreparedModelRuntimeLeaseFromOwners(fixture.agentInput("elm", {}), "run", context, {
          abortSignal: abort.signal,
          admissionBudget: budget,
        })
        .then(
          async (lease) => {
            await lease[Symbol.asyncDispose]();
          },
          (error: unknown) => {
            result = { error, settledAt: Date.now() };
          },
        );
      phases.push(readmission);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toBeDefined();
      expect(result!.settledAt - totalStartedAt).toBe(600_000);
      expect(
        admission.resolveAgentRunAdmissionError(ErrorCodes.UNAVAILABLE, result!.error).message,
      ).toBe(RUNTIME_RACE_SUMMARY);
    } finally {
      abort.abort();
      await Promise.allSettled(phases);
      vi.useRealTimers();
    }
  });
});

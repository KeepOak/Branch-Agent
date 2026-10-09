import { beforeEach, expect, it, vi } from "vitest";
import * as availableMemory from "../../../scripts/lib/available-memory.mjs";
import { createDeferred } from "../../../test/helpers/promise.js";
import { getAgentEventLifecycleGeneration, onAgentEvent } from "../../infra/agent-events.js";
import { startAgentRunExecution } from "./agent-run-execution-phase.js";
const { dispatchAgentRunFromGateway } = vi.hoisted(() => ({
  dispatchAgentRunFromGateway: vi.fn(),
}));
vi.mock("./agent-run-dispatch.js", () => ({ dispatchAgentRunFromGateway }));
beforeEach(() => dispatchAgentRunFromGateway.mockReset());
function createExecution(
  options: {
    aborted?: boolean;
    assertContextCurrent?: () => void;
    pendingInputSettlement?: () => Promise<void>;
  } = {},
) {
  const abortCleanup = vi.fn();
  const gatewayRelease = vi.fn();
  const callerRelease = vi.fn();
  const { promise: runtimeReleased, resolve: resolveRuntimeReleased } = createDeferred();
  const runtimeRelease = vi.fn(async () => resolveRuntimeReleased());
  const controller = new AbortController();
  if (options.aborted) {
    controller.abort();
  }
  return {
    abortCleanup,
    gatewayRelease,
    callerRelease,
    runtimeRelease,
    runtimeReleased,
    params: {
      assertContextCurrent: options.assertContextCurrent,
      prepared: {
        releaseCallerAuthority: callerRelease,
        activeGatewayWorkAdmission: {
          release: gatewayRelease,
          run: async (run: () => Promise<void>) => await run(),
        },
        activeRunAbort: {
          cleanup: abortCleanup,
          controller,
          registered: false,
        },
        effectiveAllowModelOverride: false,
        lifecycleStorePath: "",
        operationalRunInstance: {},
        preparedModelRuntimeLease: { [Symbol.asyncDispose]: runtimeRelease, snapshot: {} },
        replyDispatchRuntime: {
          config: { runtime: "A" },
          pluginGeneration: "generation-A",
        },
        unpersistedOffloadedRefs: [],
        userTurn: {
          recorder: options.pendingInputSettlement
            ? { waitForPendingInputSettlement: options.pendingInputSettlement }
            : undefined,
          execApprovalFollowupHandoffClaimId: "claim",
          message: "continue",
          senderIsOwner: false,
          suppressPromptPersistence: false,
        },
        workspaceOverride: undefined,
      },
      request: {},
      cfg: {},
      activeSessionAgentId: "main",
      delivery: {},
      isNewSession: false,
      isRawModelRun: true,
      isOneShotModelRun: true,
      isRestartRecoveryResumeRun: false,
      suppressVisibleSessionEffects: true,
      images: [],
      imageOrder: [],
      media: [],
      runId: "owner-test",
      agentDedupeKeys: [],
      bestEffortDeliver: false,
      lifecycleGeneration: "test",
      preserveUserFacingSessionModelState: false,
      skipAgentInitialSessionTouch: true,
      canUseInternalRuntimeHandoff: false,
      client: null,
      context: {
        getSessionEventSubscriberConnIds: () => new Set(),
        dedupe: new Map(),
        deps: {},
        logGateway: { error: vi.fn(), warn: vi.fn() },
      },
      io: {
        emitAcceptance: vi.fn(),
        emitFinal: vi.fn(),
      },
      releaseCronContinuationClaimWithRecovery: async () => true,
    } as unknown as Parameters<typeof startAgentRunExecution>[0],
  };
}

it("the eighth heavy execution waits for RAM and resumes without resubmission", async () => {
  const memory = vi.spyOn(availableMemory, "availableMemoryBytes").mockReturnValue(11 * 1024 ** 2);
  const completion = createDeferred<void>();
  dispatchAgentRunFromGateway.mockImplementation(() => completion.promise);
  const executions = Array.from({ length: 8 }, (_, index) => {
    const execution = createExecution();
    execution.params.runId = `memory-heavy-${index}`;
    execution.params.lifecycleGeneration = getAgentEventLifecycleGeneration();
    execution.params.request.lane = "subagent";
    execution.params.cfg = {
      agents: { defaults: { memoryAdmission: { reserveMb: 4, estimatedRunMb: 1 } } },
    };
    return execution;
  });
  const waits = vi.fn();
  const unsubscribe = onAgentEvent((event) => {
    if (event.runId === "memory-heavy-7" && event.data.phase === "waiting_for_memory") {
      waits(event.data);
    }
  });
  const running = executions.map((execution) => startAgentRunExecution(execution.params));
  try {
    await vi.waitFor(() =>
      expect(waits).toHaveBeenCalledWith({ phase: "waiting_for_memory", ahead: 0 }),
    );
    expect(dispatchAgentRunFromGateway).toHaveBeenCalledTimes(7);
    memory.mockReturnValue(12 * 1024 ** 2);
    await vi.waitFor(() => expect(dispatchAgentRunFromGateway).toHaveBeenCalledTimes(8));
  } finally {
    executions.forEach((execution) => execution.params.prepared.activeRunAbort.controller.abort());
    completion.resolve();
    await Promise.all(running);
    unsubscribe();
    memory.mockRestore();
  }
});

it("chat-only execution starts while a heavy execution is memory queued", async () => {
  const memory = vi.spyOn(availableMemory, "availableMemoryBytes").mockReturnValue(0);
  const heavy = createExecution();
  heavy.params.lifecycleGeneration = getAgentEventLifecycleGeneration();
  heavy.params.request.lane = "subagent";
  const waits = vi.fn();
  const unsubscribe = onAgentEvent((event) => {
    if (event.data.phase === "waiting_for_memory") {
      waits();
    }
  });
  const queued = startAgentRunExecution(heavy.params);
  try {
    await vi.waitFor(() => expect(waits).toHaveBeenCalled());
    expect(dispatchAgentRunFromGateway).not.toHaveBeenCalled();
    const chat = createExecution();
    chat.params.runId = "memory-chat";
    chat.params.request.workKind = "chat";
    chat.params.lifecycleGeneration = getAgentEventLifecycleGeneration();
    await startAgentRunExecution(chat.params);
    expect(dispatchAgentRunFromGateway).toHaveBeenCalledOnce();
    heavy.params.prepared.activeRunAbort.controller.abort();
    await queued;
    expect(dispatchAgentRunFromGateway).toHaveBeenCalledOnce();
    expect(heavy.gatewayRelease).toHaveBeenCalledOnce();
  } finally {
    heavy.params.prepared.activeRunAbort.controller.abort();
    await queued;
    unsubscribe();
    memory.mockRestore();
  }
});

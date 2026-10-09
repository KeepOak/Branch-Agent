/** A Codex Trunk's next turn runs on the model it was allowed to switch to, on the same thread, in the same engine. */
// test/setup.extensions.ts prepares compiled subprocess declarations before collection for
// app-server tests; the named feature batch doesn't load it, so this file does it first.
import "../../../../src/test-utils/prepare-compiled-subprocesses.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelChoiceDecision } from "../../../../src/agents/model-choice.js";
import {
  ASKING_EXEC,
  createTrunkSession,
  FULL_ACCESS_EXEC,
  MODEL_CHOICE_PROVIDER,
  startModelChoiceGateway,
  TRUNK_MODELS,
  trunkModelChoiceConfig,
  useModelChoiceRuntime,
} from "../../../../src/agents/model-choice.next-turn.test-support.js";
import type { BranchConfig } from "../../../../src/config/types.branch.js";
import {
  createParams,
  createResumeHarness,
  fastWait,
  runCodexAppServerAttempt,
  setupRunAttemptTestHooks,
  tempDir,
} from "./run-attempt-test-harness.js";
import {
  readCodexAppServerBinding,
  writeCodexAppServerBinding,
} from "./session-binding.test-helpers.js";

const hoisted = vi.hoisted(() => ({
  approval: vi.fn<(params: { question: string }) => Promise<"allow" | "deny" | "unavailable">>(),
  catalog: ["gpt-5.4", "gpt-5.5", "claude-opus-4-7", "claude-sonnet-4-6"].map((id) => ({
    provider: "fixture",
    id,
    name: id,
    reasoning: false,
  })),
}));
// The approve card itself is covered against the real approval manager in model-choice-approval.test.ts.
vi.mock("../../../../src/gateway/server-methods/model-choice-approval.js", () => ({
  requestModelChoiceApproval: hoisted.approval,
}));
vi.mock("../../../../src/agents/model-runtime-choice.js", () => ({
  preparePublishedModelRuntimeChoice: async () => ({
    kind: "ready",
    runtimeId: "model-choice-native",
    harness: {
      id: "model-choice-native",
      label: "Model choice fixture",
      executionEnvironment: "host-only",
      supports: () => ({ supported: true }),
      runAttempt: async () => {
        throw new Error("Model selection must not start a turn");
      },
    },
    validate: () => undefined,
  }),
}));
vi.mock("../../../../src/agents/model-catalog.runtime.js", () => ({
  loadProviderScopedThinkingCatalog: async () => hoisted.catalog,
}));
vi.mock("../../../../src/status/status-text.js", () => ({
  buildStatusText: async () => "Session status",
}));

// The named feature batch runs this file without test/setup.extensions.ts; give the run-attempt
// hooks the same Codex attempt runtime that setup file provides for app-server tests.
beforeEach(async (context) => {
  if (context.codexAttemptRuntime) {
    return;
  }
  const [workerCpu, mcp, clocks] = await Promise.all([
    vi.importActual<typeof import("../../../../src/infra/worker-cpu.js")>(
      "../../../../src/infra/worker-cpu.js",
    ),
    vi.importActual<typeof import("../../../../src/agents/agent-bundle-mcp-manager-api.js")>(
      "../../../../src/agents/agent-bundle-mcp-manager-api.js",
    ),
    vi.importActual<typeof import("../../../../src/test-utils/gateway-scheduler-clock.js")>(
      "../../../../src/test-utils/gateway-scheduler-clock.js",
    ),
  ]);
  let stop: (() => Promise<void>) | undefined;
  context.codexAttemptRuntime = {
    readWorkerPools: workerCpu.getTrackedWorkerPoolSnapshot,
    start: async () => {
      const scheduler = clocks.createTestGatewayScheduler();
      stop = async () => {
        scheduler.beginClose();
        try {
          await mcp.disposeAllSessionMcpRuntimes();
        } finally {
          await scheduler.stop();
        }
      };
      await mcp.setSessionMcpRuntimeScheduler(scheduler);
    },
    stop: async () => {
      await stop?.();
    },
  };
});

setupRunAttemptTestHooks();

const { from, to } = TRUNK_MODELS.codex;
const THREAD = "thread-existing";

let gateway: Awaited<ReturnType<typeof startModelChoiceGateway>>;

beforeAll(async () => {
  gateway = await startModelChoiceGateway();
});
afterAll(async () => {
  await gateway.stop();
});
beforeEach(() => {
  hoisted.approval.mockReset();
});

/** A Codex Trunk mid-task: its thread is bound to `from` and its session row says so too. */
async function codexTrunk(tools: NonNullable<BranchConfig["tools"]>) {
  const cfg = trunkModelChoiceConfig(tools);
  const restore = useModelChoiceRuntime(cfg);
  const trunk = await createTrunkSession({ state: gateway.state, cfg, model: from });
  const sessionFile = `${tempDir}/session.jsonl`;
  const workspaceDir = `${tempDir}/workspace`;
  await writeCodexAppServerBinding(sessionFile, {
    threadId: THREAD,
    cwd: workspaceDir,
    model: from,
    modelProvider: "openai",
    historyCoveredThrough: new Date().toISOString(),
    webSearchThreadConfigFingerprint: JSON.stringify({
      "features.standalone_web_search": false,
      web_search: "disabled",
    }),
  });
  const harness = createResumeHarness(THREAD);
  let turns = 0;
  /** Runs one Codex turn on `model` and returns the model its turn/start carried. */
  const runTurn = async (model: string) => {
    turns += 1;
    const params = createParams(sessionFile, workspaceDir, {
      provider: "openai",
      runId: `run-${turns}`,
    });
    params.modelId = model;
    // Room for a cold first attempt; each turn still completes as soon as the fixture says so.
    params.timeoutMs = 60_000;
    const run = runCodexAppServerAttempt(params);
    await vi.waitFor(
      () =>
        expect(harness.requests.filter(({ method }) => method === "turn/start")).toHaveLength(
          turns,
        ),
      // A cold first attempt (no shared extension setup) can take longer than fastWait to start.
      { interval: fastWait.interval, timeout: 60_000 },
    );
    await harness.completeTurn({ threadId: THREAD, turnId: "turn-1" });
    await run;
    const turnStart = harness.requests.findLast(({ method }) => method === "turn/start");
    return (turnStart?.params as { model?: string } | undefined)?.model;
  };
  /** The model the active run uses next: the pending switch, else the one it is on. */
  const nextTurn = async () => {
    const live = await trunk.liveSwitchFrom(from);
    if (live) {
      expect(live.provider).toBe(MODEL_CHOICE_PROVIDER);
    }
    return await runTurn(live?.model ?? from);
  };
  return { trunk, harness, runTurn, nextTurn, sessionFile, restore };
}

describe("Codex Trunk next turn after its own model change", () => {
  it("setting on with Full access: the next turn on the same thread runs on the new model, without a restart", async () => {
    const codex = await codexTrunk({ exec: FULL_ACCESS_EXEC, modelChoice: { enabled: true } });
    try {
      expect(await codex.runTurn(from)).toBe(from);

      await codex.trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`);

      expect(codex.trunk.read()).toMatchObject({ modelOverride: to, liveModelSwitchPending: true });
      expect(await codex.nextTurn()).toBe(to);
      // The same live thread carries on: no new thread, and one resume before each turn/start.
      // main's Codex process admission (run-attempt-resources.ts, requiresProcessAdmission) resumes
      // the bound thread once per attempt, so two turns give two resumes. A third would fail here.
      const methods = codex.harness.requests.map(({ method }) => method);
      expect(methods.filter((method) => method === "thread/resume" || method === "turn/start")).toEqual(
        ["thread/resume", "turn/start", "thread/resume", "turn/start"],
      );
      const resumes = codex.harness.requests.filter(({ method }) => method === "thread/resume");
      expect(
        resumes.every(({ params }) => (params as { threadId?: string }).threadId === THREAD),
      ).toBe(true);
      expect(methods).not.toContain("thread/start");
      const turnStarts = codex.harness.requests.filter(({ method }) => method === "turn/start");
      expect(turnStarts.map(({ params }) => (params as { threadId?: string }).threadId)).toEqual([
        THREAD,
        THREAD,
      ]);
      expect(await readCodexAppServerBinding(codex.sessionFile)).toMatchObject({
        threadId: THREAD,
        model: to,
      });
      expect(codex.trunk.nextTurnModel()).toBe(to);
      expect(hoisted.approval).not.toHaveBeenCalled();
    } finally {
      await codex.restore();
    }
  });

  it("setting off: the change is refused and the next turn stays on the same model", async () => {
    const codex = await codexTrunk({ exec: FULL_ACCESS_EXEC });
    try {
      expect(await codex.runTurn(from)).toBe(from);

      await expect(
        codex.trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`),
      ).rejects.toThrow('"Trunks may switch their own model" is off');

      expect(codex.trunk.read().modelOverride).toBe(from);
      expect(await codex.nextTurn()).toBe(from);
      expect(await readCodexAppServerBinding(codex.sessionFile)).toMatchObject({ model: from });
      expect(codex.trunk.nextTurnModel()).toBe(from);
    } finally {
      await codex.restore();
    }
  });

  it("without Full access: a deny keeps the next turn on the same model; after allow it switches", async () => {
    const codex = await codexTrunk({ exec: ASKING_EXEC, modelChoice: { enabled: true } });
    try {
      expect(await codex.runTurn(from)).toBe(from);

      hoisted.approval.mockResolvedValueOnce("deny");
      await expect(
        codex.trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`),
      ).rejects.toThrow("The model stays as it was.");
      expect(await codex.nextTurn()).toBe(from);

      hoisted.approval.mockResolvedValueOnce("allow" satisfies ModelChoiceDecision);
      await codex.trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`);
      expect(await codex.nextTurn()).toBe(to);
      expect(hoisted.approval).toHaveBeenCalledTimes(2);
    } finally {
      await codex.restore();
    }
  });
});

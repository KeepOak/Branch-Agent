/** A Claude Trunk's next turn runs on the model it was allowed to switch to, in the same engine process. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import type { BranchConfig } from "../config/types.branch.js";
import { invokeNodeClaudeCliRun } from "../gateway/node-agent-cli-runtime.js";
import type { BranchTestState } from "../test-utils/branch-test-state.js";
import { buildPreparedCliRunContext } from "./cli-runner.test-helpers.js";
import { executePreparedCliRun as executePreparedCliRunImpl } from "./cli-runner/execute.js";
import {
  createManagedRun,
  createSuccessfulProcessExit,
  setCliRunnerExecuteTestDeps,
  supervisorSpawnMock,
  wrapPreparedCliRunWithTestAdmission,
} from "./cli-runner/execute.test-support.js";
import { writeCliSystemPromptFile } from "./cli-runner/helpers.js";
import type { ModelChoiceDecision } from "./model-choice.js";
import {
  ASKING_EXEC,
  createTrunkSession,
  FULL_ACCESS_EXEC,
  MODEL_CHOICE_PROVIDER,
  startModelChoiceGateway,
  TRUNK_MODELS,
  trunkModelChoiceConfig,
  useModelChoiceRuntime,
} from "./model-choice.next-turn.test-support.js";

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
vi.mock("../gateway/server-methods/model-choice-approval.js", () => ({
  requestModelChoiceApproval: hoisted.approval,
}));
vi.mock("./model-runtime-choice.js", () => ({
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
vi.mock("./model-catalog.runtime.js", () => ({
  loadProviderScopedThinkingCatalog: async () => hoisted.catalog,
}));
vi.mock("../status/status-text.js", () => ({ buildStatusText: async () => "Session status" }));

const executePreparedCliRun = wrapPreparedCliRunWithTestAdmission(executePreparedCliRunImpl);
const CLAUDE_OK_JSONL = `${JSON.stringify({ type: "result", result: "ok" })}\n`;
const { from, to } = TRUNK_MODELS.claude;

let gateway: Awaited<ReturnType<typeof startModelChoiceGateway>>;
let state: BranchTestState;
let restore: (() => Promise<void>) | undefined;

beforeAll(async () => {
  gateway = await startModelChoiceGateway();
  state = gateway.state;
});
afterAll(async () => {
  await gateway.stop();
});
beforeEach(() => {
  hoisted.approval.mockReset();
  supervisorSpawnMock.mockReset();
  setCliRunnerExecuteTestDeps({
    writeCliSystemPromptFile,
    invokeNodeClaudeCliRun,
    registerExecApprovalRequestForHostOrThrow: async () => {
      throw new Error("unexpected exec approval registration");
    },
    resolveRegisteredExecApprovalDecision: async () => {
      throw new Error("unexpected exec approval resolution");
    },
  });
});
afterEach(async () => {
  await restore?.();
  restore = undefined;
});

function claudeTrunk(tools: NonNullable<BranchConfig["tools"]>) {
  const cfg = trunkModelChoiceConfig(tools);
  restore = useModelChoiceRuntime(cfg);
  return createTrunkSession({ state, cfg, model: from });
}

/** Runs one Claude CLI turn on `model` and returns the model the claude process was started with. */
async function runClaudeTurn(model: string): Promise<string | undefined> {
  supervisorSpawnMock.mockResolvedValueOnce(
    createManagedRun({ ...createSuccessfulProcessExit(), stdout: CLAUDE_OK_JSONL }),
  );
  const output = await executePreparedCliRun(
    buildPreparedCliRunContext({ provider: "claude-cli", model, runId: `run-${model}` }),
  );
  expect(output.text).toBe("ok");
  const spawned = supervisorSpawnMock.mock.calls.at(-1)?.[0] as { argv?: string[] } | undefined;
  const argv = spawned?.argv ?? [];
  expect(argv[0]).toBe("claude");
  return argv[argv.indexOf("--model") + 1];
}

/** The model the active run uses for its next turn: the pending switch, else the one it is on. */
async function nextTurnOf(trunk: Awaited<ReturnType<typeof claudeTrunk>>, current: string) {
  const live = await trunk.liveSwitchFrom(current);
  if (live) {
    expect(live.provider).toBe(MODEL_CHOICE_PROVIDER);
  }
  return await runClaudeTurn(live?.model ?? current);
}

describe("Claude Trunk next turn after its own model change", () => {
  it("setting on with Full access: the next turn runs on the new model, mid-task, without a restart", async () => {
    const trunk = await claudeTrunk({ exec: FULL_ACCESS_EXEC, modelChoice: { enabled: true } });
    expect(await runClaudeTurn(from)).toBe(from);

    await trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`);

    expect(trunk.read()).toMatchObject({ modelOverride: to, liveModelSwitchPending: true });
    expect(await nextTurnOf(trunk, from)).toBe(to);
    expect(trunk.nextTurnModel()).toBe(to);
    expect(hoisted.approval).not.toHaveBeenCalled();
    expect(supervisorSpawnMock).toHaveBeenCalledTimes(2);
  });

  it("setting off: the change is refused and the next turn stays on the same model", async () => {
    const trunk = await claudeTrunk({ exec: FULL_ACCESS_EXEC });
    expect(await runClaudeTurn(from)).toBe(from);

    await expect(trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`)).rejects.toThrow(
      '"Trunks may switch their own model" is off',
    );

    expect(trunk.read().modelOverride).toBe(from);
    expect(trunk.read().liveModelSwitchPending).toBeUndefined();
    expect(await nextTurnOf(trunk, from)).toBe(from);
    expect(trunk.nextTurnModel()).toBe(from);
    expect(hoisted.approval).not.toHaveBeenCalled();
  });

  it("without Full access: nothing changes until the person allows; a deny keeps the next turn on the same model", async () => {
    const trunk = await claudeTrunk({ exec: ASKING_EXEC, modelChoice: { enabled: true } });
    expect(await runClaudeTurn(from)).toBe(from);

    hoisted.approval.mockResolvedValueOnce("deny");
    await expect(trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`)).rejects.toThrow(
      `the person didn't allow switching to ${MODEL_CHOICE_PROVIDER}/${to}. The model stays as it was.`,
    );
    expect(trunk.read().modelOverride).toBe(from);
    expect(await nextTurnOf(trunk, from)).toBe(from);

    const decision = createDeferred<ModelChoiceDecision>();
    const asked = createDeferred<string>();
    hoisted.approval.mockImplementationOnce(async ({ question }) => {
      asked.resolve(question);
      return await decision.promise;
    });
    const pending = trunk.switchWithSessionStatus(`${MODEL_CHOICE_PROVIDER}/${to}`);
    expect(await asked.promise).toBe(
      `Switch to ${MODEL_CHOICE_PROVIDER}/${to} on the current account?`,
    );
    expect(trunk.read().modelOverride).toBe(from);
    decision.resolve("allow");
    await pending;

    expect(trunk.read()).toMatchObject({ modelOverride: to, liveModelSwitchPending: true });
    expect(await nextTurnOf(trunk, from)).toBe(to);
    expect(trunk.nextTurnModel()).toBe(to);
    expect(hoisted.approval).toHaveBeenCalledTimes(2);
  });
});

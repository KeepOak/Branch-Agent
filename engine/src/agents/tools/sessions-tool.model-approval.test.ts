// Trunk-made model changes through the sessions tool follow tools.modelChoice and Full access.
// The Gateway sessions.patch, mutation engine and session store are real; an approval comes before any write.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import type { BranchConfig } from "../../config/types.branch.js";
import type { BranchTestState } from "../../test-utils/branch-test-state.js";
import type { ModelChoiceDecision } from "../model-choice.js";
import {
  ASKING_EXEC,
  createTrunkSession,
  FULL_ACCESS_EXEC,
  MODEL_CHOICE_PROVIDER,
  startModelChoiceGateway,
  TRUNK_MODELS,
  trunkModelChoiceConfig,
  useModelChoiceRuntime,
} from "../model-choice.next-turn.test-support.js";

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
vi.mock("../../gateway/server-methods/model-choice-approval.js", () => ({
  requestModelChoiceApproval: hoisted.approval,
}));
vi.mock("../model-runtime-choice.js", () => ({
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
vi.mock("../model-catalog.runtime.js", () => ({
  loadProviderScopedThinkingCatalog: async () => hoisted.catalog,
}));

const { from, to } = TRUNK_MODELS.codex;
const target = `${MODEL_CHOICE_PROVIDER}/${to}`;

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
});
afterEach(async () => {
  await restore?.();
  restore = undefined;
});

function trunk(tools: NonNullable<BranchConfig["tools"]>) {
  const cfg = trunkModelChoiceConfig(tools);
  restore = useModelChoiceRuntime(cfg);
  return createTrunkSession({ state, cfg, model: from });
}

describe("Trunk model choice", () => {
  it("refuses a model change while the setting is off and writes nothing", async () => {
    const session = await trunk({ exec: FULL_ACCESS_EXEC });
    const before = session.read();
    await expect(session.switchWithSessionsTool(target)).rejects.toThrow(
      '"Trunks may switch their own model" is off',
    );
    expect(session.read()).toEqual(before);
    expect(hoisted.approval).not.toHaveBeenCalled();
  });

  it("applies straight away with Full access and asks nothing", async () => {
    const session = await trunk({ exec: FULL_ACCESS_EXEC, modelChoice: { enabled: true } });
    const result = await session.switchWithSessionsTool(target);
    expect(result.details).toMatchObject({ status: "updated", succeeded: [0] });
    expect(session.read()).toMatchObject({
      providerOverride: MODEL_CHOICE_PROVIDER,
      modelOverride: to,
      liveModelSwitchPending: true,
    });
    expect(hoisted.approval).not.toHaveBeenCalled();
  });

  it("without Full access asks once and writes only after allow", async () => {
    const session = await trunk({ exec: ASKING_EXEC, modelChoice: { enabled: true } });
    const asked = createDeferred<string>();
    const decision = createDeferred<ModelChoiceDecision>();
    hoisted.approval.mockImplementationOnce(async ({ question }) => {
      asked.resolve(question);
      return await decision.promise;
    });
    const pending = session.switchWithSessionsTool(target);
    expect(await asked.promise).toBe(`Switch to ${target} on the current account?`);
    expect(session.read().modelOverride).toBe(from);
    decision.resolve("allow");
    await expect(pending).resolves.toMatchObject({
      details: { status: "updated", succeeded: [0] },
    });
    expect(session.read().modelOverride).toBe(to);
    expect(hoisted.approval).toHaveBeenCalledTimes(1);
  });

  it("without Full access a deny leaves the model as it was and says so", async () => {
    const session = await trunk({ exec: ASKING_EXEC, modelChoice: { enabled: true } });
    const before = session.read();
    hoisted.approval.mockResolvedValueOnce("deny");
    await expect(session.switchWithSessionsTool(target)).rejects.toThrow(
      `the person didn't allow switching to ${target}. The model stays as it was.`,
    );
    expect(session.read()).toEqual(before);
    expect(hoisted.approval).toHaveBeenCalledTimes(1);
  });
});

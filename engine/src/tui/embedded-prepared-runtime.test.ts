// Preserve module setup before modules that consume it.
// oxfmt-ignore
import {
  cleanupPreparedModelRuntimeHarness,
  getPreparedModelRuntimeMocks,
  resetPreparedModelRuntimeHarness,
} from "../agents/prepared-model-runtime.test-harness.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireAgentRunPreparedModelRuntime } from "../agents/prepared-model-runtime.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../test-utils/branch-test-state.js";
import { EmbeddedPreparedModelRuntimeHost } from "./embedded-prepared-runtime.js";

const mocks = getPreparedModelRuntimeMocks();
let state: BranchTestState;

describe("EmbeddedPreparedModelRuntimeHost", () => {
  beforeEach(async () => {
    state = await createBranchTestState({ label: "prepared-model-runtime" });
    await resetPreparedModelRuntimeHarness(state);
  });

  it("reuses its live publication across two actual run admissions", async () => {
    mocks.configuredAgentIds = ["default"];
    const config = { agents: { defaults: { model: { primary: "openai/gpt-5.5" } } } };
    const host = new EmbeddedPreparedModelRuntimeHost();
    host.publish(config);
    await host.waitUntilReady();

    const input = {
      agentId: "default",
      config,
      agentDir: state.agentDir("default"),
      inheritedAuthDir: state.agentDir("default"),
      workspaceDir: "/tmp/unused-workspace",
      runtimePluginSelections: [{ provider: "openai", modelId: "gpt-5.5", agentId: "default" }],
    };
    const first = await acquireAgentRunPreparedModelRuntime(input);
    expect(mocks.ensureBranchModelsJson).toHaveBeenCalledTimes(1);
    await first[Symbol.asyncDispose]();
    const second = await acquireAgentRunPreparedModelRuntime(input);
    await second[Symbol.asyncDispose]();

    expect(second.snapshot).toBe(first.snapshot);
    expect(mocks.ensureBranchModelsJson).toHaveBeenCalledTimes(1);
  });
});

afterEach(async ({ task }) => {
  await cleanupPreparedModelRuntimeHarness(state, task.result?.state === "fail");
});

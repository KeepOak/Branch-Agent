import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import type { BranchTestState } from "../../test-utils/branch-test-state.js";
import { listAgentIds } from "../agent-scope-config.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedAcquireAgentRunPreparedModelRuntime,
  mockedBuildEmbeddedRunPayloads,
  mockedRunEmbeddedAttempt,
  createOverflowRunParams,
  resetSharedRunIntegrationHarnessMocks,
  useOpenAIPlatformAuthFixture,
} from "./run.overflow-compaction.harness.js";

const { runEmbeddedAgent } = await loadRunOverflowCompactionHarness();

let state: BranchTestState;

describe("embedded setup inference inherited auth owner", () => {
  beforeEach(async () => {
    resetSharedRunIntegrationHarnessMocks();
    const { createBranchTestState } = await import("../../test-utils/branch-test-state.js");
    state = await createBranchTestState({ label: "run.inherited-auth-owner" });
    useOpenAIPlatformAuthFixture();
  });

  afterEach(async () => {
    await state?.cleanup();
  });

  it("prepares the explicit main agent after adding the setup agent", async () => {
    const config: BranchConfig = { agents: { entries: { main: {}, branch: {} } } };
    expect(listAgentIds(config)).toEqual(["main", "branch"]);

    mockedBuildEmbeddedRunPayloads.mockReturnValue([{ text: "OK" }]);
    mockedRunEmbeddedAttempt.mockResolvedValueOnce(makeAttemptResult({ assistantTexts: ["OK"] }));

    await runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "openai",
      model: "gpt-5.6-luna",
      agentId: "main",
      config,
      runId: "run-setup-inference-owner",
    });

    const preparedInput = mockedAcquireAgentRunPreparedModelRuntime.mock.calls[0]?.[0];
    expect(preparedInput).toMatchObject({ agentId: "main", config });
    expect(String(preparedInput?.inheritedAuthDir)).toSatisfy((value: string) =>
      value.endsWith(path.join("agents", "main", "agent")),
    );
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledOnce();
    // A silent fall-back to the built-in host harness would still pass the
    // auth-owner assertions; fail loudly on the route instead.
    expect(mockedRunEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ agentHarnessId: "codex" }),
    );
  });
});

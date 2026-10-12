import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildEmptyToolTelemetry,
  createProjector,
  forCurrentTurn,
  readAttemptTerminal,
  registerCodexEventProjectorTestLifecycle,
  TURN_ID,
} from "../../../extensions/codex/src/app-server/event-projector.test-harness.js";
import { isCodexTransientProviderTurnFailure } from "../../../extensions/codex/src/app-server/usage-limit-error.js";
import { getBranchAgentDatabaseIfOpen } from "../../state/branch-agent-db.js";
import type { BranchTestState } from "../../test-utils/branch-test-state.js";
import { classifyFailoverReasonCore } from "../failover/classify-core.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  createOverflowRunParams,
  mockedAcquireAgentRunPreparedModelRuntime,
  mockedGlobalHookRunner,
  mockedRunEmbeddedAttempt,
  resetSharedRunIntegrationHarnessMocks,
  useOpenAIPlatformAuthFixture,
} from "./run.overflow-compaction.harness.js";
import { loadSharedRunIntegrationHarness } from "./run.shared-integration-harness.test-support.js";

registerCodexEventProjectorTestLifecycle();

describe("transient provider capacity failures", () => {
  it("classifies capacity and temporary internal errors for failover", () => {
    expect(
      classifyFailoverReasonCore("Selected model is at capacity. Please try a different model."),
    ).toBe("overloaded");
    expect(
      classifyFailoverReasonCore(
        "The model provider returned a temporary internal error before replying.",
      ),
    ).toBe("timeout");
    expect(
      isCodexTransientProviderTurnFailure({
        message: "Selected model is at capacity. Please try a different model.",
      }),
    ).toBe(true);
    expect(
      isCodexTransientProviderTurnFailure({
        message: "failed",
        codexErrorInfo: "internalServerError",
      }),
    ).toBe(true);
    expect(
      isCodexTransientProviderTurnFailure({
        message: "The model provider returned a temporary internal error before replying.",
      }),
    ).toBe(true);
    expect(isCodexTransientProviderTurnFailure({ message: "invalid request" })).toBe(false);
  });

  it("preserves a transient error notification when the completed turn has no details", async () => {
    const projector = await createProjector();
    await projector.handleNotification(
      forCurrentTurn("error", {
        error: { message: "failed", codexErrorInfo: "internalServerError" },
        willRetry: false,
      }),
    );
    await projector.handleNotification(
      forCurrentTurn("turn/completed", {
        turn: { id: TURN_ID, status: "failed", items: [], error: { message: "failed" } },
      }),
    );

    expect(
      readAttemptTerminal(projector.buildResult(buildEmptyToolTelemetry())).promptError,
    ).toMatchObject({
      message: "failed",
      status: 500,
    });
    expect(projector.settledTurnFailureFinalizationAllowed).toBe(true);
  });

  describe("incomplete Codex turn", () => {
    let state: BranchTestState;
    let runEmbeddedAgent: Awaited<ReturnType<typeof loadSharedRunIntegrationHarness>>;

    beforeAll(async () => {
      runEmbeddedAgent = await loadSharedRunIntegrationHarness();
    });
    beforeEach(async () => {
      resetSharedRunIntegrationHarnessMocks();
      const { createBranchTestState } = await import("../../test-utils/branch-test-state.js");
      state = await createBranchTestState({ label: "provider-capacity-failover" });
      mockedGlobalHookRunner.hasHooks.mockImplementation(() => false);
      useOpenAIPlatformAuthFixture();
    });
    afterEach(async () => {
      await state?.cleanup();
    });

    it("retries a replay-safe internal-error turn once before surfacing failure", async () => {
      const providerFailure = Object.assign(new Error("failed"), { status: 500 });
      for (let index = 0; index < 2; index += 1) {
        mockedRunEmbeddedAttempt.mockResolvedValueOnce(
          makeAttemptResult({
            assistantTexts: [],
            promptError: providerFailure,
            promptErrorSource: "prompt",
            providerRetryMaxRetries: 1,
          }),
        );
      }

      await expect(
        runEmbeddedAgent({
          ...createOverflowRunParams(state),
          provider: "openai",
          model: "gpt-6-sol",
          runId: "provider-internal-error-retry",
        }),
      ).rejects.toThrow("failed");

      expect(mockedRunEmbeddedAttempt).toHaveBeenCalledTimes(2);
      const lease = await mockedAcquireAgentRunPreparedModelRuntime.mock.results[0]?.value;
      if (!lease) {
        throw new Error("The retry run did not acquire its runtime.");
      }
      expect(lease.snapshot.snapshotId).toEqual(expect.any(String));
      const database = getBranchAgentDatabaseIfOpen({
        agentId: "main",
        path: path.join(lease.snapshot.agentDir, "branch-agent.sqlite"),
      });
      const journal =
        database?.db
          .prepare(
            "SELECT event_type, snapshot_id, payload_json FROM run_journal WHERE run_id = ? ORDER BY sequence",
          )
          .all("provider-internal-error-retry") ?? [];
      expect(journal.map((row) => row.event_type)).toEqual(["run_started", "run_ended"]);
      expect(journal.every((row) => row.snapshot_id === lease.snapshot.snapshotId)).toBe(true);
      expect(JSON.parse(String(journal.at(-1)?.payload_json))).toEqual({ status: "failed" });
    });
  });
});

import { expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { resetPluginLoaderTestStateForTest } from "../../plugins/loader.test-fixtures.js";
import { clearPluginMetadataLifecycleCaches } from "../../plugins/plugin-metadata-lifecycle.js";
import { getBranchAgentDatabaseIfOpen } from "../../state/branch-agent-db.js";
import { resolveIncognitoBranchAgentSqlitePath } from "../../state/branch-agent-db.paths.js";
import { createBranchTestState } from "../../test-utils/branch-test-state.js";
import { prepareSystemAgentRunAdmission } from "../admitted-run-context.js";
import { PreparedModelRuntimePublicationSupersededError } from "../prepared-model-runtime.errors.js";
import { resetPreparedModelRuntimeSnapshotsForTest } from "../prepared-model-runtime.test-support.js";
import { SessionManager } from "../sessions/session-manager.js";
import { immediateEnqueue } from "../test-helpers/embedded-agent-runner-e2e-fixtures.js";
import { runEmbeddedAgent } from "./run-orchestrator.js";
import type { RunEmbeddedAgentInternalParams } from "./run/internal-params.js";

const loop = vi.hoisted(() => vi.fn<(typeof import("./run-loop.js"))["runPreparedEmbeddedLoop"]>());
vi.mock("./run-loop.js", () => ({ runPreparedEmbeddedLoop: loop }));

const superseded = () =>
  new PreparedModelRuntimePublicationSupersededError(
    "prepared model runtime publication was superseded for the agent directory",
  );

it.each([
  { when: "during setup", startAttempt: false, calls: 2, failedResult: false },
  { when: "after the first attempt started", startAttempt: true, calls: 1, failedResult: false },
  {
    when: "during setup before a returned failure",
    startAttempt: false,
    calls: 2,
    failedResult: true,
  },
])("handles a runtime superseded $when", async ({ startAttempt, calls, failedResult }) => {
  const state = await createBranchTestState({
    label: "run-superseded-setup",
    env: { BRANCH_DISABLE_BUNDLED_PLUGINS: "1" },
  });
  const runId = `superseded-setup-${calls}`;
  const cfg: BranchConfig = {
    agents: {
      entries: { main: { workspace: state.workspaceDir } },
      defaults: { workspace: state.workspaceDir, model: "local/model" },
    },
    models: {
      providers: {
        local: {
          api: "openai-completions",
          apiKey: "test-key",
          baseUrl: "http://127.0.0.1:9/v1",
          models: [
            {
              id: "model",
              name: "Local model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 8192,
              maxTokens: 1024,
            },
          ],
        },
      },
    },
  };
  const admission = prepareSystemAgentRunAdmission(cfg, runId, "main", "superseded-setup-test");
  const snapshots: string[] = [];
  try {
    loop.mockImplementationOnce(async (_refresh, input) => {
      snapshots.push(input.preparedModelRuntime.snapshotId);
      if (startAttempt) {
        input.runParams.onAttemptStart?.();
      }
      // Model setup observes that a sibling Trunk's preparation replaced this runtime.
      throw superseded();
    });
    loop.mockImplementation(async (_refresh, input) => {
      snapshots.push(input.preparedModelRuntime.snapshotId);
      return {
        payloads: [{ text: "ran on the current runtime" }],
        meta: {
          durationMs: 1,
          stopReason: failedResult ? "error" : "completed",
          agentMeta: {
            sessionId: input.runParams.sessionId,
            provider: input.provider,
            model: input.modelId,
          },
        },
      };
    });
    const params: RunEmbeddedAgentInternalParams = {
      config: cfg,
      agentId: "main",
      agentDir: state.agentDir(),
      workspaceDir: state.workspaceDir,
      sessionId: runId,
      sessionKey: `agent:main:${runId}`,
      runId,
      provider: "local",
      model: "model",
      prompt: "hello",
      timeoutMs: 5000,
      enqueue: immediateEnqueue,
      preparedRunAdmission: admission,
      preparedModelRuntimeMode: "isolated-read-only",
      sessionPersistence: "detached",
      sessionManager: SessionManager.inMemory(state.workspaceDir),
    };
    const run = runEmbeddedAgent(params);
    if (startAttempt) {
      await expect(run).rejects.toThrow("publication was superseded");
    } else {
      expect((await run).payloads?.[0]?.text).toBe("ran on the current runtime");
    }
    const journalDatabase = getBranchAgentDatabaseIfOpen({
      agentId: "main",
      path: resolveIncognitoBranchAgentSqlitePath({ agentId: "main" }),
    });
    const journal =
      journalDatabase?.db
        .prepare(
          "SELECT event_type, snapshot_id, payload_json FROM run_journal WHERE run_id = ? ORDER BY sequence",
        )
        .all(runId) ?? [];
    expect(journal.map((row) => row.event_type)).toEqual(
      Array.from({ length: calls }, () => ["run_started", "run_ended"]).flat(),
    );
    expect(
      journal.filter((row) => row.event_type === "run_started").map((row) => row.snapshot_id),
    ).toEqual(snapshots);
    expect(snapshots.every((snapshot) => typeof snapshot === "string" && snapshot.length > 0)).toBe(
      true,
    );
    expect(JSON.parse(String(journal.at(-1)?.payload_json))).toEqual({
      status: startAttempt || failedResult ? "failed" : "completed",
    });
    expect(loop).toHaveBeenCalledTimes(calls);
  } finally {
    admission.close();
    await resetPreparedModelRuntimeSnapshotsForTest();
    clearPluginMetadataLifecycleCaches();
    resetPluginLoaderTestStateForTest();
    loop.mockReset();
    await state.cleanup();
  }
});

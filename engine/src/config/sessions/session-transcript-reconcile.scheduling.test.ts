import { expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  closeBranchAgentDatabasesAsync,
  openBranchAgentDatabase,
} from "../../state/branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { persistSessionTranscriptTurn } from "./session-accessor.js";
import {
  closeSessionTranscriptReconcileWorkerPool,
  getSessionTranscriptReconcileWorkerPoolSnapshot,
} from "./session-transcript-reconcile-pool.js";
import {
  startSessionTranscriptIndexReconcile,
  waitForSessionTranscriptIndexReconcile,
} from "./session-transcript-reconcile.js";

it("drains deferred reconciliation after the caller retires its timer queue", async ({
  onTestFinished,
  signal,
}) => {
  const stateDir = useAutoCleanupTempDirTracker(onTestFinished).make("branch-reconcile-clock-");
  const options = { agentId: "main", env: { ...process.env, BRANCH_STATE_DIR: stateDir } };
  let releaseYield: (() => void) | undefined;
  const release = () => {
    releaseYield?.();
    releaseYield = undefined;
  };
  onTestFinished(async () => {
    signal.removeEventListener("abort", release);
    release();
    await closeSessionTranscriptReconcileWorkerPool();
    await closeBranchAgentDatabasesAsync(stateDir);
    closeBranchStateDatabaseForTest();
  });
  await persistSessionTranscriptTurn(
    { ...options, sessionId: "deferred", sessionKey: "agent:main:deferred" },
    {
      messages: [{ eventId: "message", message: { role: "user", content: "Deferred repair" } }],
      touchSessionEntry: false,
    },
  );
  await waitForSessionTranscriptIndexReconcile(options);
  await closeSessionTranscriptReconcileWorkerPool();
  const database = openBranchAgentDatabase(options);
  database.db.prepare("DELETE FROM session_transcript_fts").run();
  database.db.prepare("UPDATE session_transcript_index_state SET needs_rebuild = 1").run();

  signal.throwIfAborted();
  // A failing regression must release the withheld callback before fixture teardown.
  signal.addEventListener("abort", release, { once: true });
  const realSetImmediate = globalThis.setImmediate;
  const immediate = vi.spyOn(globalThis, "setImmediate").mockImplementationOnce((callback) => {
    releaseYield = () => callback();
    return realSetImmediate(() => undefined);
  });
  try {
    startSessionTranscriptIndexReconcile(options);
  } finally {
    immediate.mockRestore();
  }

  await closeSessionTranscriptReconcileWorkerPool();
  expect(database.db.prepare("SELECT message_id, text FROM session_transcript_fts").all()).toEqual([
    { message_id: "message", text: "Deferred repair" },
  ]);
  expect(
    database.db.prepare("SELECT needs_rebuild FROM session_transcript_index_state").all(),
  ).toEqual([{ needs_rebuild: 0 }]);
  expect(getSessionTranscriptReconcileWorkerPoolSnapshot()).toMatchObject({
    maxWorkers: 1,
    workers: 0,
    activeTasks: 0,
    pendingTasks: 0,
  });
}, 30_000);

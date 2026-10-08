import { afterEach, beforeEach, expect, it } from "vitest";
import {
  loadSessionEntry,
  upsertSessionEntryCore,
} from "../../config/sessions/session-accessor.js";
import { readVisibleSessionTranscriptMessageEntries } from "../../plugin-sdk/session-transcript-runtime.js";
import { closeBranchAgentDatabasesForTest } from "../../state/branch-agent-db.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { createTestFollowupRun } from "./agent-runner.test-fixtures.js";
import { persistLiveInboundReply } from "./live-inbound-persistence.js";

let state: BranchTestState;
beforeEach(async () => {
  state = await createBranchTestState({ prefix: "live-inbound-persistence-", applyEnv: false });
});
afterEach(async () => {
  closeBranchAgentDatabasesForTest();
  await state.cleanup();
});

it("saves the side reply in the real history without replacing the busy writer", async () => {
  const scope = {
    agentId: "main",
    sessionId: "real-session",
    sessionKey: "agent:main:main",
    storePath: state.path("sessions.json"),
  };
  await upsertSessionEntryCore(scope, {
    sessionId: scope.sessionId,
    updatedAt: 10,
    activeWriterRunId: "busy-writer",
  });
  const followupRun = createTestFollowupRun(scope);
  followupRun.liveInbound = true;
  const params = {
    followupRun,
    sessionKey: scope.sessionKey,
    storePath: scope.storePath,
    runId: "side-reply",
    signal: new AbortController().signal,
    payloads: [{ text: "Here is the live answer." }],
  };
  await persistLiveInboundReply(params);
  await persistLiveInboundReply(params);
  const history = await readVisibleSessionTranscriptMessageEntries(scope);
  expect(history).toHaveLength(1);
  expect(JSON.stringify(history)).toContain("Here is the live answer.");
  expect(loadSessionEntry(scope)?.activeWriterRunId).toBe("busy-writer");
});

it("does not persist after cancellation or into a replacement session", async () => {
  const scope = {
    agentId: "main",
    sessionId: "new-session",
    sessionKey: "agent:main:main",
    storePath: state.path("sessions.json"),
  };
  await upsertSessionEntryCore(scope, { sessionId: scope.sessionId, updatedAt: 10 });
  const followupRun = createTestFollowupRun({ ...scope, sessionId: "old-session" });
  followupRun.liveInbound = true;
  const params = {
    followupRun,
    sessionKey: scope.sessionKey,
    storePath: scope.storePath,
    runId: "side-reply",
    signal: new AbortController().signal,
    payloads: [{ text: "stale answer" }],
  };
  await expect(persistLiveInboundReply(params)).rejects.toThrow("session changed");
  await expect(
    persistLiveInboundReply({ ...params, signal: AbortSignal.abort(new Error("cancelled")) }),
  ).rejects.toThrow("cancelled");
  expect(await readVisibleSessionTranscriptMessageEntries(scope)).toEqual([]);
});

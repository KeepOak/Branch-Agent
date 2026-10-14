import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { loadTranscriptEvents } from "../config/sessions/session-accessor.js";
import { readTranscriptEventMessage } from "../config/sessions/session-accessor.sqlite-read.js";
import { setTestEnvValue } from "../test-utils/env.js";
import { resetHeartbeatEventsForTest } from "./heartbeat-events.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  seedHeartbeatScratchForTest,
  seedSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

// Builder Trunks are queue-eligible by default, so main's idle-Trunk gate applies to them.
const TRUNK_ID = "builder-inbox";
const SESSION_KEY = "agent:" + TRUNK_ID + ":main";
const SESSION_ID = "trunk-inbox-session";
const ALERT = "A task needs attention.";

afterEach(() => {
  vi.restoreAllMocks();
  resetSystemEventsForTest();
  resetHeartbeatEventsForTest();
});

type RunOptions = Partial<Parameters<typeof runHeartbeatOnce>[0]>;

async function runRoutelessTrunkHeartbeat(options: {
  before?: () => void;
  run?: RunOptions;
}): Promise<{ status: string; reason?: string; calls: number; published: number }> {
  return withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
    setTestEnvValue("BRANCH_STATE_DIR", tmpDir);
    const cfg: BranchConfig = {
      agents: {
        defaults: { workspace: tmpDir, heartbeat: { every: "5m" } },
        entries: { [TRUNK_ID]: {} },
      },
      session: { store: storePath },
    } as BranchConfig;
    // An app-owned conversation with no chat route: the alert can only land in the app.
    await seedSessionStore(storePath, SESSION_KEY, {
      lastChannel: "webchat",
      createdVia: "operator",
      sessionId: SESSION_ID,
      lifecycleRevision: "trunk-inbox-generation",
    });
    // The Trunk's own heartbeat monitor has a checklist, so only the gate can skip the tick.
    await seedHeartbeatScratchForTest({ content: "- Check status\n", agentId: TRUNK_ID });
    options.before?.();
    const reply = vi.fn().mockResolvedValue({ text: ALERT });
    const result = await runHeartbeatOnce({
      cfg,
      agentId: TRUNK_ID,
      source: "interval",
      intent: "scheduled",
      reason: "interval",
      ...options.run,
      deps: { getQueueSize: () => 0, getReplyFromConfig: reply },
    });
    const events = await loadTranscriptEvents({
      agentId: TRUNK_ID,
      sessionKey: SESSION_KEY,
      sessionId: SESSION_ID,
      storePath,
    });
    const published = events
      .map(readTranscriptEventMessage)
      .filter((m) => m?.role === "assistant" && JSON.stringify(m.content).includes(ALERT)).length;
    return {
      status: result.status,
      reason: "reason" in result ? result.reason : undefined,
      calls: reply.mock.calls.length,
      published,
    };
  });
}

describe("heartbeat Inbox fallback behind the idle-Trunk gate", () => {
  it("skips an idle routeless Trunk tick before any model turn", async () => {
    const outcome = await runRoutelessTrunkHeartbeat({});
    // No signal means nothing to alert about: the gate keeps its no-cost skip.
    expect(outcome).toEqual({ status: "skipped", reason: "no-signal", calls: 0, published: 0 });
  });

  it("publishes the alert to the app conversation when the Trunk tick carries an event", async () => {
    const outcome = await runRoutelessTrunkHeartbeat({
      before: () => {
        enqueueSystemEvent("Owner note: check the build", {
          sessionKey: SESSION_KEY,
          contextKey: "owner:note",
        });
      },
    });
    expect(outcome).toEqual({ status: "ran", reason: undefined, calls: 1, published: 1 });
  });

  it("publishes the alert to the app conversation when the Trunk tick carries a task", async () => {
    const outcome = await runRoutelessTrunkHeartbeat({
      run: {
        intent: "task",
        reason: "heartbeat-task:job-1",
        scheduledEveryMs: 5 * 60_000,
        tasks: [{ jobId: "job-1", name: "Standup", prompt: "Post the standup" }],
      },
    });
    expect(outcome).toEqual({ status: "ran", reason: undefined, calls: 1, published: 1 });
  });
});

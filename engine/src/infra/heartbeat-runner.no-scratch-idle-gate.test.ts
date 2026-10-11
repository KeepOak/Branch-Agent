import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { type HeartbeatDeps, runHeartbeatOnce } from "./heartbeat-runner.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import {
  heartbeatTestConfig,
  seedHeartbeatScratchForTest,
  seedSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

// NC-07: an interval poll with no monitor scratch, no event and no task has nothing to
// act on under the default prompt, so it must not spend a model turn.

function createDeps(replySpy: ReturnType<typeof vi.fn>): HeartbeatDeps {
  return {
    whatsapp: vi.fn().mockResolvedValue({ messageId: "m1", toJid: "jid" }),
    getQueueSize: () => 0,
    nowMs: () => Date.now(),
    webAuthExists: async () => true,
    hasActiveWebListener: () => true,
    getReplyFromConfig: replySpy,
  } as HeartbeatDeps;
}

function ownerConfig(
  tmpDir: string,
  storePath: string,
  agentId: string,
  prompt?: string,
): BranchConfig {
  return {
    ...heartbeatTestConfig(tmpDir, "last", "whatsapp", storePath),
    agents: {
      defaults: {
        workspace: tmpDir,
        heartbeat: { every: "30m", target: "last", ...(prompt ? { prompt } : {}) },
      },
      entries: { [agentId]: {} },
    },
  };
}

async function seedOwnerSession(storePath: string, agentId: string): Promise<string> {
  const sessionKey = `agent:${agentId}:main`;
  await seedSessionStore(storePath, sessionKey, {
    sessionId: "sid",
    updatedAt: Date.now(),
    lastChannel: "whatsapp",
    lastProvider: "whatsapp",
    lastTo: "120363401234567890@g.us",
  });
  return sessionKey;
}

function intervalWake(cfg: BranchConfig, agentId: string, replySpy: ReturnType<typeof vi.fn>) {
  return runHeartbeatOnce({
    cfg,
    agentId,
    source: "interval",
    intent: "scheduled",
    reason: "interval",
    scheduledEveryMs: 30 * 60_000,
    deps: createDeps(replySpy),
  });
}

describe("interval heartbeat with no monitor scratch", () => {
  installHeartbeatRunnerTestRuntime();

  it("skips the model for the owner agent when its monitor scratch is cleared", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      await seedHeartbeatScratchForTest({ content: null });
      const cfg = ownerConfig(tmpDir, storePath, "main");
      await seedOwnerSession(storePath, "main");

      const res = await intervalWake(cfg, "main", replySpy);

      expect(replySpy).not.toHaveBeenCalled();
      expect(res).toEqual({ status: "skipped", reason: "no-signal" });
    });
  });

  it("skips the model for a non-Trunk agent that has no monitor at all", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = ownerConfig(tmpDir, storePath, "ops");
      await seedOwnerSession(storePath, "ops");

      const res = await runHeartbeatOnce({
        cfg,
        agentId: "ops",
        source: "interval",
        intent: "scheduled",
        reason: "interval",
        deps: createDeps(replySpy),
      });

      expect(replySpy).not.toHaveBeenCalled();
      expect(res).toEqual({ status: "skipped", reason: "no-signal" });
    });
  });

  it("still runs when a custom heartbeat prompt gives the poll work", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      await seedHeartbeatScratchForTest({ content: null });
      const cfg = ownerConfig(tmpDir, storePath, "main", "Check the inbox for urgent mail.");
      await seedOwnerSession(storePath, "main");

      await intervalWake(cfg, "main", replySpy);

      expect(replySpy).toHaveBeenCalledTimes(1);
    });
  });

  it("still runs when a pending event is queued for the session", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      resetSystemEventsForTest();
      await seedHeartbeatScratchForTest({ content: null });
      const cfg = ownerConfig(tmpDir, storePath, "main");
      const sessionKey = await seedOwnerSession(storePath, "main");
      enqueueSystemEvent("Owner note: check the build", {
        sessionKey,
        contextKey: "owner:note",
      });

      await intervalWake(cfg, "main", replySpy);

      expect(replySpy).toHaveBeenCalledTimes(1);
    });
  });

  it("still runs when the poll carries a scheduled task", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      await seedHeartbeatScratchForTest({ content: null });
      const cfg = ownerConfig(tmpDir, storePath, "main");
      await seedOwnerSession(storePath, "main");

      await runHeartbeatOnce({
        cfg,
        agentId: "main",
        source: "interval",
        intent: "task",
        reason: "heartbeat-task:job-1",
        scheduledEveryMs: 30 * 60_000,
        tasks: [{ jobId: "job-1", name: "Standup", prompt: "Post the standup" }],
        deps: createDeps(replySpy),
      });

      expect(replySpy).toHaveBeenCalledTimes(1);
    });
  });

  it("still runs when the monitor scratch has instructions", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = ownerConfig(tmpDir, storePath, "main");
      await seedOwnerSession(storePath, "main");

      await intervalWake(cfg, "main", replySpy);

      expect(replySpy).toHaveBeenCalledTimes(1);
    });
  });
});

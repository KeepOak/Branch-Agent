import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { type HeartbeatDeps, runHeartbeatOnce } from "./heartbeat-runner.js";
import { installHeartbeatRunnerTestRuntime } from "./heartbeat-runner.test-harness.js";
import {
  heartbeatTestConfig,
  seedSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "./system-events.js";

const TRUNK_ID = "builder-proactive";

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

function routedConfig(tmpDir: string, storePath: string, agentId: string): BranchConfig {
  return {
    ...heartbeatTestConfig(tmpDir, "last", "whatsapp", storePath),
    agents: {
      defaults: { workspace: tmpDir, heartbeat: { every: "30m", target: "last" } },
      entries: { [agentId]: {} },
    },
  };
}

describe("interval heartbeat for a queue-eligible Trunk", () => {
  installHeartbeatRunnerTestRuntime();

  it("skips the model on an idle interval tick with no pending signal", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = routedConfig(tmpDir, storePath, TRUNK_ID);
      await seedSessionStore(storePath, `agent:${TRUNK_ID}:main`, {
        sessionId: "sid",
        updatedAt: Date.now(),
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "120363401234567890@g.us",
      });

      const res = await runHeartbeatOnce({
        cfg,
        agentId: TRUNK_ID,
        source: "interval",
        intent: "scheduled",
        reason: "interval",
        deps: createDeps(replySpy),
      });

      expect(replySpy).not.toHaveBeenCalled();
      expect(res).toEqual({ status: "skipped", reason: "no-signal" });
    });
  });

  it("skips the production monitor tick (cron every, authoritative, no task)", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = routedConfig(tmpDir, storePath, TRUNK_ID);
      await seedSessionStore(storePath, `agent:${TRUNK_ID}:main`, {
        sessionId: "sid",
        updatedAt: Date.now(),
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "120363401234567890@g.us",
      });

      const res = await runHeartbeatOnce({
        cfg,
        agentId: TRUNK_ID,
        source: "interval",
        intent: "scheduled",
        reason: "interval",
        scheduledEveryMs: 30 * 60_000,
        deps: createDeps(replySpy),
      });

      expect(replySpy).not.toHaveBeenCalled();
      expect(res).toEqual({ status: "skipped", reason: "no-signal" });
    });
  });

  it("still runs the model for a Trunk tick that carries a scheduled task", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = routedConfig(tmpDir, storePath, TRUNK_ID);
      await seedSessionStore(storePath, `agent:${TRUNK_ID}:main`, {
        sessionId: "sid",
        updatedAt: Date.now(),
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "120363401234567890@g.us",
      });

      await runHeartbeatOnce({
        cfg,
        agentId: TRUNK_ID,
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

  it("still runs the model for a Trunk that has a pending event", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      resetSystemEventsForTest();
      const sessionKey = `agent:${TRUNK_ID}:main`;
      const cfg = routedConfig(tmpDir, storePath, TRUNK_ID);
      await seedSessionStore(storePath, sessionKey, {
        sessionId: "sid",
        updatedAt: Date.now(),
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "120363401234567890@g.us",
      });
      enqueueSystemEvent("Owner note: check the build", {
        sessionKey,
        contextKey: "owner:note",
      });

      await runHeartbeatOnce({
        cfg,
        agentId: TRUNK_ID,
        source: "interval",
        intent: "scheduled",
        reason: "interval",
        deps: createDeps(replySpy),
      });

      expect(replySpy).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the interval model turn for an agent that is not a Trunk", async () => {
    await withTempHeartbeatSandbox(async ({ tmpDir, storePath, replySpy }) => {
      const cfg = routedConfig(tmpDir, storePath, "main");
      await seedSessionStore(storePath, "agent:main:main", {
        sessionId: "sid",
        updatedAt: Date.now(),
        lastChannel: "whatsapp",
        lastProvider: "whatsapp",
        lastTo: "120363401234567890@g.us",
      });

      await runHeartbeatOnce({
        cfg,
        agentId: "main",
        source: "interval",
        intent: "scheduled",
        reason: "interval",
        deps: createDeps(replySpy),
      });

      expect(replySpy).toHaveBeenCalledTimes(1);
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { loadTranscriptEvents } from "../config/sessions/session-accessor.js";
import { readTranscriptEventMessage } from "../config/sessions/session-accessor.sqlite-read.js";
import { setTestEnvValue } from "../test-utils/env.js";
import { resetHeartbeatEventsForTest } from "./heartbeat-events.js";
import { runHeartbeatOnce } from "./heartbeat-runner.js";
import {
  readSessionStoreForTest,
  seedMainSessionStore,
  withTempHeartbeatSandbox,
} from "./heartbeat-runner.test-utils.js";
import { resetSystemEventsForTest } from "./system-events.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetSystemEventsForTest();
  resetHeartbeatEventsForTest();
});

describe("heartbeat Inbox fallback", () => {
  it("publishes an alert to the app conversation when there is no chat route", async () => {
    for (const createdVia of ["operator", "spawn"] as const) {
      await withTempHeartbeatSandbox(async ({ tmpDir, storePath }) => {
        setTestEnvValue("BRANCH_STATE_DIR", tmpDir);
        const cfg: BranchConfig = {
          agents: { defaults: { workspace: tmpDir, heartbeat: { every: "5m" } } },
          session: { store: storePath },
        };
        const sessionKey = await seedMainSessionStore(storePath, cfg, {
          lastChannel: "webchat",
          createdVia,
          sessionId: "inbox-session",
          lifecycleRevision: "inbox-generation",
        });
        const reply = vi.fn().mockResolvedValue({ text: "A task needs attention." });
        const result = await runHeartbeatOnce({
          cfg,
          agentId: "main",
          source: "interval",
          deps: { getReplyFromConfig: reply },
        });
        expect(result.status).toBe("ran");
        expect(reply).toHaveBeenCalledOnce();
        const entry = readSessionStoreForTest(storePath)[sessionKey]!;
        const events = await loadTranscriptEvents({
          agentId: "main",
          sessionKey,
          sessionId: entry.sessionId!,
          storePath,
        });
        expect(
          events
            .map(readTranscriptEventMessage)
            .filter(
              (m) =>
                m?.role === "assistant" &&
                JSON.stringify(m.content).includes("A task needs attention."),
            ),
        ).toHaveLength(1);
      });
    }
  });
});

import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { replaceSessionEntrySync } from "../../config/sessions/session-accessor.sqlite-entry.js";
import { closeBranchAgentDatabasesAsync } from "../../state/branch-agent-db.js";
import * as workerWrite from "../../state/branch-agent-write-admission.js";
import { replyRunRegistry } from "./reply-run-registry.js";
import { testing } from "./reply-run-registry.test-support.js";
import { admitReplyTurn, runWithReplyOperationLifecycleAdmission } from "./reply-turn-admission.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    testing.resetReplyRunRegistry();
    await closeBranchAgentDatabasesAsync();
    vi.restoreAllMocks();
    cleanup();
  }),
);

it.each([false, true])(
  "admits and dispatches a new Trunk's first message with delayed admission=%s",
  async (delayed) => {
    const storePath = path.join(tempDirs.make("first-message-admission-"), "agent.sqlite");
    const sessionKey = "agent:main:dashboard:first-message";
    const sessionId = "first-message-session";
    expect(fs.existsSync(storePath)).toBe(false);

    const entered = createDeferred();
    const resume = createDeferred();
    if (delayed) {
      const runWrite = workerWrite.runBranchAgentWorkerWrite;
      vi.spyOn(workerWrite, "runBranchAgentWorkerWrite").mockImplementation(async (...args) => {
        entered.resolve();
        await resume.promise;
        return await runWrite(...args);
      });
    }
    const pending = admitReplyTurn({
      agentId: "main",
      storePath,
      sessionKey,
      sessionId,
      expectedSessionId: delayed ? sessionId : undefined,
      kind: "visible",
      resetTriggered: false,
    });
    try {
      if (delayed) {
        await entered.promise;
        // Session creation may commit while the first turn awaits database admission.
        replaceSessionEntrySync(
          { agentId: "main", storePath, sessionKey },
          { sessionId, updatedAt: Date.now() },
        );
        resume.resolve();
      }
      const result = await pending;
      expect(result.status).toBe("owned");
      if (result.status !== "owned") {
        return;
      }
      try {
        expect(result.operation.sessionId).toBe(sessionId);
        expect(replyRunRegistry.get(sessionKey)).toBe(result.operation);
        if (delayed) {
          expect(result.sessionEntry?.sessionId).toBe(sessionId);
        }
        let dispatched = false;
        await runWithReplyOperationLifecycleAdmission(result.operation, async () => {
          dispatched = true;
        });
        expect(dispatched).toBe(true);
      } finally {
        result.operation.complete();
      }
    } finally {
      resume.resolve();
      await pending.catch(() => undefined);
    }
  },
);

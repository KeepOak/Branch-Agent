import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { replaceSessionEntrySync } from "../../config/sessions/session-accessor.sqlite-entry.js";
import {
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabasesAsync,
} from "../../state/branch-agent-db.js";
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

it("refuses an existing session database replaced while first-message admission waits", async () => {
  const storePath = path.join(tempDirs.make("first-message-replaced-"), "agent.sqlite");
  const sessionKey = "agent:main:dashboard:replaced";
  replaceSessionEntrySync(
    { agentId: "main", storePath, sessionKey },
    { sessionId: "original", updatedAt: Date.now() },
  );
  closeBranchAgentDatabaseByPath(storePath);
  const entered = createDeferred();
  const resume = createDeferred();
  let didEnter = false;
  const runWrite = workerWrite.runBranchAgentWorkerWrite;
  vi.spyOn(workerWrite, "runBranchAgentWorkerWrite").mockImplementation(async (...args) => {
    didEnter = true;
    entered.resolve();
    await resume.promise;
    return await runWrite(...args);
  });
  const pending = admitReplyTurn({
    agentId: "main",
    storePath,
    sessionKey,
    sessionId: "original",
    kind: "visible",
    resetTriggered: false,
  });
  try {
    await vi.waitFor(() => expect(didEnter).toBe(true), { timeout: 90_000 });
    await entered.promise;
    const previousPath = `${storePath}.previous`;
    fs.renameSync(storePath, previousPath);
    fs.copyFileSync(previousPath, storePath);
    resume.resolve();
    await expect(pending).rejects.toThrow(/database changed|Session store.*changed/i);
    expect(replyRunRegistry.get(sessionKey)).toBeUndefined();
  } finally {
    resume.resolve();
    await pending.catch(() => undefined);
  }
});

it("gives only one of two simultaneous first messages the reply slot", async () => {
  const storePath = path.join(tempDirs.make("first-message-concurrent-"), "agent.sqlite");
  const sessionKey = "agent:main:dashboard:concurrent";
  const admit = () =>
    admitReplyTurn({
      agentId: "main",
      storePath,
      sessionKey,
      sessionId: "concurrent-session",
      kind: "visible",
      resetTriggered: false,
      waitForActive: false,
    });
  const results = await Promise.all([admit(), admit()]);
  try {
    expect(results.map((result) => result.status).sort()).toEqual(["owned", "skipped"]);
    expect(results.find((result) => result.status === "skipped")).toMatchObject({
      reason: "active-run",
    });
  } finally {
    for (const result of results) {
      if (result.status === "owned") {
        result.operation.complete();
      }
    }
  }
});

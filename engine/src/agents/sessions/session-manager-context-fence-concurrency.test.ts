import path from "node:path";
import { expect, it } from "vitest";
import { upsertSessionEntryCore } from "../../config/sessions/session-accessor.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { makeUserMessage } from "../../../test/helpers/user-message.js";
import { SessionManager } from "./session-manager.js";

// Other sessions appending to the same database must not fail an unadmitted read
// of a session they never touched. The version check still rejects same-session changes.
it("serves unadmitted reads while other sessions append to the same database", async () => {
  await withBranchTestState({ label: "context-fence-concurrency" }, async (state) => {
    const storePath = path.join(state.agentDir("main"), "branch-agent.sqlite");
    const scopeOf = (sessionId: string) => ({
      agentId: "main",
      sessionId,
      sessionKey: `agent:main:${sessionId}`,
      storePath,
    });
    const readers = Array.from({ length: 8 }, (_, index) => scopeOf(`fence-reader-${index}`));
    const writers = Array.from({ length: 8 }, (_, index) => scopeOf(`fence-writer-${index}`));
    for (const scope of [...readers, ...writers]) {
      await upsertSessionEntryCore(scope, { sessionId: scope.sessionId, updatedAt: 1 });
      SessionManager.open(scope).appendMessage(makeUserMessage(`seed ${scope.sessionId}`, 1));
    }
    const writerManagers = writers.map((scope) => SessionManager.open(scope));
    let readsDone = false;
    const isReadsDone = () => readsDone;
    const writes = Promise.all(
      writerManagers.map(async (manager, index) => {
        for (let turn = 0; !isReadsDone() && turn < 2_000; turn += 1) {
          manager.appendMessage(makeUserMessage(`write ${index}.${turn}`, turn + 2));
          await new Promise((resolve) => {
            setImmediate(resolve);
          });
        }
      }),
    );
    const reads = await Promise.all(
      readers.flatMap((scope) => [0, 1, 2].map(() => SessionManager.openModelContextAsync(scope))),
    ).finally(() => {
      readsDone = true;
    });
    await writes;
    for (const manager of reads) {
      expect(manager.buildSessionContext().messages.length).toBeGreaterThanOrEqual(1);
    }
  });
}, 120_000);

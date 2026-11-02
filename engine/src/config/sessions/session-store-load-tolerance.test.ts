import { expect, it, vi } from "vitest";
import { openBranchAgentDatabase } from "../../state/branch-agent-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import {
  listSessionChildEntriesReadOnly,
  listSessionEntriesReadOnly,
  loadSessionEntryReadOnly,
  replaceSessionEntrySync,
} from "./session-accessor.js";
import { runSessionStartupMigration } from "./startup-migration.js";

// Only pre-existing APIs: this regression must execute (not fail to import) on base.
it("loads good sessions when one persisted row is unparseable", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    const cfg = { agents: { ownership: "explicit" as const, entries: { main: {} } } };
    await writeConfig(cfg);
    const parentKey = "agent:main:room:ops";
    const goodChildKey = "agent:main:room:ops:child";
    const brokenKey = "agent:main:room:broken";
    const healthyKey = "agent:main:healthy";
    for (const sessionKey of [parentKey, healthyKey]) {
      replaceSessionEntrySync(
        { cfg, env, agentId: "main", sessionKey },
        { sessionId: `${sessionKey}-id`, updatedAt: 100 },
      );
    }
    for (const sessionKey of [goodChildKey, brokenKey]) {
      replaceSessionEntrySync(
        { cfg, env, agentId: "main", sessionKey },
        { sessionId: `${sessionKey}-id`, updatedAt: 100, parentSessionKey: parentKey },
      );
    }
    const { db } = openBranchAgentDatabase({ agentId: "main", env });
    db.prepare("UPDATE session_nodes SET entry_json = ? WHERE session_key = ?").run("{", brokenKey);

    await expect(
      runSessionStartupMigration({
        cfg,
        env,
        log: { info: vi.fn(), warn: vi.fn() },
        handoffDatabase: vi.fn(async () => {}),
      }),
    ).resolves.toBeUndefined();

    expect(
      listSessionChildEntriesReadOnly({ agentId: "main", env, sessionKey: parentKey }).map(
        ({ sessionKey }) => sessionKey,
      ),
    ).toEqual([goodChildKey]);
    expect(
      listSessionEntriesReadOnly({ agentId: "main", env })
        .map(({ sessionKey }) => sessionKey)
        .toSorted(),
    ).toEqual([healthyKey, parentKey, goodChildKey].toSorted());
    expect(
      loadSessionEntryReadOnly({ agentId: "main", env, sessionKey: healthyKey })?.sessionId,
    ).toBe(`${healthyKey}-id`);
    expect(
      loadSessionEntryReadOnly({ agentId: "main", env, sessionKey: goodChildKey })?.sessionId,
    ).toBe(`${goodChildKey}-id`);
  });
});

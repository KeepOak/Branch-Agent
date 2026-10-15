import { expect, it, vi } from "vitest";
import { openBranchAgentDatabase } from "../../state/branch-agent-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { loadSessionEntryReadOnly, replaceSessionEntrySync } from "./session-accessor.js";
import { runSessionStartupMigration } from "./startup-migration.js";

// Only pre-existing APIs: this regression must execute (not fail to import) on base.
it("starts healthy sessions when one persisted teammate row needs repair", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    const cfg = {
      agents: { ownership: "explicit" as const, entries: { "builder-a": {}, "builder-b": {} } },
    };
    await writeConfig(cfg);
    const brokenKey = "agent:builder-a:trunk:builder-b";
    const healthyKey = "agent:builder-a:healthy";
    for (const sessionKey of [brokenKey, healthyKey]) {
      replaceSessionEntrySync(
        { cfg, env, agentId: "builder-a", sessionKey },
        { sessionId: `${sessionKey}-id`, updatedAt: 100 },
      );
    }
    const { db } = openBranchAgentDatabase({ agentId: "builder-a", env });
    db.prepare("UPDATE session_nodes SET entry_json = entry_json || ' ' WHERE session_key = ?").run(
      brokenKey,
    );
    await expect(
      runSessionStartupMigration({
        cfg,
        env,
        log: { info: vi.fn(), warn: vi.fn() },
        handoffDatabase: vi.fn(async () => {}),
      }),
    ).resolves.toBeUndefined();
    expect(
      loadSessionEntryReadOnly({ agentId: "builder-a", env, sessionKey: healthyKey })?.sessionId,
    ).toBe(`${healthyKey}-id`);
    expect(() =>
      loadSessionEntryReadOnly({ agentId: "builder-a", env, sessionKey: brokenKey }),
    ).toThrow("invalid persisted session row requires repair");
  });
});

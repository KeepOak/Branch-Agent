import { expect, it, vi } from "vitest";
import { noteSessionTranscriptHealth } from "../../commands/doctor-session-transcripts.js";
import { openBranchAgentDatabase } from "../../state/branch-agent-db.js";
import { resolveBranchAgentSqlitePath } from "../../state/branch-agent-db.paths.js";
import { listBranchSessionRowQuarantines } from "../../state/branch-session-row-quarantine.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { replaceSessionEntrySync } from "./session-accessor.js";
import { MAX_STARTUP_QUARANTINED_SESSION_ROWS } from "./session-canonical-validation-readiness.js";
import { runSessionStartupMigration } from "./startup-migration.js";

it("quarantines one invalid persisted session row and lets startup continue", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    const cfg = { agents: { ownership: "explicit" as const, entries: { main: {} } } };
    await writeConfig(cfg);
    const brokenKey = "agent:main:broken";
    const healthyKey = "agent:main:healthy";
    for (const sessionKey of [brokenKey, healthyKey]) {
      replaceSessionEntrySync(
        { cfg, env, agentId: "main", sessionKey },
        { sessionId: `${sessionKey}-id`, updatedAt: 100 },
      );
    }
    const { db } = openBranchAgentDatabase({ agentId: "main", env });
    // A raw write clears writer proof, exactly like a row damaged outside the Gateway.
    db.prepare("UPDATE session_nodes SET entry_json = entry_json || ' ' WHERE session_key = ?").run(
      brokenKey,
    );
    expect(
      db.prepare("SELECT entry_valid FROM session_nodes WHERE session_key = ?").get(brokenKey),
    ).toEqual({ entry_valid: 0 });

    const handoffDatabase = vi.fn(async () => {});
    const log = { info: vi.fn(), warn: vi.fn() };
    await expect(
      runSessionStartupMigration({ cfg, env, log, handoffDatabase }),
    ).resolves.toBeUndefined();
    expect(handoffDatabase).toHaveBeenCalledTimes(1);

    const records = listBranchSessionRowQuarantines(env);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      agentId: "main",
      sessionKey: brokenKey,
      databasePath: resolveBranchAgentSqlitePath({ agentId: "main", env }),
    });
    expect(records[0]?.reason).toContain(
      `invalid persisted session row requires repair for ${brokenKey}`,
    );
    expect(JSON.parse(records[0]?.rowJson ?? "{}")).toMatchObject({
      session_key: brokenKey,
      entry_valid: 0,
    });
    // The row itself stays in place for branch doctor --fix.
    expect(
      db.prepare("SELECT session_key FROM session_nodes WHERE session_key = ?").get(brokenKey),
    ).toEqual({ session_key: brokenKey });

    // A second start records the same row once, not a second repair item.
    await expect(
      runSessionStartupMigration({ cfg, env, log, handoffDatabase }),
    ).resolves.toBeUndefined();
    expect(listBranchSessionRowQuarantines(env)).toHaveLength(1);

    // Doctor stays available and its repair retires the record on the next start.
    await noteSessionTranscriptHealth({
      cfg,
      env,
      shouldRepair: true,
      postSessionPluginMigrationPlanBound: true,
      onWarnings: () => {},
    });
    await expect(
      runSessionStartupMigration({ cfg, env, log, handoffDatabase }),
    ).resolves.toBeUndefined();
    expect(listBranchSessionRowQuarantines(env)).toEqual([]);
  });
});

it("refuses startup when damage is widespread instead of quarantining every row", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    const cfg = { agents: { ownership: "explicit" as const, entries: { main: {} } } };
    await writeConfig(cfg);
    for (let index = 0; index <= MAX_STARTUP_QUARANTINED_SESSION_ROWS; index += 1) {
      replaceSessionEntrySync(
        { cfg, env, agentId: "main", sessionKey: `agent:main:broken-${index}` },
        { sessionId: `broken-${index}`, updatedAt: 100 },
      );
    }
    openBranchAgentDatabase({ agentId: "main", env }).db.exec(
      "UPDATE session_nodes SET entry_json = entry_json || ' '",
    );
    const handoffDatabase = vi.fn(async () => {});
    await expect(
      runSessionStartupMigration({
        cfg,
        env,
        log: { info: vi.fn(), warn: vi.fn() },
        handoffDatabase,
      }),
    ).rejects.toThrow("invalid persisted session row requires repair");
    expect(handoffDatabase).not.toHaveBeenCalled();
    expect(listBranchSessionRowQuarantines(env)).toEqual([]);
  });
});

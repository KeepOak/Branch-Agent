import fs from "node:fs";
import { expect, it, vi } from "vitest";
import { noteSessionTranscriptHealth } from "../../commands/doctor-session-transcripts.js";
import { openBranchAgentDatabase } from "../../state/branch-agent-db.js";
import { resolveBranchAgentSqlitePath } from "../../state/branch-agent-db.paths.js";
import { listBranchSessionRowQuarantines } from "../../state/branch-session-row-quarantine.js";
import { resolveQuarantineStorePath } from "../../state/branch-state-db.paths.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import {
  listSessionChildEntriesReadOnly,
  listSessionEntriesReadOnly,
  loadSessionEntryReadOnly,
  replaceSessionEntrySync,
} from "./session-accessor.js";
import { MAX_STARTUP_QUARANTINED_SESSION_ROWS } from "./session-canonical-validation-readiness.js";
import { runSessionStartupMigration } from "./startup-migration.js";

const cfg = { agents: { ownership: "explicit" as const, entries: { main: {} } } };
const REPAIR = "invalid persisted session row requires repair";

function startup(env: NodeJS.ProcessEnv) {
  const handoffDatabase = vi.fn(async () => {});
  const run = runSessionStartupMigration({
    cfg,
    env,
    log: { info: vi.fn(), warn: vi.fn() },
    handoffDatabase,
  });
  return { run, handoffDatabase };
}

function seed(env: NodeJS.ProcessEnv, sessionKeys: readonly string[]) {
  for (const sessionKey of sessionKeys) {
    replaceSessionEntrySync(
      { cfg, env, agentId: "main", sessionKey },
      { sessionId: `${sessionKey}-id`, updatedAt: 100 },
    );
  }
  return openBranchAgentDatabase({ agentId: "main", env }).db;
}

type Db = ReturnType<typeof seed>;

// A raw write clears writer proof, exactly like a row damaged outside the Gateway.
function damage(db: Db, sessionKey: string) {
  db.prepare("UPDATE session_nodes SET entry_json = entry_json || ' ' WHERE session_key = ?").run(
    sessionKey,
  );
}

function entryValid(db: Db, sessionKey: string) {
  return db.prepare("SELECT entry_valid FROM session_nodes WHERE session_key = ?").get(sessionKey);
}

function isPending(db: Db, sessionKey: string) {
  return (
    db
      .prepare(
        "SELECT 1 AS pending FROM session_canonical_validation_pending WHERE session_key = ?",
      )
      .get(sessionKey) !== undefined
  );
}

it("quarantines one invalid persisted session row and lets startup continue", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    await writeConfig(cfg);
    const brokenKey = "agent:main:broken";
    const healthyKey = "agent:main:healthy";
    const db = seed(env, [brokenKey, healthyKey]);
    // A child that names the quarantined row as its parent is itself valid.
    const childKey = "agent:main:child";
    replaceSessionEntrySync(
      { cfg, env, agentId: "main", sessionKey: childKey },
      { sessionId: "child-id", updatedAt: 100, parentSessionKey: brokenKey },
    );
    damage(db, brokenKey);
    expect(entryValid(db, brokenKey)).toEqual({ entry_valid: 0 });

    const first = startup(env);
    await expect(first.run).resolves.toBeUndefined();
    expect(first.handoffDatabase).toHaveBeenCalledTimes(1);

    const records = listBranchSessionRowQuarantines(env);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      agentId: "main",
      sessionKey: brokenKey,
      databasePath: resolveBranchAgentSqlitePath({ agentId: "main", env }),
    });
    expect(records[0]?.reason).toContain(`${REPAIR} for ${brokenKey}`);
    expect(JSON.parse(records[0]?.rowJson ?? "{}")).toMatchObject({
      session_key: brokenKey,
      entry_valid: 0,
    });
    // The row stays in place for branch doctor --fix, settled invalid and out of pending.
    expect(entryValid(db, brokenKey)).toEqual({ entry_valid: -1 });
    expect(isPending(db, brokenKey)).toBe(false);

    // Every reader refuses or skips the quarantined key; other sessions stay readable.
    for (const projection of ["full", "list"] as const) {
      expect(() =>
        loadSessionEntryReadOnly({ agentId: "main", env, sessionKey: brokenKey, projection }),
      ).toThrow(REPAIR);
      expect(
        loadSessionEntryReadOnly({ agentId: "main", env, sessionKey: healthyKey, projection })
          ?.sessionId,
      ).toBe(`${healthyKey}-id`);
    }
    expect(
      loadSessionEntryReadOnly({ agentId: "main", env, sessionKey: childKey })?.parentSessionKey,
    ).toBe(brokenKey);
    expect(
      listSessionChildEntriesReadOnly({ agentId: "main", env, sessionKey: brokenKey }).map(
        ({ sessionKey }) => sessionKey,
      ),
    ).toEqual([childKey]);
    expect(
      listSessionEntriesReadOnly({ agentId: "main", env })
        .map(({ sessionKey }) => sessionKey)
        .toSorted(),
    ).toEqual([childKey, healthyKey]);

    // A second start records the same row once and keeps it unreadable.
    await expect(startup(env).run).resolves.toBeUndefined();
    expect(listBranchSessionRowQuarantines(env)).toHaveLength(1);
    expect(() => loadSessionEntryReadOnly({ agentId: "main", env, sessionKey: brokenKey })).toThrow(
      REPAIR,
    );

    // Doctor stays available and its repair retires the record on the next start.
    await noteSessionTranscriptHealth({
      cfg,
      env,
      shouldRepair: true,
      postSessionPluginMigrationPlanBound: true,
      onWarnings: () => {},
    });
    await expect(startup(env).run).resolves.toBeUndefined();
    expect(listBranchSessionRowQuarantines(env)).toEqual([]);
    expect(
      loadSessionEntryReadOnly({ agentId: "main", env, sessionKey: brokenKey })?.sessionId,
    ).toBe(`${brokenKey}-id`);
  });
});

it("retires the record when the quarantined row is deleted", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    await writeConfig(cfg);
    const brokenKey = "agent:main:broken";
    const db = seed(env, [brokenKey, "agent:main:healthy"]);
    damage(db, brokenKey);
    await expect(startup(env).run).resolves.toBeUndefined();
    expect(listBranchSessionRowQuarantines(env)).toHaveLength(1);

    db.prepare("DELETE FROM session_nodes WHERE session_key = ?").run(brokenKey);
    await expect(startup(env).run).resolves.toBeUndefined();
    expect(listBranchSessionRowQuarantines(env)).toEqual([]);
  });
});

it("keeps refusing a non-canonical row so doctor's key migration handles it", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    await writeConfig(cfg);
    const db = seed(env, ["agent:main:healthy"]);
    // Writer proof is intact, so validation reaches the canonical-key check.
    db.prepare(
      "INSERT INTO session_nodes (session_key, current_session_id, entry_json, updated_at) VALUES (?, ?, ?, 100)",
    ).run(
      "agent:main:Mixed",
      "mixed-id",
      JSON.stringify({ sessionId: "mixed-id", updatedAt: 100 }),
    );
    db.prepare("UPDATE session_nodes SET entry_valid = 1 WHERE session_key = ?").run(
      "agent:main:Mixed",
    );
    expect(isPending(db, "agent:main:Mixed")).toBe(true);

    const refused = startup(env);
    await expect(refused.run).rejects.toThrow(
      "non-canonical persisted row resolves to session key",
    );
    expect(refused.handoffDatabase).not.toHaveBeenCalled();
    expect(listBranchSessionRowQuarantines(env)).toEqual([]);
    expect(entryValid(db, "agent:main:Mixed")).toEqual({ entry_valid: 1 });
  });
});

it("refuses with the original error when the quarantine record cannot be written", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    await writeConfig(cfg);
    const brokenKey = "agent:main:broken";
    const db = seed(env, [brokenKey, "agent:main:healthy"]);
    damage(db, brokenKey);
    // A directory where the store file belongs makes every quarantine write fail.
    const storePath = resolveQuarantineStorePath(env);
    const savedStorePath = `${storePath}.saved`;
    const hadStore = fs.existsSync(storePath);
    if (hadStore) {
      fs.renameSync(storePath, savedStorePath);
    }
    fs.mkdirSync(storePath, { recursive: true });

    const refused = startup(env);
    await expect(refused.run).rejects.toThrow(`${REPAIR} for ${brokenKey}`);
    expect(refused.handoffDatabase).not.toHaveBeenCalled();
    expect(entryValid(db, brokenKey)).toEqual({ entry_valid: 0 });
    expect(isPending(db, brokenKey)).toBe(true);

    fs.rmSync(storePath, { recursive: true });
    if (hadStore) {
      fs.renameSync(savedStorePath, storePath);
    }
    await expect(startup(env).run).resolves.toBeUndefined();
    expect(listBranchSessionRowQuarantines(env)).toHaveLength(1);
  });
});

it("counts invalid rows across batches against one startup cap", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    await writeConfig(cfg);
    // 140 pending keys need two 128-row batches; keys sort by their padded index.
    const keys = Array.from(
      { length: 140 },
      (_, index) => `agent:main:s-${String(index).padStart(3, "0")}`,
    );
    const db = seed(env, keys);
    const firstBatch = keys.slice(0, 5);
    const secondBatch = keys.slice(128, 132);
    expect(firstBatch.length + secondBatch.length).toBe(MAX_STARTUP_QUARANTINED_SESSION_ROWS + 1);
    for (const key of [...firstBatch, ...secondBatch]) {
      damage(db, key);
    }
    db.exec(
      "INSERT OR IGNORE INTO session_canonical_validation_pending (session_key) SELECT session_key FROM session_nodes",
    );

    // The cap is reached in the second batch: startup refuses and that batch stays pending.
    const refused = startup(env);
    await expect(refused.run).rejects.toThrow(REPAIR);
    expect(refused.handoffDatabase).not.toHaveBeenCalled();
    expect(
      listBranchSessionRowQuarantines(env)
        .map(({ sessionKey }) => sessionKey)
        .toSorted(),
    ).toEqual(firstBatch);
    for (const key of secondBatch) {
      expect(entryValid(db, key)).toEqual({ entry_valid: 0 });
      expect(isPending(db, key)).toBe(true);
    }

    // Doctor repairs one second-batch row; the remaining three fit the next start's cap.
    db.prepare("UPDATE session_nodes SET entry_json = rtrim(entry_json) WHERE session_key = ?").run(
      secondBatch[0]!,
    );
    db.prepare("UPDATE session_nodes SET entry_valid = 1 WHERE session_key = ?").run(
      secondBatch[0]!,
    );
    await expect(startup(env).run).resolves.toBeUndefined();
    expect(
      listBranchSessionRowQuarantines(env)
        .map(({ sessionKey }) => sessionKey)
        .toSorted(),
    ).toEqual([...firstBatch, ...secondBatch.slice(1)]);
  });
});

it("refuses startup when damage is widespread instead of quarantining every row", async () => {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    await writeConfig(cfg);
    const keys = Array.from(
      { length: MAX_STARTUP_QUARANTINED_SESSION_ROWS + 1 },
      (_, index) => `agent:main:broken-${index}`,
    );
    seed(env, keys).exec("UPDATE session_nodes SET entry_json = entry_json || ' '");
    const refused = startup(env);
    await expect(refused.run).rejects.toThrow(REPAIR);
    expect(refused.handoffDatabase).not.toHaveBeenCalled();
    expect(listBranchSessionRowQuarantines(env)).toEqual([]);
  });
});

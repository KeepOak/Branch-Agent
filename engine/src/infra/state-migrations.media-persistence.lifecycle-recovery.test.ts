import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { recordBranchDatabaseQuarantine } from "../state/branch-quarantine-store.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  completeGatewayBootLifecycle,
  inspectGatewayCrashLoopBreaker,
  recordGatewayBootStart,
} from "./gateway-boot-lifecycle.js";
import { corruptSqliteIndexKey } from "./sqlite-index-corruption.test-support.js";
import * as integrityWorker from "./sqlite-integrity-worker.js";
import { GATEWAY_STARTUP_MAINTENANCE_REQUIRED_REASON } from "./startup-maintenance-required.js";
import { migrateLegacyMediaPersistence } from "./state-migrations.media-persistence.js";
import { createLegacyDatabaseFixture } from "./state-migrations.media-persistence.test-support.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  vi.restoreAllMocks();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

describe("media persistence gateway lifecycle recovery", () => {
  it("leaves maintenance completion to Doctor after a successful media migration", async () => {
    const stateDir = tempDirs.make("media-persistence-startup-recovery-");
    const env = { BRANCH_STATE_DIR: stateDir };
    createLegacyDatabaseFixture({ env, eventsBySession: {}, schemaVersion: 14 });

    const nowMs = 1_000_000;
    for (let index = 0; index < 3; index += 1) {
      const bootId = recordGatewayBootStart(env, nowMs + index);
      completeGatewayBootLifecycle(
        bootId,
        {
          outcome: "startup_failed",
          reason: `migration required ${index}`,
          startupReason: GATEWAY_STARTUP_MAINTENANCE_REQUIRED_REASON,
        },
        env,
        nowMs + index + 1,
      );
    }
    expect(inspectGatewayCrashLoopBreaker(env, nowMs + 4).tripped).toBe(false);

    const result = await migrateLegacyMediaPersistence({ env });

    expect(result.warnings).toEqual([]);
    expect(
      openBranchStateDatabase({ env })
        .db.prepare(
          "SELECT COUNT(*) AS count FROM gateway_boot_lifecycle WHERE outcome = 'startup_failed'",
        )
        .get(),
    ).toMatchObject({ count: 3 });
    expect(inspectGatewayCrashLoopBreaker(env, nowMs + 5)).toMatchObject({
      tripped: false,
      uncleanBoots: 0,
    });
  });
});

it("checks healthy agent integrity once before media migration", async () => {
  const env = { BRANCH_STATE_DIR: tempDirs.make("media-persistence-integrity-") };
  const initial = openBranchAgentDatabase({ agentId: "main", env });
  closeBranchAgentDatabasesForTest();
  const checks = vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker");

  expect(await migrateLegacyMediaPersistence({ env })).toEqual({ changes: [], warnings: [] });
  expect(checks.mock.calls.filter(([pathname]) => pathname === initial.path)).toHaveLength(1);
});

it.each([true])(
  "Doctor preserves and rebuilds a corrupt agent index (quarantined=%s)",
  async (quarantined) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const options = { agentId: "main", env: state.env };
      const initial = openBranchAgentDatabase(options);
      initial.db.exec(`INSERT INTO session_nodes
      (session_key, current_session_id, entry_json, updated_at)
      VALUES ('agent:main:index-original', 'fixture-session', '{"sessionId":"fixture-session","updatedAt":1}', 1)`);
      const payloadSql = "SELECT session_key, entry_json FROM session_nodes NOT INDEXED";
      const rows = initial.db.prepare(payloadSql).all();
      closeBranchAgentDatabasesForTest();
      const index = "sqlite_autoindex_session_nodes_1";
      corruptSqliteIndexKey(initial.path, index, "index-original", "index-damaged!");
      if (quarantined) {
        expect(
          recordBranchDatabaseQuarantine({
            env: state.env,
            kind: "agent",
            path: initial.path,
            reason: `row 1 missing from index ${index}`,
          }),
        ).toBe(true);
      }

      const result = await migrateLegacyMediaPersistence({ env: state.env });

      expect(result.warnings).toEqual([]);
      expect(result.changes).toContain(
        `Warning: Rebuilt corrupt agent main SQLite indexes: ${index}. No table rows were removed.`,
      );
      const backupLine = result.changes.find((line) =>
        line.startsWith("Saved pre-repair SQLite backup: "),
      );
      expect(backupLine).toBeDefined();
      const backup = new DatabaseSync(
        backupLine!.slice("Saved pre-repair SQLite backup: ".length),
        {
          readOnly: true,
        },
      );
      try {
        expect(backup.prepare("PRAGMA integrity_check").all()).toContainEqual({
          integrity_check: `row 1 missing from index ${index}`,
        });
        expect(backup.prepare(payloadSql).all()).toEqual(rows);
      } finally {
        backup.close();
      }
      const repaired = openBranchAgentDatabase(options);
      expect(repaired.db.prepare("PRAGMA integrity_check").all()).toEqual([
        { integrity_check: "ok" },
      ]);
      expect(repaired.db.prepare(payloadSql).all()).toEqual(rows);

      closeBranchAgentDatabasesForTest();
      expect(
        recordBranchDatabaseQuarantine({
          env: state.env,
          kind: "agent",
          path: initial.path,
          reason: `row 1 missing from index ${index}`,
        }),
      ).toBe(true);
      const resumed = await migrateLegacyMediaPersistence({ env: state.env });
      expect(resumed).toEqual({ changes: [], warnings: [] });
      expect(openBranchAgentDatabase(options).db.prepare(payloadSql).all()).toEqual(rows);
    });
  },
);

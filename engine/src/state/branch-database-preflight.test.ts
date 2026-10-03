import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json" with { type: "json" };
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { createUpdateRun } from "../infra/update-run-ledger.js";
import { BranchAgentDatabaseMediaMigrationRequiredError } from "./branch-agent-db-migration-required.js";
import {
  closeBranchAgentDatabasesForTest,
  BRANCH_AGENT_SCHEMA_VERSION,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import {
  assertBranchDatabasesReady,
  preflightBranchStateDatabasePath,
  preflightBranchDatabaseSchemas,
} from "./branch-database-preflight.js";
import {
  snapshotPreflightSourceManifest,
  snapshotSourceFamily,
} from "./branch-database-preflight.test-support.js";
import { repairAuditEventsSchema } from "./branch-state-db-audit-migration.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import { BranchStateDatabaseSchemaMigrationRequiredError } from "./branch-state-db-schema-migration-required.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function closeDatabases() {
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
}
afterEach(closeDatabases);

function withDatabase(pathname: string, run: (database: DatabaseSync) => void) {
  const database = new (requireNodeSqlite().DatabaseSync)(pathname);
  try {
    run(database);
  } finally {
    database.close();
  }
}

function createState() {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-preflight-") };
  const statePath = openBranchStateDatabase({ env }).path;
  closeDatabases();
  return { env, statePath };
}

describe("Branch Agent database schema preflight", () => {
  it("keeps package schema support metadata aligned", () => {
    expect(packageJson.branch.schemaVersions).toEqual({
      state: BRANCH_STATE_SCHEMA_VERSION,
      agent: BRANCH_AGENT_SCHEMA_VERSION,
    });
  });

  it("accepts an older v6 state database without the lazy setup id during restart preflight", async () => {
    const stateDir = tempDirs.make("branch-database-preflight-older-v6-setup-id-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const statePath = openBranchStateDatabase({ env }).path;
    closeBranchStateDatabaseForTest();

    const { DatabaseSync } = requireNodeSqlite();
    const state = new DatabaseSync(statePath);
    try {
      state.exec("ALTER TABLE device_bootstrap_tokens DROP COLUMN setup_id;");
    } finally {
      state.close();
    }
    await expect(
      assertBranchDatabasesReady({ env, operation: "gateway-restart" }),
    ).resolves.toBeUndefined();
  });

  function createReleasedStateDatabase() {
    const stateDir = tempDirs.make("branch-startup-database-admission-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const statePath = resolveBranchStateSqlitePath(env);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const fixture = new URL(
      "../../test/fixtures/sqlite/branch-state-v2026.7.1-2.sqlite.gz",
      import.meta.url,
    );
    fs.writeFileSync(statePath, gunzipSync(fs.readFileSync(fixture)));
    fs.writeFileSync(path.join(stateDir, "branch.json"), "{}\n");
    return { env, stateDir, statePath };
  }

  it("refuses released legacy audit state before changing any persistent artifact", async () => {
    const { env, stateDir, statePath } = createReleasedStateDatabase();
    const before = snapshotPreflightSourceManifest(stateDir);
    await expect(
      assertBranchDatabasesReady({ env, operation: "gateway-startup", config: {} }),
    ).rejects.toBeInstanceOf(BranchStateDatabaseSchemaMigrationRequiredError);
    expect(snapshotPreflightSourceManifest(stateDir)).toEqual(before);
    await expect(preflightBranchStateDatabasePath(statePath)).resolves.toMatchObject({
      foundVersion: 1,
    });
  });

  it("refuses a configured legacy agent database without mutating its WAL or creating stores", async () => {
    const stateDir = tempDirs.make("branch-agent-startup-admission-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const agentPath = path.join(stateDir, "custom", "sessions.sqlite");
    openBranchAgentDatabase({ agentId: "main", path: agentPath, env });
    closeDatabases();
    const { DatabaseSync } = requireNodeSqlite();
    const writer = new DatabaseSync(agentPath);
    try {
      writer.exec(
        "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA user_version = 15; UPDATE schema_meta SET schema_version = 15;",
      );
      const config = { session: { store: path.join(stateDir, "custom", "sessions.json") } };
      const before = snapshotPreflightSourceManifest(stateDir, agentPath);
      await expect(
        assertBranchDatabasesReady({ env, operation: "gateway-startup", config }),
      ).rejects.toBeInstanceOf(BranchAgentDatabaseMediaMigrationRequiredError);
      expect(snapshotPreflightSourceManifest(stateDir, agentPath)).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("rejects a canonical configured agent path owned by another agent before writes", async () => {
    const root = tempDirs.make("branch-configured-agent-owner-");
    const env = { BRANCH_STATE_DIR: path.join(root, "active") };
    const agentDir = path.join(root, "external", "agents", "alpha");
    const agentPath = path.join(agentDir, "agent", "branch-agent.sqlite");
    const store = path.join(agentDir, "sessions", "sessions.json");
    openBranchStateDatabase({ env });
    openBranchAgentDatabase({
      agentId: "beta",
      path: agentPath,
      env: { BRANCH_STATE_DIR: path.join(root, "donor") },
    });
    closeDatabases();
    const before = snapshotPreflightSourceManifest(root);
    await expect(
      assertBranchDatabasesReady({
        env,
        operation: "gateway-startup",
        config: { session: { store } },
      }),
    ).rejects.toThrow("belongs to agent beta; requested agent alpha");
    expect(snapshotPreflightSourceManifest(root)).toEqual(before);
  });

  it("admits supported forward state migration after the Doctor-owned audit repair", async () => {
    const { env, stateDir, statePath } = createReleasedStateDatabase();
    withDatabase(statePath, (database) => {
      expect(repairAuditEventsSchema(database)).toBe(true);
    });
    const before = snapshotPreflightSourceManifest(stateDir);
    await expect(
      assertBranchDatabasesReady({ env, operation: "gateway-startup", config: {} }),
    ).resolves.toBeUndefined();
    expect(snapshotPreflightSourceManifest(stateDir)).toEqual(before);
    const migrated = openBranchStateDatabase({ env });
    expect(migrated.db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: BRANCH_STATE_SCHEMA_VERSION,
    });
  });

  it.each([false, true])(
    "recognizes deferred content and still checks its shape (damaged: %s)",
    async (damaged) => {
      const env = { BRANCH_STATE_DIR: tempDirs.make("branch-preflight-deferred-schema-") };
      const statePath = openBranchStateDatabase({ env }).path;
      const run = createUpdateRun({ trigger: "cli", before: { version: "2026.9.2" } }, { env });
      closeBranchStateDatabaseForTest();
      withDatabase(statePath, (database) => {
        database.exec(
          `PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION - 1}; UPDATE schema_meta SET schema_version = ${BRANCH_STATE_SCHEMA_VERSION - 1};`,
        );
        database
          .prepare(
            "INSERT INTO config_machine_state (state_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
          )
          .run("state.schema.contentVersion", String(BRANCH_STATE_SCHEMA_VERSION), Date.now());
        if (damaged) {
          database.exec(
            "ALTER TABLE worktrees DROP COLUMN run_end_cleanup_json; ALTER TABLE worktrees ADD COLUMN run_end_cleanup_json INTEGER;",
          );
        }
      });
      const before = snapshotSourceFamily(statePath);
      const result = await preflightBranchDatabaseSchemas({
        env,
        verifyCurrentSchemaShape: true,
      });
      expect(result.pendingMigrations).toBeUndefined();
      expect(result.incompatible).toEqual([]);
      expect(result.deferredSchemaPublications).toEqual([
        expect.objectContaining({
          kind: "state",
          path: statePath,
          foundVersion: BRANCH_STATE_SCHEMA_VERSION - 1,
          contentVersion: BRANCH_STATE_SCHEMA_VERSION,
          runId: run.runId,
        }),
      ]);
      expect(result.indeterminate).toEqual(
        damaged
          ? [
              expect.objectContaining({
                kind: "state",
                reason: expect.stringContaining("column definitions differ for worktrees"),
              }),
            ]
          : [],
      );
      expect(snapshotSourceFamily(statePath)).toEqual(before);
      if (damaged) {
        await expect(
          assertBranchDatabasesReady({ env, operation: "gateway-restart" }),
        ).rejects.toThrow(/Gateway refused restart.*column definitions differ for worktrees/su);
      } else {
        await expect(
          preflightBranchDatabaseSchemas({
            env,
            supportedVersions: {
              state: BRANCH_STATE_SCHEMA_VERSION - 1,
              agent: BRANCH_AGENT_SCHEMA_VERSION,
            },
          }),
        ).resolves.toMatchObject({
          incompatible: [expect.objectContaining({ foundVersion: BRANCH_STATE_SCHEMA_VERSION })],
        });
        await expect(preflightBranchStateDatabasePath(statePath)).resolves.toMatchObject({
          status: "exact",
          foundVersion: BRANCH_STATE_SCHEMA_VERSION - 1,
          contentVersion: BRANCH_STATE_SCHEMA_VERSION,
          deferredPublication: expect.objectContaining({ runId: run.runId }),
        });
      }
    },
  );

  it.each(["default", "configured"])(
    "holds an unregistered %s store without deletion history or creating shared state",
    async (layout) => {
      const env = { BRANCH_STATE_DIR: tempDirs.make("branch-unregistered-readiness-") };
      const customPath = path.join(tempDirs.make("branch-configured-readiness-"), "agent.sqlite");
      const agent = openBranchAgentDatabase({
        agentId: "main",
        env,
        ...(layout === "configured" ? { path: customPath } : {}),
      });
      const statePath = resolveBranchStateSqlitePath(env);
      closeDatabases();
      fs.unlinkSync(statePath);
      withDatabase(agent.path, (database) => {
        database.exec("PRAGMA journal_mode = DELETE;");
        database.exec(
          "DROP TABLE session_participants; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
        );
      });
      const options = {
        env,
        operation: "doctor" as const,
        configuredAgentDatabaseTargets:
          layout === "configured" ? [{ agentId: "main", path: agent.path }] : [],
        onAgentInspection: vi.fn(),
      };
      const before = snapshotSourceFamily(agent.path);
      await expect(assertBranchDatabasesReady(options)).resolves.toBeUndefined();
      expect(options.onAgentInspection).toHaveBeenCalledExactlyOnceWith({
        schemaProcessCount: 0,
        schemaInspectionCount: 0,
        schemaSnapshotCount: 0,
      });
      const onAgentDatabaseDiscovery = vi.fn();
      await expect(
        preflightBranchDatabaseSchemas({ ...options, onAgentDatabaseDiscovery }),
      ).resolves.toEqual({ incompatible: [], indeterminate: [] });
      expect(onAgentDatabaseDiscovery).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          discovery: expect.objectContaining({
            targets: [],
            deletionJournal: {
              status: "unavailable",
              cause: "missing",
              reason: "shared state database missing",
            },
            retainedTargets: [],
            unverifiedTargets: [
              {
                agentId: "main",
                path: agent.path,
                realPath: fs.realpathSync.native(agent.path),
                source: layout === "configured" ? "configured" : "disk",
              },
            ],
            registryRemovals: [],
            failures: [],
          }),
        }),
      );
      expect(snapshotSourceFamily(agent.path)).toEqual(before);
      expect(fs.existsSync(statePath)).toBe(false);
    },
  );

  it.each(["absent", "drifted"])(
    "preflights the %s transcript eligibility index without repairing it",
    async (shape) => {
      const env = {
        BRANCH_STATE_DIR: tempDirs.make("branch-transcript-eligibility-preflight-"),
      };
      const agentPath = openBranchAgentDatabase({ agentId: "worker-1", env }).path;
      closeDatabases();
      withDatabase(agentPath, (agent) => {
        agent.exec("DROP INDEX idx_agent_transcript_context_pending");
        if (shape === "absent") {
          agent.exec("ALTER TABLE session_transcript_active_events DROP COLUMN context_eligible");
        } else {
          agent.exec(
            "CREATE INDEX idx_agent_transcript_context_pending ON session_transcript_active_events(event_seq)",
          );
        }
      });
      const before = snapshotSourceFamily(agentPath);
      const result = await preflightBranchDatabaseSchemas({
        env,
        verifyCurrentSchemaShape: true,
      });
      expect(result.incompatible).toEqual([]);
      expect(result.indeterminate).toEqual(
        shape === "drifted"
          ? [
              {
                kind: "agent",
                path: agentPath,
                reason: expect.stringContaining("idx_agent_transcript_context_pending"),
              },
            ]
          : [],
      );
      expect(snapshotSourceFamily(agentPath)).toEqual(before);
    },
  );

  it("checks every registered owner before permitting Gateway restart", async () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("branch-preflight-conflicting-owners-") };
    const agentPath = openBranchAgentDatabase({ agentId: "main", env }).path;
    const statePath = resolveBranchStateSqlitePath(env);
    closeDatabases();
    withDatabase(statePath, (registry) => {
      registry
        .prepare(
          "INSERT INTO agent_databases (agent_id, path, schema_version, last_seen_at, size_bytes) VALUES (?, ?, ?, ?, ?)",
        )
        .run("ops", agentPath, BRANCH_AGENT_SCHEMA_VERSION, 1, null);
    });

    await expect(
      assertBranchDatabasesReady({ env, operation: "gateway-restart" }),
    ).rejects.toThrow(/Gateway refused restart.*belongs to agent main; requested agent ops/s);
  });
  it("reports a failed agent registry query as indeterminate", async () => {
    const { env, statePath } = createState();
    withDatabase(statePath, (database) => {
      database.exec("DROP TABLE agent_databases; CREATE TABLE agent_databases (bad TEXT) STRICT;");
    });
    expect(await preflightBranchDatabaseSchemas({ env })).toEqual({
      incompatible: [],
      indeterminate: [
        {
          kind: "state",
          path: statePath,
          reason: expect.stringContaining("agent database registry query failed"),
        },
      ],
    });
  });

  it.runIf(process.platform !== "win32")(
    "keeps partial configured-store inventory when one candidate lookup is denied",
    async () => {
      const { env } = createState();
      const visibleDir = tempDirs.make("branch-configured-visible-");
      const deniedDir = tempDirs.make("branch-configured-denied-");
      const visiblePath = path.join(visibleDir, "newer.sqlite");
      const deniedPath = path.join(deniedDir, "owned.sqlite");
      const absentPath = path.join(visibleDir, "absent.sqlite");
      for (const databasePath of [visiblePath, deniedPath]) {
        withDatabase(databasePath, (database) => {
          database.exec(
            `PRAGMA user_version = ${BRANCH_AGENT_SCHEMA_VERSION + (databasePath === visiblePath ? 1 : 0)};`,
          );
        });
      }

      fs.chmodSync(deniedDir, 0o000);
      let result: Awaited<ReturnType<typeof preflightBranchDatabaseSchemas>>;
      try {
        result = await preflightBranchDatabaseSchemas({
          env,
          configuredAgentDatabaseCandidatePaths: [visiblePath, deniedPath, absentPath],
        });
      } finally {
        fs.chmodSync(deniedDir, 0o700);
      }

      expect(result).toEqual({
        incompatible: [
          {
            kind: "agent",
            path: visiblePath,
            foundVersion: BRANCH_AGENT_SCHEMA_VERSION + 1,
            supportedVersion: BRANCH_AGENT_SCHEMA_VERSION,
          },
        ],
        indeterminate: [
          {
            kind: "agent",
            path: deniedPath,
            reason: expect.stringMatching(/EACCES|permission denied/iu),
          },
        ],
      });
    },
  );
});

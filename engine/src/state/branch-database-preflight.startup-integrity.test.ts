import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import * as integrity from "../infra/sqlite-integrity.js";
import * as snapshots from "../infra/sqlite-snapshot-source.js";
import { readAgentDatabaseAdmissionRefusal } from "./agent-database-admission.js";
import { BranchAgentDatabaseMediaMigrationRequiredError } from "./branch-agent-db-migration-required.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import { assertBranchDatabasesReady } from "./branch-database-preflight.js";
import { snapshotPreflightSourceManifest } from "./branch-database-preflight.test-support.js";
import { clearBranchAgentIntegrityVerification } from "./branch-quarantine-store.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

it.each(["DELETE", "WAL", "closed WAL"])(
  "freshly checks startup integrity off the main thread and preserves %s source artifacts",
  async (mode) => {
    const stateDir = tempDirs.make("branch-startup-integrity-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const agentPath = path.join(stateDir, "agents/main/agent/branch-agent.sqlite");
    openBranchAgentDatabase({ agentId: "main", path: agentPath, env });
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    // These raw writers model unclean external mutation, outside the lease owner.
    clearBranchAgentIntegrityVerification(agentPath, env);
    const { DatabaseSync } = requireNodeSqlite();
    const writer = mode === "closed WAL" ? undefined : new DatabaseSync(agentPath);
    writer?.exec(`PRAGMA journal_mode=${mode}; PRAGMA wal_autocheckpoint=0;`);
    const prepare = snapshots.prepareSqliteReadOnlyLocation;
    vi.spyOn(snapshots, "prepareSqliteReadOnlyLocation").mockImplementation((pathname, options) => {
      if (pathname === agentPath && mode !== "closed WAL") {
        throw new Error("No space for a full agent database snapshot");
      }
      return prepare(pathname, options);
    });
    const check = integrity.assertSqliteIntegrity;
    const mainThreadAgentChecks: string[] = [];
    vi.spyOn(integrity, "assertSqliteIntegrity").mockImplementation((database, label) => {
      if (label === agentPath) {
        mainThreadAgentChecks.push(label);
      }
      return check(database, label);
    });
    try {
      for (const damaged of [false, true]) {
        if (damaged) {
          const mutation = writer ?? new DatabaseSync(agentPath);
          try {
            mutation.exec(
              `PRAGMA foreign_keys = OFF; CREATE TABLE integrity_probe_parent(id INTEGER ${mode === "DELETE" ? "" : "PRIMARY KEY"}); CREATE TABLE integrity_probe_child(parent_id INTEGER REFERENCES integrity_probe_parent(id)); INSERT INTO integrity_probe_child VALUES (42);`,
            );
          } finally {
            if (!writer) {
              mutation.close();
            }
          }
        }
        const before = snapshotPreflightSourceManifest(
          stateDir,
          mode === "WAL" ? agentPath : undefined,
        );
        const readiness = assertBranchDatabasesReady({
          env,
          operation: "gateway-startup",
          config: {},
        });
        if (damaged) {
          await expect(readiness).rejects.toMatchObject({
            name: "SqliteIntegrityError",
            message: expect.stringContaining(`foreign_key_check failed for ${agentPath}`),
            ...(mode === "DELETE"
              ? {
                  cause: {
                    code: "ERR_SQLITE_ERROR",
                    errcode: 1,
                    message: expect.stringContaining("foreign key mismatch"),
                  },
                }
              : {}),
          });
        } else {
          await expect(readiness).resolves.toBeUndefined();
        }
        expect(mainThreadAgentChecks).toEqual([]);
        expect(
          snapshotPreflightSourceManifest(stateDir, mode === "WAL" ? agentPath : undefined),
        ).toEqual(before);
      }
    } finally {
      writer?.close();
    }
  },
);

it("isolates a corrupt foreign secondary before reporting its integrity failure", async () => {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-startup-foreign-") };
  const agentPath = openBranchAgentDatabase({ agentId: "worker", env }).path;
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  const writer = new (requireNodeSqlite().DatabaseSync)(agentPath);
  try {
    writer.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=OFF; UPDATE schema_meta SET agent_id='foreign'; CREATE TABLE probe_parent(id INTEGER PRIMARY KEY); CREATE TABLE probe_child(parent_id REFERENCES probe_parent(id)); INSERT INTO probe_child VALUES (42);",
    );
    await expect(
      assertBranchDatabasesReady({
        env,
        operation: "gateway-startup",
        config: { agents: { list: [{ id: "main", default: true }, { id: "worker" }] } },
      }),
    ).resolves.toBeUndefined();
    expect(readAgentDatabaseAdmissionRefusal("worker", { env })).toMatchObject({
      embeddedOwnerId: "foreign",
    });
  } finally {
    writer.close();
  }
});

it("preserves the startup maintenance-required error class across the direct child", async () => {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-startup-legacy-") };
  const agentPath = openBranchAgentDatabase({ agentId: "main", env }).path;
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  const writer = new (requireNodeSqlite().DatabaseSync)(agentPath);
  try {
    writer.exec(
      "PRAGMA journal_mode=DELETE; PRAGMA user_version=1; UPDATE schema_meta SET schema_version=1;",
    );
    await expect(
      assertBranchDatabasesReady({ env, operation: "gateway-startup", config: {} }),
    ).rejects.toBeInstanceOf(BranchAgentDatabaseMediaMigrationRequiredError);
  } finally {
    writer.close();
  }
});

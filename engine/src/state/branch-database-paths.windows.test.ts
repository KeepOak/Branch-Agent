// Windows database path tests exercise canonical state lifecycles beyond MAX_PATH.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { noteDoctorAgentDatabasePathHealth } from "../commands/doctor-agent-database-paths.js";
import { compactDoctorSessionSqliteTarget } from "../commands/doctor-session-sqlite-compact.js";
import { runDoctorStateSqliteCompact } from "../commands/doctor-state-sqlite-compact.js";
import {
  readUpdateStateSchemaVersions,
  updateStateSchemaVersionsMatch,
} from "../infra/update-candidate-state.js";
import { createUpdateRun, finishUpdateRun } from "../infra/update-run-ledger.js";
import { withBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly.js";
import {
  closeBranchAgentDatabasesForTest,
  BRANCH_AGENT_SCHEMA_VERSION,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import { resolveBranchAgentSqlitePath } from "./branch-agent-db.paths.js";
import { preflightBranchDatabaseSchemas } from "./branch-database-preflight.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import { withBranchStateDatabaseReadOnly } from "./branch-state-db-readonly.js";
import {
  closeBranchStateDatabaseForTest,
  openExistingBranchStateDatabaseReadOnly,
  openBranchStateDatabase,
  repairBranchStateDatabaseSchema,
} from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

const MAX_PATH = 260;
const AGENT_ID = "windows-long-path";
const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    cleanup();
  });
});

function createDeepStateEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    BRANCH_STATE_DIR: tempDirs.make("branch-database-paths-windows-"),
  };
  while (
    resolveBranchStateSqlitePath(env).length <= MAX_PATH ||
    resolveBranchAgentSqlitePath({ agentId: AGENT_ID, env }).length <= MAX_PATH
  ) {
    env.BRANCH_STATE_DIR = path.join(env.BRANCH_STATE_DIR, `segment-${"x".repeat(24)}`);
  }
  fs.mkdirSync(env.BRANCH_STATE_DIR, { recursive: true });
  return env;
}

describe("Branch Agent database paths on Windows", () => {
  it.runIf(process.platform === "win32")(
    "migrates legacy namespace collisions through startup and Doctor",
    () => {
      for (const repair of [false, true]) {
        const env = { BRANCH_STATE_DIR: tempDirs.make("branch-native-legacy-alias-") };
        const database = openBranchStateDatabase({ env });
        const agentPath = resolveBranchAgentSqlitePath({ agentId: "main", env });
        const insert = database.db.prepare(
          "INSERT INTO agent_databases VALUES ('main', ?, ?, ?, ?)",
        );
        insert.run(agentPath, 18, 100, 10);
        insert.run(path.toNamespacedPath(agentPath), 20, 200, 20);
        database.db.exec(
          "PRAGMA user_version=8; UPDATE schema_meta SET schema_version=8 WHERE meta_key='primary'",
        );
        closeBranchStateDatabaseForTest();
        if (repair) {
          expect(repairBranchStateDatabaseSchema({ env }).warnings).toEqual([]);
        }
        const migrated = openBranchStateDatabase({ env });
        expect(migrated.db.prepare("SELECT * FROM agent_databases").all()).toEqual([
          {
            agent_id: "main",
            path: path.join("agents", "main", "agent", "branch-agent.sqlite"),
            schema_version: 20,
            last_seen_at: 200,
            size_bytes: 20,
          },
        ]);
        closeBranchStateDatabaseForTest();
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "repairs aliases before a native update baseline and preserves active update inventories",
    async () => {
      const env = { BRANCH_STATE_DIR: tempDirs.make("branch-native-doctor-alias-") };
      const agent = openBranchAgentDatabase({ agentId: "main", env });
      const state = openBranchStateDatabase({ env });
      const addAlias = () =>
        state.db
          .prepare("INSERT INTO agent_databases VALUES ('main', ?, ?, ?, ?)")
          .run(path.toNamespacedPath(agent.path), BRANCH_AGENT_SCHEMA_VERSION, Date.now(), 123);
      const inspect = () =>
        readUpdateStateSchemaVersions({ stateDir: env.BRANCH_STATE_DIR, config: {}, env });
      addAlias();
      expect(noteDoctorAgentDatabasePathHealth({ env, shouldRepair: true })).toEqual([]);
      expect(state.db.prepare("SELECT COUNT(*) AS count FROM agent_databases").get()).toEqual({
        count: 1,
      });
      const baseline = await inspect();
      expect(
        updateStateSchemaVersionsMatch(baseline, await inspect(), { sharedPath: state.path }),
      ).toBe(true);

      addAlias();
      const mixedBaseline = await inspect();
      const run = createUpdateRun({ trigger: "cli" }, { env });
      expect(noteDoctorAgentDatabasePathHealth({ env, shouldRepair: true })).toEqual([
        expect.stringContaining(`update ${run.runId} is in progress`),
      ]);
      expect(
        updateStateSchemaVersionsMatch(mixedBaseline, await inspect(), { sharedPath: state.path }),
      ).toBe(true);
      finishUpdateRun(run.runId, { status: "succeeded" }, { env });
      expect(
        noteDoctorAgentDatabasePathHealth({
          env: { ...env, BRANCH_UPDATE_PARENT_SUPPORTS_DOCTOR_CONFIG_WRITE: "1" },
          shouldRepair: true,
        }),
      ).toEqual([expect.stringContaining("during update Doctor")]);
      expect(
        updateStateSchemaVersionsMatch(mixedBaseline, await inspect(), { sharedPath: state.path }),
      ).toBe(true);
    },
  );

  it.runIf(process.platform === "win32")(
    "registers a reopened native filename as the same relative inventory row",
    () => {
      const env = { BRANCH_STATE_DIR: tempDirs.make("branch-native-registration-") };
      const options = { agentId: "main", env };
      const first = openBranchAgentDatabase(options);
      const nativeFilename = first.db.location();
      expect(nativeFilename).toBe(path.toNamespacedPath(first.path));
      if (nativeFilename === null) {
        throw new Error("Expected a file-backed database");
      }
      closeBranchAgentDatabasesForTest();
      openBranchAgentDatabase({ ...options, path: nativeFilename });
      const state = openBranchStateDatabase({ env });
      expect(state.db.prepare("SELECT agent_id, path FROM agent_databases").all()).toEqual([
        { agent_id: "main", path: path.join("agents", "main", "agent", "branch-agent.sqlite") },
      ]);

      const external = path.join(tempDirs.make("branch-native-external-"), "agent.sqlite");
      const externalNative = path.toNamespacedPath(external);
      openBranchAgentDatabase({ agentId: "external", env, path: externalNative });
      expect(
        state.db.prepare("SELECT path FROM agent_databases WHERE agent_id = 'external'").get(),
      ).toEqual({ path: externalNative });
    },
  );

  it.runIf(process.platform === "win32")(
    "opens, preflights, compacts, and reopens canonical databases beyond MAX_PATH",
    async () => {
      const env = createDeepStateEnv();
      const statePath = resolveBranchStateSqlitePath(env);
      const agentPath = resolveBranchAgentSqlitePath({ agentId: AGENT_ID, env });
      expect(statePath.startsWith("\\\\?\\")).toBe(false);
      expect(agentPath.startsWith("\\\\?\\")).toBe(false);
      expect(statePath.length).toBeGreaterThan(MAX_PATH);
      expect(agentPath.length).toBeGreaterThan(MAX_PATH);

      const state = openBranchStateDatabase({ env });
      const agent = openBranchAgentDatabase({ agentId: AGENT_ID, env });
      expect(state.path).toBe(statePath);
      expect(agent.path).toBe(agentPath);
      expect(
        state.db
          .prepare("SELECT role, schema_version FROM schema_meta WHERE meta_key = 'primary'")
          .get(),
      ).toEqual({ role: "global", schema_version: BRANCH_STATE_SCHEMA_VERSION });
      expect(
        agent.db
          .prepare(
            "SELECT role, schema_version, agent_id FROM schema_meta WHERE meta_key = 'primary'",
          )
          .get(),
      ).toEqual({
        role: "agent",
        schema_version: BRANCH_AGENT_SCHEMA_VERSION,
        agent_id: AGENT_ID,
      });
      closeBranchAgentDatabasesForTest();
      closeBranchStateDatabaseForTest();

      expect(
        withBranchStateDatabaseReadOnly(
          ({ db, path: pathname }) => ({
            pathname,
            version: db.prepare("PRAGMA user_version;").get(),
          }),
          { env },
        ),
      ).toEqual({
        pathname: statePath,
        version: { user_version: BRANCH_STATE_SCHEMA_VERSION },
      });
      expect(
        withBranchAgentDatabaseReadOnly(
          ({ db, path: pathname }) => ({
            pathname,
            version: db.prepare("PRAGMA user_version;").get(),
          }),
          { agentId: AGENT_ID, env },
        ),
      ).toEqual({
        found: true,
        value: {
          pathname: agentPath,
          version: { user_version: BRANCH_AGENT_SCHEMA_VERSION },
        },
      });
      expect(
        await preflightBranchDatabaseSchemas({
          env,
          supportedVersions: {
            state: BRANCH_STATE_SCHEMA_VERSION,
            agent: BRANCH_AGENT_SCHEMA_VERSION,
          },
        }),
      ).toEqual({ incompatible: [], indeterminate: [] });
      fs.rmSync(`${statePath}-wal`, { force: true });
      fs.rmSync(`${statePath}-shm`, { force: true });
      const stateBytesBeforeReadOnly = fs.readFileSync(statePath);
      const stateEntriesBeforeReadOnly = fs
        .readdirSync(path.dirname(statePath), { withFileTypes: true })
        .map((entry) => entry.name)
        .toSorted();
      const readOnlyState = await openExistingBranchStateDatabaseReadOnly({ env });
      expect(readOnlyState?.path).toBe(statePath);
      expect(
        readOnlyState?.db
          .prepare("SELECT role, schema_version FROM schema_meta WHERE meta_key = 'primary'")
          .get(),
      ).toEqual({ role: "global", schema_version: BRANCH_STATE_SCHEMA_VERSION });
      const openedStatePath = readOnlyState?.db.prepare("PRAGMA database_list").get() as
        | { file?: unknown }
        | undefined;
      expect(path.resolve(String(openedStatePath?.file))).not.toBe(path.resolve(statePath));
      const privateDirectory = path.dirname(String(openedStatePath?.file));
      expect(readOnlyState?.walMaintenance.close()).toBe(true);
      expect(fs.existsSync(privateDirectory)).toBe(false);
      assert.deepStrictEqual(fs.readFileSync(statePath), stateBytesBeforeReadOnly);
      expect(
        fs
          .readdirSync(path.dirname(statePath), { withFileTypes: true })
          .map((entry) => entry.name)
          .toSorted(),
      ).toEqual(stateEntriesBeforeReadOnly);

      await expect(runDoctorStateSqliteCompact({ env })).resolves.toMatchObject({
        integrityCheck: "ok",
        path: statePath,
        skipped: false,
      });
      expect(
        await compactDoctorSessionSqliteTarget(
          {
            agentId: AGENT_ID,
            storePath: path.join(
              env.BRANCH_STATE_DIR ?? "",
              "agents",
              AGENT_ID,
              "sessions",
              "sessions.json",
            ),
          },
          { env },
        ),
      ).toMatchObject({
        freelistAfterPages: 0,
        skipped: false,
        walSizeAfterBytes: 0,
      });

      expect(openBranchStateDatabase({ env }).path).toBe(statePath);
      expect(openBranchAgentDatabase({ agentId: AGENT_ID, env }).path).toBe(agentPath);
    },
  );
});

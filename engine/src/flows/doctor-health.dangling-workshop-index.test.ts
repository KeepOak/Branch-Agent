import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doctorCommand } from "../commands/doctor.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { readSqliteNumberPragma } from "../infra/sqlite-pragma.test-support.js";
import { seedNativeVersionZeroState } from "../state/native-version-zero.test-support.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "../state/branch-agent-db-contract.js";
import { registerBranchAgentDatabase } from "../state/branch-agent-db-registry.js";
import { resolveBranchAgentSqlitePath } from "../state/branch-agent-db.paths.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db-cache.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "../state/branch-state-db-contract.js";
import { openBranchStateDatabase } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { claimBranchStateOwnership } from "../state/branch-state-ownership-operations.js";
import {
  withBranchTestState,
  type BranchTestState,
} from "../test-utils/branch-test-state.js";
import { mocks } from "./doctor-health.test-support.js";

// Keep the real Doctor config/migration chain; the shared harness isolates service and UI checks.
vi.doUnmock("../commands/doctor-config-flow.js");
vi.doUnmock("../commands/doctor-prompter.js");
vi.doUnmock("../commands/doctor/shared/plugin-runtime-symlinks.js");

beforeEach(() => {
  mocks.packageRoot.mockReturnValue(undefined);
  mocks.outro.mockClear();
  mocks.runContributions.mockReset();
});
afterEach(() => vi.restoreAllMocks());

async function seedState(state: BranchTestState) {
  await state.writeConfig({
    agents: { ownership: "explicit", entries: { main: { workspace: state.workspaceDir } } },
    gateway: { mode: "local" },
    plugins: { enabled: false },
  });
  const database = openBranchStateDatabase({ env: state.env });
  database.db.exec(`
    INSERT INTO skill_workshop_collection_reviews (
      review_id, owner_agent_id, backup_id, create_time, kept_names_json, written_names_json, dropped_json
    ) VALUES ('review-preserved', 'main', 'backup-preserved', 1, '[]', '[]', '[]');
  `);
  return database;
}

function damageWorkshopIndex(databasePath: string): void {
  const { DatabaseSync } = requireNodeSqlite();
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(
      "CREATE INDEX idx_skill_workshop_collection_reviews_workspace_time ON skill_workshop_collection_reviews(review_id, create_time DESC);",
    );
    database.enableDefensive?.(false);
    database.exec("PRAGMA writable_schema = ON;");
    database
      .prepare(
        `UPDATE sqlite_schema
            SET sql = 'CREATE INDEX idx_skill_workshop_collection_reviews_workspace_time
                         ON skill_workshop_collection_reviews(workspace_dir, create_time DESC, review_id DESC)'
          WHERE type = 'index' AND name = 'idx_skill_workshop_collection_reviews_workspace_time'`,
      )
      .run();
    const schemaVersion = readSqliteNumberPragma(database, "schema_version");
    database.exec(`PRAGMA writable_schema = OFF; PRAGMA schema_version = ${schemaVersion + 1};`);
  } finally {
    database.close();
  }
}

describe("Doctor state readability recovery", () => {
  it("adopts native version-zero state without requiring orphan-recovery metadata", async () => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      await state.writeConfig({
        agents: { ownership: "explicit", entries: { main: { workspace: state.workspaceDir } } },
        gateway: { mode: "local" },
        plugins: { enabled: false },
      });
      const databasePath = resolveBranchStateSqlitePath(state.env);
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      const { DatabaseSync } = requireNodeSqlite();
      const native = new DatabaseSync(databasePath);
      try {
        seedNativeVersionZeroState(native, true);
      } finally {
        native.close();
      }
      const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

      await doctorCommand(runtime, { repair: true, nonInteractive: true });

      expect(runtime.exit).not.toHaveBeenCalled();
      expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
      const repaired = new DatabaseSync(databasePath, { readOnly: true });
      try {
        expect(readSqliteNumberPragma(repaired, "user_version")).toBe(
          BRANCH_STATE_SCHEMA_VERSION,
        );
        expect(
          repaired
            .prepare("SELECT role, schema_version FROM schema_meta WHERE meta_key = 'primary'")
            .get(),
        ).toEqual({ role: "global", schema_version: BRANCH_STATE_SCHEMA_VERSION });
        expect(repaired.prepare("SELECT * FROM device_identities").all()).toEqual([
          {
            identity_key: "node",
            device_id: "native-device",
            public_key_pem: "public",
            private_key_pem: "private",
            created_at_ms: 1,
            updated_at_ms: 1,
          },
        ]);
        expect(
          repaired
            .prepare("SELECT raw_json FROM exec_approvals_config WHERE config_key = 'current'")
            .get(),
        ).toEqual({ raw_json: "{}" });
      } finally {
        repaired.close();
      }
      expect(
        fs
          .readdirSync(path.dirname(databasePath))
          .filter((name) => name.startsWith("branch-task-delivery-recovery-")),
      ).toEqual([]);
    });
  });

  it("preserves known damaged state before backing up and migrating an older agent", async () => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const database = await seedState(state);
      const { DatabaseSync } = requireNodeSqlite();
      const agentPath = resolveBranchAgentSqlitePath({ agentId: "main", env: state.env });
      fs.mkdirSync(path.dirname(agentPath), { recursive: true });
      const agent = new DatabaseSync(agentPath);
      try {
        agent.exec(
          fs.readFileSync(
            new URL("../../test/fixtures/sqlite/branch-agent-schema-v19.sql", import.meta.url),
            "utf8",
          ),
        );
        agent.exec(`
          PRAGMA user_version = 19;
          INSERT INTO schema_meta
            (meta_key, role, schema_version, agent_id, app_version, created_at, updated_at)
            VALUES ('primary', 'agent', 19, 'main', '2026.9.4', 1, 1);
          INSERT INTO cache_entries(scope,key,value_json,expires_at,updated_at)
            VALUES ('upgrade-proof','retained','{"keep":true}',NULL,7);
        `);
      } finally {
        agent.close();
      }
      registerBranchAgentDatabase({
        agentId: "main",
        path: agentPath,
        env: state.env,
        schemaVersion: 19,
      });
      database.db.exec(`
        DROP INDEX idx_task_runs_status;
        PRAGMA foreign_keys = OFF;
        INSERT INTO task_delivery_state (task_id, requester_origin_json)
          VALUES ('orphan-preserved', 'preserve orphan payload');
        PRAGMA foreign_keys = ON;
      `);
      await closeBranchStateDatabaseAsync();
      damageWorkshopIndex(database.path);
      const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

      await doctorCommand(runtime, { repair: true, nonInteractive: true });

      expect(runtime.exit).not.toHaveBeenCalled();
      expect(mocks.outro).toHaveBeenCalledWith("Doctor complete.");
      expect(runtime.log).toHaveBeenCalledWith(
        "Removed dangling legacy Skill Workshop review index",
      );
      const repaired = new DatabaseSync(database.path, { readOnly: true });
      try {
        expect(
          repaired
            .prepare("SELECT review_id, backup_id FROM skill_workshop_collection_reviews")
            .all(),
        ).toEqual([{ review_id: "review-preserved", backup_id: "backup-preserved" }]);
        expect(
          repaired
            .prepare(
              "SELECT name FROM sqlite_schema WHERE name = 'idx_skill_workshop_collection_reviews_workspace_time'",
            )
            .get(),
        ).toBeUndefined();
        expect(
          repaired.prepare("SELECT name FROM pragma_index_info('idx_task_runs_status')").all(),
        ).toEqual([{ name: "status" }]);
        expect(readSqliteNumberPragma(repaired, "user_version")).toBe(
          BRANCH_STATE_SCHEMA_VERSION,
        );
        expect(repaired.prepare("PRAGMA integrity_check").all()).toEqual([
          { integrity_check: "ok" },
        ]);
        expect(repaired.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        const recoveryDirs = fs
          .readdirSync(path.dirname(database.path))
          .filter((name) => name.startsWith("branch-task-delivery-recovery-"));
        expect(recoveryDirs).toHaveLength(1);
        const recovered = fs.readFileSync(
          path.join(path.dirname(database.path), recoveryDirs[0]!, "orphan-rows.jsonl"),
          "utf8",
        );
        expect(JSON.parse(recovered)).toMatchObject({
          task_id: "orphan-preserved",
          requester_origin_json: "preserve orphan payload",
        });
        const preserved = new DatabaseSync(
          path.join(path.dirname(database.path), recoveryDirs[0]!, "database.sqlite"),
          { readOnly: true },
        );
        try {
          expect(
            preserved
              .prepare("SELECT task_id, requester_origin_json FROM task_delivery_state")
              .all(),
          ).toEqual([
            { task_id: "orphan-preserved", requester_origin_json: "preserve orphan payload" },
          ]);
        } finally {
          preserved.close();
        }
      } finally {
        repaired.close();
      }
      for (const sourcePath of [database.path, agentPath]) {
        const backups = fs
          .readdirSync(path.dirname(sourcePath))
          .filter((name) => name.startsWith(`${path.basename(sourcePath)}.pre-startup-migration-`));
        expect(backups).toHaveLength(1);
        const backup = new DatabaseSync(path.join(path.dirname(sourcePath), backups[0]!), {
          readOnly: true,
        });
        try {
          expect(backup.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
          expect(readSqliteNumberPragma(backup, "user_version")).toBe(
            sourcePath === agentPath ? 19 : BRANCH_STATE_SCHEMA_VERSION,
          );
        } finally {
          backup.close();
        }
      }
      const migrated = new DatabaseSync(agentPath, { readOnly: true });
      try {
        expect(readSqliteNumberPragma(migrated, "user_version")).toBe(
          BRANCH_AGENT_SCHEMA_VERSION,
        );
        expect(
          migrated
            .prepare(
              "SELECT value_json, updated_at FROM cache_entries WHERE scope = 'upgrade-proof'",
            )
            .all(),
        ).toEqual([{ value_json: '{"keep":true}', updated_at: 7 }]);
      } finally {
        migrated.close();
      }
    });
  });

  it.each(["shared-schema", "custom-agent-schema", "external-owner"] as const)(
    "refuses %s before changing the malformed source",
    async (reason) => {
      await withBranchTestState({ scenario: "minimal" }, async (state) => {
        const database = await seedState(state);
        if (reason === "shared-schema") {
          database.db.exec(`PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION + 1};`);
        } else if (reason === "custom-agent-schema") {
          const customPath = state.path("custom", "sessions.sqlite");
          fs.mkdirSync(path.dirname(customPath));
          const { DatabaseSync } = requireNodeSqlite();
          const custom = new DatabaseSync(customPath);
          custom.exec(`
            PRAGMA user_version = ${BRANCH_AGENT_SCHEMA_VERSION + 1};
            CREATE TABLE schema_meta (meta_key TEXT PRIMARY KEY, agent_id TEXT);
            INSERT INTO schema_meta VALUES ('primary', 'main');
          `);
          custom.close();
          await state.writeConfig({
            agents: { ownership: "explicit", entries: { main: { workspace: state.workspaceDir } } },
            session: { store: customPath },
            gateway: { mode: "local" },
            plugins: { enabled: false },
          });
        } else {
          claimBranchStateOwnership("fixture-manager", {
            env: { ...state.env, BRANCH_SUPERVISOR_MODE: "external" },
          });
        }
        await closeBranchStateDatabaseAsync();
        damageWorkshopIndex(database.path);
        const before = fs.readFileSync(database.path);
        const configBefore = fs.readFileSync(state.configPath);

        await expect(
          doctorCommand(
            { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
            { repair: true, nonInteractive: true },
          ),
        ).rejects.toThrow(reason === "external-owner" ? /externally supervised/ : /newer/);

        expect(fs.readFileSync(database.path)).toEqual(before);
        expect(fs.readFileSync(state.configPath)).toEqual(configBefore);
        expect(mocks.runContributions).not.toHaveBeenCalled();
        expect(mocks.outro).not.toHaveBeenCalledWith("Doctor complete.");
      });
    },
  );
});

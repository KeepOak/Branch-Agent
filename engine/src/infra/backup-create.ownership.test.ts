import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { backupRestoreCommand } from "../commands/backup-restore.js";
import { buildBackupArchivePath } from "../commands/backup-shared.js";
import { backupCreateCommand } from "../commands/backup.js";
import { createTestRuntime } from "../commands/test-runtime-config-helpers.js";
import {
  createColdPluginConfig,
  createColdPluginFixture,
} from "../plugins/test-helpers/cold-plugin-fixtures.js";
import { inspectBranchRegisteredAgentDatabases } from "../state/branch-agent-db-registry-listing.js";
import {
  registerBranchAgentDatabase,
  unregisterBranchAgentDatabase,
} from "../state/branch-agent-db-registry.js";
import {
  closeBranchAgentDatabasesForTest,
  BRANCH_AGENT_SCHEMA_VERSION,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import {
  closeBranchStateDatabase,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import {
  resolveBranchStateSqlitePath,
  resolveQuarantineStorePath,
} from "../state/branch-state-db.paths.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { requireNodeSqlite } from "./node-sqlite.js";
import * as sqliteSnapshot from "./sqlite-snapshot.js";

function inspectDatabase(databasePath: string, inspect: (database: DatabaseSync) => void) {
  const database = new (requireNodeSqlite().DatabaseSync)(databasePath, { readOnly: true });
  try {
    inspect(database);
  } finally {
    database.close();
  }
}

type RegisteredAlias = "dot" | "symlink" | "namespace";
const registeredAliases: { includeWorkspace: boolean; alias: RegisteredAlias }[] = [
  { includeWorkspace: false, alias: "dot" },
  { includeWorkspace: true, alias: "symlink" },
];
if (process.platform === "win32") {
  registeredAliases.push({ includeWorkspace: true, alias: "namespace" });
}

describe("backup SQLite ownership", () => {
  it.each(registeredAliases)(
    "backs up registered state inside its workspace ($alias, includeWorkspace=$includeWorkspace)",
    async ({ includeWorkspace, alias }) => {
      await withBranchTestState(
        {
          layout: "home",
          prefix: alias === "namespace" ? "backup-namespace-alias-" : "backup-enclosing-workspace-",
          scenario: "minimal",
        },
        async (state) => {
          await state.writeConfig({ agents: { defaults: { workspace: state.home } } });
          const agentPath = path.join(state.agentDir(), "branch-agent.sqlite");
          openBranchAgentDatabase({ agentId: "main", path: agentPath, env: state.env });
          closeBranchAgentDatabasesForTest();
          const aliasPath =
            alias === "dot"
              ? `${state.agentDir()}${path.sep}.${path.sep}branch-agent.sqlite`
              : alias === "namespace"
                ? path.toNamespacedPath(agentPath)
                : path.join(state.agentDir(), "z-alias.sqlite");
          if (alias === "symlink") {
            await fs.symlink(agentPath, aliasPath);
          }
          if (alias === "namespace") {
            const stateDb = openBranchStateDatabase({ env: state.env });
            stateDb.db
              .prepare("INSERT INTO agent_databases VALUES ('main', ?, ?, ?, ?)")
              .run(aliasPath, BRANCH_AGENT_SCHEMA_VERSION, Date.now(), 1);
          } else {
            registerBranchAgentDatabase({ agentId: "main", path: aliasPath, env: state.env });
          }
          closeBranchStateDatabase();
          const onSqliteSnapshots = vi.fn();
          const runtime = createTestRuntime();
          const archive = await backupCreateCommand(runtime, {
            output: state.path("backup.tar.gz"),
            verify: true,
            ...(alias === "namespace" ? {} : { includeWorkspace, onSqliteSnapshots }),
          });
          expect(archive.verified).toBe(true);
          if (alias !== "namespace") {
            expect(onSqliteSnapshots).toHaveBeenCalledExactlyOnceWith([
              expect.objectContaining({
                role: "global",
                sourcePath: resolveBranchStateSqlitePath(state.env),
              }),
              expect.objectContaining({ role: "agent", agentId: "main", sourcePath: agentPath }),
            ]);
          }
          const restoredRoot = state.path("restored");
          await expect(
            backupRestoreCommand(runtime, {
              archive: archive.archivePath,
              target: restoredRoot,
            }),
          ).resolves.toMatchObject({ ok: true });
          if (alias === "namespace") {
            const restoredAgents: string[] = [];
            const visit = async (directory: string) => {
              for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                const child = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                  await visit(child);
                } else if (entry.name === "branch-agent.sqlite") {
                  restoredAgents.push(child);
                }
              }
            };
            await visit(restoredRoot);
            expect(
              restoredAgents.map((restoredAgent) => restoredAgent.replaceAll("\\", "/")),
            ).toEqual([
              expect.stringContaining(
                `/${buildBackupArchivePath(archive.archiveRoot, agentPath).replaceAll("\\", "/")}`,
              ),
            ]);
            const header = await fs.readFile(restoredAgents[0] ?? "");
            expect(header.subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");
          } else {
            const restoredAgent = path.join(
              restoredRoot,
              buildBackupArchivePath(archive.archiveRoot, aliasPath),
            );
            inspectDatabase(restoredAgent, (database) => {
              expect(
                database
                  .prepare("SELECT agent_id FROM schema_meta WHERE meta_key = 'primary'")
                  .get(),
              ).toEqual({ agent_id: "main" });
            });
          }
        },
      );
    },
  );

  it.each(["same path", "agent hardlink", "global hardlink"])(
    "refuses different registered owners sharing a database (%s)",
    async (alias) => {
      await withBranchTestState(
        { layout: "home", prefix: "backup-conflicting-owners-", scenario: "minimal" },
        async (state) => {
          await state.writeConfig({ agents: { defaults: { workspace: state.home } } });
          const agentPath = path.join(state.agentDir(), "branch-agent.sqlite");
          if (alias === "global hardlink") {
            registerBranchAgentDatabase({ agentId: "main", path: agentPath, env: state.env });
            closeBranchStateDatabase();
            await fs.mkdir(state.agentDir(), { recursive: true });
            await fs.link(resolveBranchStateSqlitePath(state.env), agentPath);
          } else {
            openBranchAgentDatabase({ agentId: "main", path: agentPath, env: state.env });
            closeBranchAgentDatabasesForTest();
            const workerPath =
              alias === "same path"
                ? agentPath
                : path.join(state.agentDir("worker"), "branch-agent.sqlite");
            if (alias === "agent hardlink") {
              await fs.mkdir(path.dirname(workerPath), { recursive: true });
              await fs.link(agentPath, workerPath);
            }
            registerBranchAgentDatabase({ agentId: "worker", path: workerPath, env: state.env });
            closeBranchStateDatabase();
          }
          const output = state.path("rejected.tar.gz");
          await expect(
            backupCreateCommand(createTestRuntime(), { output, verify: true }),
          ).rejects.toThrow(/SQLite path aliases multiple core database owners/iu);
          await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
        },
      );
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses a declared plugin database hidden behind a symlink",
    async () => {
      await withBranchTestState(
        { layout: "state-only", prefix: "backup-plugin-symlink-", scenario: "minimal" },
        async (state) => {
          const pluginRoot = state.path("backup-plugin");
          await fs.mkdir(pluginRoot);
          const fixture = createColdPluginFixture({
            rootDir: pluginRoot,
            pluginId: "backup-owner",
            manifest: {
              backupResources: [
                { disposition: "include", scope: "state", relativePath: "plugins/linked.sqlite" },
              ],
            },
          });
          await state.writeConfig(createColdPluginConfig(pluginRoot, fixture.pluginId));
          const linkedPath = state.statePath("plugins", "linked.sqlite");
          const backingPath = state.statePath("plugins", "database.bin");
          await fs.mkdir(path.dirname(backingPath));
          const sqlite = requireNodeSqlite();
          const database = new sqlite.DatabaseSync(backingPath);
          try {
            database.function(
              "plugin_double",
              { deterministic: true },
              (value) => Number(value) * 2,
            );
            database.exec(`
            CREATE TABLE records (value INTEGER NOT NULL);
            INSERT INTO records VALUES (7);
            CREATE INDEX records_double ON records(plugin_double(value));
          `);
          } finally {
            database.close();
          }
          await fs.symlink("database.bin", linkedPath);
          const sourceBytes = await fs.readFile(backingPath);
          const output = state.path("rejected.tar.gz");

          await expect(
            backupCreateCommand(createTestRuntime(), { output, includeWorkspace: false }),
          ).rejects.toThrow(/SQLite backup source identity changed.*linked\.sqlite/iu);
          await expect(fs.stat(output)).rejects.toMatchObject({ code: "ENOENT" });
          expect(await fs.readFile(backingPath)).toEqual(sourceBytes);
        },
      );
    },
  );

  it("restores an agent registered immediately before the root snapshot with its registry row", async () => {
    await withBranchTestState(
      { layout: "state-only", prefix: "backup-late-agent-owner-", scenario: "minimal" },
      async (state) => {
        // This registry snapshot fixture must not inspect another backup's scratch.
        const scratchRoot = state.path("scratch");
        await fs.mkdir(scratchRoot);
        Object.assign(state.envVars, { TMPDIR: scratchRoot, TMP: scratchRoot, TEMP: scratchRoot });
        state.applyEnv();
        const agentPath = state.path("external-agent", "branch-agent.sqlite");
        const registration = { agentId: "main", path: agentPath, env: state.env };
        const agent = openBranchAgentDatabase(registration);
        agent.db.exec(`
          CREATE TABLE durable_records (value TEXT NOT NULL);
          INSERT INTO durable_records VALUES ('registered-before-root-capture');
        `);
        closeBranchAgentDatabasesForTest();
        unregisterBranchAgentDatabase(registration);
        closeBranchStateDatabase();
        expect(await inspectBranchRegisteredAgentDatabases({ env: state.env })).toEqual([]);
        const globalPath = resolveBranchStateSqlitePath(state.env);
        const output = state.path("registered-agent.tar.gz");
        const capture = sqliteSnapshot.createVerifiedSqliteSnapshot;
        let registered = false;
        const snapshot = vi
          .spyOn(sqliteSnapshot, "createVerifiedSqliteSnapshot")
          .mockImplementation(async (options) => {
            if (!registered && options.sourcePath === globalPath) {
              registerBranchAgentDatabase(registration);
              closeBranchStateDatabase();
              registered = true;
            }
            return await capture(options);
          });
        try {
          const runtime = createTestRuntime();
          const onSqliteSnapshots = vi.fn();
          const archive = await backupCreateCommand(runtime, {
            output,
            includeWorkspace: false,
            verify: true,
            onSqliteSnapshots,
          });
          expect(onSqliteSnapshots).toHaveBeenCalledExactlyOnceWith([
            expect.objectContaining({ role: "global", sourcePath: globalPath }),
            expect.objectContaining({ role: "agent", agentId: "main", sourcePath: agentPath }),
          ]);
          expect(registered).toBe(true);
          expect(archive.verified).toBe(true);
          expect(archive.warnings ?? []).toEqual([]);
          const restored = await backupRestoreCommand(runtime, {
            archive: archive.archivePath,
            target: state.path("restored"),
          });
          inspectDatabase(
            path.join(restored.targetPath, buildBackupArchivePath(archive.archiveRoot, globalPath)),
            (database) => {
              expect(database.prepare("SELECT agent_id, path FROM agent_databases").all()).toEqual([
                { agent_id: "main", path: agentPath },
              ]);
            },
          );
          inspectDatabase(
            path.join(restored.targetPath, buildBackupArchivePath(archive.archiveRoot, agentPath)),
            (database) => {
              expect(
                database
                  .prepare("SELECT role, agent_id FROM schema_meta WHERE meta_key = 'primary'")
                  .get(),
              ).toEqual({ role: "agent", agent_id: "main" });
              expect(database.prepare("SELECT value FROM durable_records").all()).toEqual([
                { value: "registered-before-root-capture" },
              ]);
            },
          );
          const canonicalAgentPath = await fs.realpath(agentPath);
          inspectDatabase(
            path.join(
              restored.targetPath,
              buildBackupArchivePath(archive.archiveRoot, resolveQuarantineStorePath(state.env)),
            ),
            (database) => {
              expect(
                database.prepare("SELECT path FROM agent_integrity_verifications").all(),
              ).toEqual([{ path: canonicalAgentPath }]);
            },
          );
        } finally {
          snapshot.mockRestore();
        }
      },
    );
  });
});

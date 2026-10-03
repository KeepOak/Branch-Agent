import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../test/helpers/temp-dir.js";
import { resolveConfiguredAgentDatabaseTargets } from "../config/sessions/targets.js";
import {
  beginAgentDeletionJournal,
  completeAgentDeletionJournalInDatabase,
} from "../state/agent-deletion-journal.js";
import {
  registerBranchAgentDatabase,
  unregisterBranchAgentDatabase,
} from "../state/branch-agent-db-registry.js";
import {
  closeBranchAgentDatabasesForTest,
  listBranchRegisteredAgentDatabases,
  BRANCH_AGENT_SCHEMA_VERSION,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { assertBranchDatabasesReady } from "../state/branch-database-preflight.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../state/branch-state-db.js";
import { requireNodeSqlite } from "./node-sqlite.js";
import { migrateLegacyMediaPersistence } from "./state-migrations.media-persistence.js";
import { createLegacyDatabaseFixture } from "./state-migrations.media-persistence.test-support.js";
import { createLegacyStateMigrationStepReceipt } from "./state-migrations.messages.js";
import { migrateHistoricalTranscriptDirectives } from "./state-migrations.transcript-directives.js";

const tempDirs: string[] = [];
const PREVIOUS_VERSION = 16;
let stateDir: string;
let env: NodeJS.ProcessEnv;
const tempDir = () => fs.realpathSync.native(makeTempDir(tempDirs, "media-targets-"));
const registrations = (includeIncompatibleSchemaVersions = false) =>
  listBranchRegisteredAgentDatabases({ env, includeIncompatibleSchemaVersions });
const ready = (configuredAgentDatabaseTargets: { agentId: string; path: string }[] = []) =>
  assertBranchDatabasesReady({ env, operation: "doctor", configuredAgentDatabaseTargets });
const register = (agentId: string, pathname: string, schemaVersion = PREVIOUS_VERSION) =>
  registerBranchAgentDatabase({ agentId, path: pathname, env, schemaVersion });

function createLegacyAgentDatabase(params: { agentId?: string; path?: string } = {}): string {
  return createLegacyDatabaseFixture({
    ...params,
    env,
    eventsBySession: {},
    schemaVersion: PREVIOUS_VERSION,
  });
}

function readUserVersion(databasePath: string): number {
  const { DatabaseSync } = requireNodeSqlite();
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    database.close();
  }
}

function expectMigrated(databasePath: string, agentId: string) {
  expect(readUserVersion(databasePath)).toBe(BRANCH_AGENT_SCHEMA_VERSION);
  expect(registrations(true)).toEqual([
    expect.objectContaining({
      agentId,
      path: databasePath,
      schemaVersion: BRANCH_AGENT_SCHEMA_VERSION,
    }),
  ]);
}

beforeEach(() => {
  stateDir = tempDir();
  env = { BRANCH_STATE_DIR: stateDir };
});
afterEach(() => {
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  cleanupTempDirs(tempDirs);
});

it("migrates a surviving physical owner beside a retained hardlink owner", async () => {
  const deletedId = "aaa-deleted";
  const databasePath = createLegacyAgentDatabase();
  const retainedPath = path.join(stateDir, "retained.sqlite");
  fs.linkSync(databasePath, retainedPath);
  register(deletedId, retainedPath);
  beginAgentDeletionJournal(
    {
      agentId: deletedId,
      operationId: "delete-shared-owner",
      agentDir: path.dirname(retainedPath),
      workspaceDir: path.join(stateDir, "workspace"),
      sessionsDir: path.join(stateDir, "agents", deletedId, "sessions"),
      deleteFiles: false,
    },
    { env },
  );
  runBranchStateWriteTransaction(
    (database) => {
      completeAgentDeletionJournalInDatabase(database, deletedId, "delete-shared-owner");
    },
    { env },
  );
  await expect(ready()).rejects.toThrow(/uses schema version 16/);
  const result = await migrateLegacyMediaPersistence({ env });
  expect(result.warnings).toEqual([]);
  expect(result.notices ?? []).toEqual([]);
  expect(readUserVersion(databasePath)).toBe(BRANCH_AGENT_SCHEMA_VERSION);
  await expect(ready()).resolves.toBeUndefined();
});

it("migrates an unregistered configured agentDir outside the default tree", async () => {
  const agentDir = path.join(stateDir, ".branch", "agents", "worker", "agent");
  const databasePath = createLegacyAgentDatabase({
    agentId: "worker",
    path: path.join(agentDir, "branch-agent.sqlite"),
  });
  unregisterBranchAgentDatabase({ agentId: "worker", env, path: databasePath });
  const result = await migrateLegacyMediaPersistence({
    configuredAgentDatabaseTargets: resolveConfiguredAgentDatabaseTargets(
      { agents: { ownership: "explicit", entries: { worker: { agentDir } } } },
      { env },
    ),
    env,
  });
  expect(result.warnings).toEqual([]);
  expectMigrated(databasePath, "worker");
});

it("refreshes a retained registration after its schema upgrade already committed", async () => {
  const agentId = "retired";
  const databasePath = path.join(stateDir, "retained", "branch-agent.sqlite");
  openBranchAgentDatabase({ agentId, env, path: databasePath });
  closeBranchAgentDatabasesForTest();
  register(agentId, databasePath, BRANCH_AGENT_SCHEMA_VERSION - 1);
  expect(registrations()).toEqual([]);
  expect(await migrateLegacyMediaPersistence({ env })).toEqual({ changes: [], warnings: [] });
  expectMigrated(databasePath, agentId);
});

it("preserves filesystem traversal for registered paths containing dot-dot segments", async () => {
  const symlinkTarget = path.join(stateDir, "external", "subdir");
  fs.mkdirSync(symlinkTarget, { recursive: true });
  fs.symlinkSync(symlinkTarget, path.join(stateDir, "link"), "dir");
  const filesystemPath = path.join(stateDir, "external", "x", "branch-agent.sqlite");
  const lexicalPath = path.join(stateDir, "x", "branch-agent.sqlite");
  for (const databasePath of [filesystemPath, lexicalPath]) {
    createLegacyAgentDatabase({ path: databasePath });
    unregisterBranchAgentDatabase({ agentId: "main", env, path: databasePath });
  }
  const registeredPath = `${path.join(stateDir, "link")}${path.sep}..${path.sep}x${path.sep}branch-agent.sqlite`;
  expect(fs.realpathSync.native(registeredPath)).toBe(filesystemPath);
  expect(path.resolve(registeredPath)).toBe(lexicalPath);
  register("main", registeredPath);
  await expect(ready()).rejects.toThrow(/uses schema version 16/);
  expect((await migrateLegacyMediaPersistence({ env })).warnings).toEqual([]);
  expect(readUserVersion(filesystemPath)).toBe(BRANCH_AGENT_SCHEMA_VERSION);
  expect(readUserVersion(lexicalPath)).toBe(PREVIOUS_VERSION);
  await expect(ready()).resolves.toBeUndefined();
});

it.each(
  [
    {
      owner: "media-persistence",
      migrate: migrateLegacyMediaPersistence,
      failures: ["discovery"],
    },
    {
      owner: "transcript-directives",
      migrate: migrateHistoricalTranscriptDirectives,
      failures: ["none", "database"],
    },
  ].flatMap(({ owner, migrate, failures }) =>
    failures.map((failure) => ({ owner, migrate, failure })),
  ),
)(
  "unregisters foreign registry paths without touching their databases ($owner, failure=$failure)",
  async ({ owner, migrate, failure }) => {
    const foreignStateDir = tempDir();
    const foreignPath = (directory: string) =>
      path.join(foreignStateDir, directory, "main", "agent", "branch-agent.sqlite");
    const databasePath = foreignPath(`agents\n${String.fromCharCode(0x1b)}[31mforged`);
    const sanitizedDatabasePath = foreignPath("agentsforged");
    createLegacyAgentDatabase({ path: databasePath });
    const beforeBytes = fs.readFileSync(databasePath);
    const beforeMtimeMs = fs.statSync(databasePath).mtimeMs;
    const ownedDatabasePath = path.join(
      stateDir,
      failure === "discovery" ? "agents" : "broken.sqlite",
    );
    if (failure !== "none") {
      fs.writeFileSync(ownedDatabasePath, "not a SQLite database");
    }
    const result = await migrate({
      env,
      configuredAgentDatabaseTargets:
        failure === "database" ? [{ agentId: "broken", path: ownedDatabasePath }] : [],
    });
    expect(result.warnings).toContain(
      `Skipped foreign agent database ${sanitizedDatabasePath}; it is outside the active state directory and is not a configured session store.`,
    );
    expect(result.warnings.join("\n")).not.toContain(databasePath);
    expect(registrations(true)).toEqual([]);
    expect(fs.readFileSync(databasePath).equals(beforeBytes)).toBe(true);
    expect(fs.statSync(databasePath).mtimeMs).toBe(beforeMtimeMs);
    const receipt = createLegacyStateMigrationStepReceipt(
      {
        id: owner,
        phase: "shared",
        source: [],
        target: [],
        requiredness: "conditional",
        reversibility: "checkpoint-required",
      },
      result,
    );
    expect(receipt.outcome).toBe(failure !== "none" ? "refused" : "warning");
    expect(receipt.refusal?.code).toBe(failure !== "none" ? "step-refused" : undefined);
    if (failure !== "none") {
      expect(result.warnings).toContainEqual(expect.stringContaining(ownedDatabasePath));
      expect(fs.readFileSync(ownedDatabasePath, "utf8")).toBe("not a SQLite database");
    }
  },
);

it("prefers the configured owner over a stale registry owner for the same path", async () => {
  const databasePath = path.join(tempDir(), "branch-agent.sqlite");
  createLegacyAgentDatabase({ agentId: "new", path: databasePath });
  unregisterBranchAgentDatabase({ agentId: "new", env, path: databasePath });
  register("old", databasePath);
  const configuredAgentDatabaseTargets = [{ agentId: "new", path: databasePath }];
  await expect(ready(configuredAgentDatabaseTargets)).rejects.toThrow(/uses schema version 16/);
  expect(registrations(true)).toEqual([
    expect.objectContaining({ agentId: "old", path: databasePath }),
  ]);
  const result = await migrateLegacyMediaPersistence({ configuredAgentDatabaseTargets, env });
  expect(result.warnings).toContain(
    `Skipped foreign agent database ${databasePath}; it is outside the active state directory and is not a configured session store.`,
  );
  expectMigrated(databasePath, "new");
});

it("prunes missing and archived registry entries before migration", async () => {
  const missingPath = path.join(stateDir, "agents", "missing", "agent", "branch-agent.sqlite");
  const archivedPath = path.join(stateDir, "imports", "archived", "branch-agent.sqlite");
  fs.mkdirSync(path.dirname(archivedPath), { recursive: true });
  fs.writeFileSync(archivedPath, "archived fixture");
  const state = openBranchStateDatabase({ env });
  const insert = state.db.prepare(
    "INSERT INTO agent_databases(agent_id,path,schema_version,last_seen_at,size_bytes) VALUES(?,?,?,?,?)",
  );
  insert.run("missing", missingPath, BRANCH_AGENT_SCHEMA_VERSION, 1, null);
  insert.run("archived", archivedPath, 8, 1, null);
  await expect(ready()).resolves.toBeUndefined();
  expect(state.db.prepare("SELECT agent_id FROM agent_databases ORDER BY agent_id").all()).toEqual([
    { agent_id: "archived" },
    { agent_id: "missing" },
  ]);
  const result = await migrateLegacyMediaPersistence({ env });
  expect(result.changes).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Removed missing agent database registry entry"),
      expect.stringContaining("Removed archived or transient agent database registry entry"),
    ]),
  );
  expect(result.warnings).toContain(`Skipped missing registered agent database ${missingPath}.`);
  expect(registrations(true)).toEqual([]);
});

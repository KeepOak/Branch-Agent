import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { prepareAgentDeleteDatabases } from "../agents/agent-delete-databases.js";
import { SQLITE_IDLE_HANDLE_TTL_MS } from "../infra/sqlite-handle-lifecycle.js";
import { beginAgentDeletionJournal } from "./agent-deletion-journal.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "./branch-agent-db-contract.js";
import { withBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly.js";
import {
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabasesForTest,
  getBranchAgentDatabaseIfOpen,
  isIncognitoBranchAgentSqlitePath,
  listBranchRegisteredAgentDatabases,
  listOpenIncognitoAgentDatabases,
  openBranchAgentDatabase,
  readOpenIncognitoAgentDatabaseGeneration,
  resolveIncognitoBranchAgentSqlitePath,
  runBranchAgentWriteTransaction,
} from "./branch-agent-db.js";
import { branchStateDatabaseCache } from "./branch-state-db-cache.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
  });
});

describe("incognito agent database", () => {
  it.runIf(process.platform === "win32")(
    "matches mixed separators on drive and UNC roots without folding filename case",
    () => {
      for (const stateDir of ["C:\\incognito-state", "\\\\server\\share\\incognito-state"]) {
        const options = { agentId: "worker", env: { BRANCH_STATE_DIR: stateDir } };
        const sentinel = resolveIncognitoBranchAgentSqlitePath(options);
        expect(isIncognitoBranchAgentSqlitePath(sentinel.replaceAll("\\", "/"), options)).toBe(
          true,
        );
        expect(
          isIncognitoBranchAgentSqlitePath(
            path.join(path.dirname(sentinel), path.basename(sentinel).toUpperCase()),
            options,
          ),
        ).toBe(false);
      }
    },
  );

  it("matches only the normalized sentinel for the current owner and state root", () => {
    const env = { BRANCH_STATE_DIR: path.join(os.tmpdir(), "incognito-path-root") };
    const options = { agentId: "worker", env };
    const sentinel = resolveIncognitoBranchAgentSqlitePath(options);
    const basename = path.basename(sentinel);
    for (const pathname of [
      sentinel,
      path.relative(process.cwd(), sentinel),
      `${sentinel}${path.sep}`,
      `${sentinel}${path.sep}.`,
      `${sentinel}${path.sep}..${path.sep}${basename}`,
    ]) {
      expect(isIncognitoBranchAgentSqlitePath(pathname, options), pathname).toBe(true);
    }
    for (const pathname of [
      path.join(path.dirname(sentinel), "branch-agent.sqlite"),
      path.join(env.BRANCH_STATE_DIR, basename),
      `${sentinel}-wal`,
      `${sentinel} `,
      path.join(path.dirname(sentinel), basename.toUpperCase()),
    ]) {
      expect(isIncognitoBranchAgentSqlitePath(pathname, options), pathname).toBe(false);
    }
    expect(isIncognitoBranchAgentSqlitePath(sentinel, { ...options, agentId: "other" })).toBe(
      false,
    );
    env.BRANCH_STATE_DIR = path.join(env.BRANCH_STATE_DIR, "changed");
    expect(isIncognitoBranchAgentSqlitePath(sentinel, options)).toBe(false);
    expect(
      isIncognitoBranchAgentSqlitePath(resolveIncognitoBranchAgentSqlitePath(options), options),
    ).toBe(true);
  });

  it("rejects deletion-fenced opens and writes and retires prepared statements", async () => {
    const stateDir = fs.realpathSync(tempDirs.make("incognito-delete-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoBranchAgentSqlitePath({ agentId: "worker", env });
    const options = { agentId: "worker", env, path: sentinel };
    const database = openBranchAgentDatabase(options);
    const writeSql =
      "UPDATE schema_meta SET updated_at = updated_at + 1 WHERE meta_key = 'primary'";
    const retained = database.db.prepare(writeSql);
    beginAgentDeletionJournal(
      {
        agentId: "worker",
        operationId: "delete-worker",
        agentDir: path.dirname(sentinel),
        workspaceDir: path.join(stateDir, "workspace-worker"),
        sessionsDir: path.join(stateDir, "agents", "worker", "sessions"),
        deleteFiles: true,
      },
      { env },
    );

    expect.soft(() => openBranchAgentDatabase(options)).toThrow("is deleted");
    expect
      .soft(() => runBranchAgentWriteTransaction(({ db }) => db.prepare(writeSql).run(), options))
      .toThrow("is deleted");
    const plan = await prepareAgentDeleteDatabases(
      { agents: { entries: { worker: {}, kept: {} } } },
      "worker",
      path.dirname(sentinel),
      { env },
    );
    expect.soft(database.db.isOpen).toBe(false);
    expect.soft(() => retained.run()).toThrow();
    expect(plan.registrationPaths).not.toContain(sentinel);
    expect(plan.fileGroups.flat()).not.toContain(sentinel);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("does not allocate an in-memory database for a read-only miss", () => {
    const stateDir = fs.realpathSync(tempDirs.make("branch-incognito-read-miss-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoBranchAgentSqlitePath({ agentId: "main", env });
    const before = listOpenIncognitoAgentDatabases();

    expect(
      withBranchAgentDatabaseReadOnly(() => "unreachable", {
        agentId: "main",
        env,
        path: sentinel,
      }),
    ).toEqual({ found: false, reason: "database-missing" });
    expect(listOpenIncognitoAgentDatabases()).toEqual(before);
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("refuses a file at the reserved sentinel path before opening in memory", () => {
    const stateDir = fs.realpathSync(tempDirs.make("branch-incognito-collision-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoBranchAgentSqlitePath({ agentId: "main", env });
    fs.mkdirSync(path.dirname(sentinel), { recursive: true });
    fs.writeFileSync(sentinel, "operator data", "utf8");

    let collision: unknown;
    try {
      openBranchAgentDatabase({ agentId: "main", env, path: sentinel });
    } catch (error) {
      collision = error;
    }
    expect(collision).toBeInstanceOf(Error);
    expect(collision).toMatchObject({
      name: "IncognitoAgentDatabasePathCollisionError",
      path: sentinel,
      message: expect.stringContaining("move or rename the file"),
    });

    fs.rmSync(sentinel);
    const database = openBranchAgentDatabase({ agentId: "main", env, path: sentinel });
    expect(database.db.prepare("SELECT count(*) AS count FROM session_nodes").get()).toEqual({
      count: 0,
    });
    expect(fs.existsSync(sentinel)).toBe(false);
  });

  it("boots the canonical schema in one cached memory handle without touching its sentinel path", () => {
    const stateDir = fs.realpathSync(tempDirs.make("branch-incognito-db-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const sentinel = resolveIncognitoBranchAgentSqlitePath({ agentId: "main", env });
    const beforeGeneration = readOpenIncognitoAgentDatabaseGeneration();

    const first = openBranchAgentDatabase({ agentId: "main", env, path: sentinel });
    const openedGeneration = readOpenIncognitoAgentDatabaseGeneration();
    const reopened = openBranchAgentDatabase({ agentId: "main", env, path: sentinel });

    expect(openedGeneration).toBeGreaterThan(beforeGeneration);
    expect(readOpenIncognitoAgentDatabaseGeneration()).toBe(openedGeneration);
    expect(reopened).toBe(first);
    expect(fs.readdirSync(stateDir)).toEqual([]);
    expect(listOpenIncognitoAgentDatabases()).toEqual([{ agentId: "main", storePath: sentinel }]);
    expect(listBranchRegisteredAgentDatabases({ env })).toEqual([]);
    expect(
      withBranchAgentDatabaseReadOnly((database) => database.db === first.db, {
        agentId: "main",
        env,
        path: sentinel,
      }),
    ).toEqual({ found: true, value: true });
    expect(
      first.db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'session_nodes'")
        .get(),
    ).toEqual({ name: "session_nodes" });
    expect(first.db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: BRANCH_AGENT_SCHEMA_VERSION,
    });
    expect(() =>
      withBranchAgentDatabaseReadOnly(
        ({ db }) => db.prepare("SELECT * FROM missing_readonly_table").all(),
        { agentId: "main", env, path: sentinel },
      ),
    ).toThrow(/no such table: missing_readonly_table/);
    expect(first.db.isOpen).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(fs.existsSync(path.dirname(sentinel))).toBe(false);

    expect(closeBranchAgentDatabaseByPath(sentinel)).toBe(true);
    const closedGeneration = readOpenIncognitoAgentDatabaseGeneration();
    expect(closedGeneration).toBeGreaterThan(openedGeneration);
    expect(closeBranchAgentDatabaseByPath(sentinel)).toBe(false);
    expect(readOpenIncognitoAgentDatabaseGeneration()).toBe(closedGeneration);
  });

  it("keeps only its shared authority handle warm when shared state opens after Incognito", () => {
    const env = { BRANCH_STATE_DIR: fs.realpathSync(tempDirs.make("incognito-authority-")) };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const options = {
      agentId: "worker",
      env,
      path: resolveIncognitoBranchAgentSqlitePath({ agentId: "worker", env }),
    };
    const incognito = openBranchAgentDatabase(options);
    expect(fs.readdirSync(env.BRANCH_STATE_DIR)).toEqual([]);
    const shared = openBranchStateDatabase({ env });
    const unrelated = openBranchStateDatabase({
      path: path.join(tempDirs.make("unrelated-authority-"), "state.sqlite"),
    });
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS + 1);
    expect(shared.db.isOpen).toBe(true);
    expect(unrelated.db.isOpen).toBe(false);
    expect(getBranchAgentDatabaseIfOpen(options)).toBe(incognito);

    closeBranchAgentDatabaseByPath(options.path);
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(shared.db.isOpen).toBe(false);
    const later = openBranchStateDatabase({ env });
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(later.db.isOpen).toBe(false);
  });

  it("allows explicit shared-state replacement and releases retention after the last Incognito closes", () => {
    const env = { BRANCH_STATE_DIR: fs.realpathSync(tempDirs.make("incognito-replacement-")) };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const shared = openBranchStateDatabase({ env });
    const openIncognito = (agentId: string) => {
      const options = {
        agentId,
        env,
        path: resolveIncognitoBranchAgentSqlitePath({ agentId, env }),
      };
      return { options, database: openBranchAgentDatabase(options) };
    };
    const first = openIncognito("first");
    const second = openIncognito("second");
    branchStateDatabaseCache.closeBranchStateDatabaseByPath(shared.path);
    expect(shared.db.isOpen).toBe(false);
    const replacement = openBranchStateDatabase({ env });
    closeBranchAgentDatabaseByPath(first.options.path);
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(replacement.db.isOpen).toBe(true);
    expect(getBranchAgentDatabaseIfOpen(second.options)).toBe(second.database);
    closeBranchAgentDatabaseByPath(second.options.path);
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(replacement.db.isOpen).toBe(false);
  });
});

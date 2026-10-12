import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listBranchRegisteredAgentDatabases } from "../src/state/branch-agent-db-registry-listing.js";
import { closeBranchStateDatabaseByPath } from "../src/state/branch-state-db-cache.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "../src/state/branch-state-db-contract.js";
import { openBranchStateDatabase } from "../src/state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../src/state/branch-state-db.paths.js";
import { captureFullEnv, setTestEnvValue, withPathResolutionEnv } from "../src/test-utils/env.js";
import { cleanupTempDirs, makeTempDir } from "./helpers/temp-dir.js";
import { installTestEnv } from "./test-env.js";

const require = createRequire(import.meta.url);
const pathsModule = path.resolve(import.meta.dirname, "../src/state/branch-state-db.paths.ts");
const tempDirs = new Set<string>();
const cleanups: Array<() => void> = [];
let sandbox: string;

function installOwnedEnv() {
  const testEnv = installTestEnv({ mode: "hermetic" });
  const databasePath = resolveBranchStateSqlitePath();
  cleanups.push(() => {
    // Callers close their handles before the environment removes its filesystem tree.
    closeBranchStateDatabaseByPath(databasePath);
    testEnv.cleanup();
  });
  return { ...testEnv, databasePath };
}

beforeEach(() => {
  const snapshot = captureFullEnv();
  cleanups.push(() => snapshot.restore());
  sandbox = makeTempDir(tempDirs, "branch-test-state-lifetime-");
  vi.spyOn(os, "tmpdir").mockReturnValue(sandbox);
  setTestEnvValue("VITEST_WORKER_ID", "7");
});

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  vi.restoreAllMocks();
  cleanupTempDirs(tempDirs);
});

describe("test environment SQLite lifetime", () => {
  it("does not reuse a legacy database in a recycled PID namespace", () => {
    // Reproduce the old namespace only beneath a directory this test created.
    const legacyPath = path.join(
      sandbox,
      "branch-test-state",
      `${process.pid}-7`,
      "state",
      "branch.sqlite",
    );
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`
      PRAGMA user_version = 9;
      CREATE TABLE agent_databases (
        agent_id TEXT NOT NULL, path TEXT NOT NULL, schema_version INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL, size_bytes INTEGER, PRIMARY KEY (agent_id, path)
      );
      CREATE TABLE auth_profile_stores (agent_id TEXT PRIMARY KEY);
    `);
    legacy.close();
    const legacyBytes = fs.readFileSync(legacyPath);
    expect(() => listBranchRegisteredAgentDatabases({ path: legacyPath })).toThrow(
      "has a legacy agent database registry schema",
    );

    const testEnv = installOwnedEnv();
    expect(listBranchRegisteredAgentDatabases()).toEqual([]);
    const database = openBranchStateDatabase();
    expect(database.path).toBe(
      path.join(testEnv.tempHome, ".branch", "state", "branch.sqlite"),
    );
    expect(database.db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: BRANCH_STATE_SCHEMA_VERSION,
    });

    cleanups.pop()?.();
    expect(fs.existsSync(testEnv.tempHome)).toBe(false);
    expect(fs.existsSync(database.path)).toBe(false);
    expect(fs.readFileSync(legacyPath)).toEqual(legacyBytes);
  });

  it("owns distinct nested and subsequent generations and restores the caller's state", () => {
    const callerState = path.join(sandbox, "caller-state");
    fs.mkdirSync(callerState);
    fs.writeFileSync(path.join(callerState, "keep"), "caller-owned");
    setTestEnvValue("BRANCH_STATE_DIR", callerState);
    const callerHome = process.env.HOME;
    const callerTestHome = process.env.BRANCH_TEST_HOME;
    const outer = installOwnedEnv();
    const outerDatabase = openBranchStateDatabase();
    expect(resolveBranchStateSqlitePath()).toBe(outer.databasePath);
    expect(openBranchStateDatabase()).toBe(outerDatabase);

    const inner = installOwnedEnv();
    expect(inner.databasePath).not.toBe(outer.databasePath);
    expect(openBranchStateDatabase().path).toBe(inner.databasePath);
    cleanups.pop()?.();
    expect(fs.existsSync(inner.tempHome)).toBe(false);
    expect(fs.existsSync(inner.databasePath)).toBe(false);
    expect(process.env.HOME).toBe(outer.tempHome);
    expect(process.env.BRANCH_TEST_HOME).toBe(outer.tempHome);
    expect(openBranchStateDatabase()).toBe(outerDatabase);

    cleanups.pop()?.();
    expect(fs.existsSync(outer.databasePath)).toBe(false);
    expect(process.env.HOME).toBe(callerHome);
    expect(process.env.BRANCH_TEST_HOME).toBe(callerTestHome);
    expect(process.env.BRANCH_STATE_DIR).toBe(callerState);
    const next = installOwnedEnv();
    expect(next.databasePath).not.toBe(outer.databasePath);
    expect(next.databasePath).not.toBe(inner.databasePath);
    expect(fs.readFileSync(path.join(callerState, "keep"), "utf8")).toBe("caller-owned");
  });

  it("follows a nested HOME scope without pinning it to the enclosing test home", () => {
    const outer = installOwnedEnv();
    const nestedHome = makeTempDir(tempDirs, "nested-home-", sandbox);
    withPathResolutionEnv(nestedHome, {}, () => {
      expect(resolveBranchStateSqlitePath()).toBe(
        path.join(nestedHome, ".branch", "state", "branch.sqlite"),
      );
    });
    expect(resolveBranchStateSqlitePath()).toBe(outer.databasePath);
  });

  it("shares the owned path across module reloads, inherited workers, and subprocesses", async () => {
    const testEnv = installOwnedEnv();
    const freshPaths = await vi.importActual<
      typeof import("../src/state/branch-state-db.paths.js")
    >("../src/state/branch-state-db.paths.js?lifetime");
    expect(freshPaths.resolveBranchStateSqlitePath()).toBe(testEnv.databasePath);
    const source = `
      import { resolveBranchStateSqlitePath } from ${JSON.stringify(pathToFileURL(pathsModule).href)};
      process.stdout.write(resolveBranchStateSqlitePath());
    `;
    const childPath = execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", source],
      { env: { ...process.env }, encoding: "utf8" },
    );
    expect(childPath).toBe(testEnv.databasePath);

    const worker = new Worker(
      `require(${JSON.stringify(require.resolve("tsx/cjs"))});
       const { parentPort } = require("node:worker_threads");
       const { resolveBranchStateSqlitePath } = require(${JSON.stringify(pathsModule)});
       parentPort.postMessage(resolveBranchStateSqlitePath());`,
      { eval: true, execArgv: [], env: { ...process.env, VITEST_WORKER_ID: "8" } },
    );
    try {
      const workerPath = await new Promise<string>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      expect(workerPath).toBe(testEnv.databasePath);
    } finally {
      await worker.terminate();
    }
  });
});

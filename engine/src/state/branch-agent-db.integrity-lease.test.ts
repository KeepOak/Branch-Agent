import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import type { SqliteIntegrityDiagnostics } from "../infra/sqlite-integrity.js";
import { readDatabasePathIdentitySync } from "../infra/sqlite-worker-identity.js";
import { discoverAgentDatabaseMigrationTargets } from "../infra/state-migrations.media-persistence-targets.js";
import { createLegacyDatabaseFixture } from "../infra/state-migrations.media-persistence.test-support.js";
import {
  claimBranchAgentDatabaseLease,
  releaseBranchAgentDatabaseLease,
  type BranchAgentDatabaseWorkerLeaseReceipt,
} from "./branch-agent-db-lease.js";
import { openBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly.js";
import {
  listBranchRegisteredAgentDatabases,
  unregisterBranchAgentDatabase,
} from "./branch-agent-db-registry.js";
import * as schema from "./branch-agent-db-schema.js";
import {
  clearBranchAgentDatabaseOpenFailure,
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabasesForTest,
  ensureBranchAgentDatabaseSchema,
  openBranchAgentDatabase,
  recordBranchAgentDatabaseOpenFailure,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.js";
import { cleanupRetiredAgentDatabaseLease } from "./branch-agent-execution-cleanup.js";
import {
  clearBranchDatabaseQuarantine,
  readBranchAgentIntegrityVerification,
  readBranchDatabaseQuarantineFailure,
  recordBranchDatabaseQuarantine,
} from "./branch-quarantine-store.js";
import {
  closeBranchStateDatabase,
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";
import {
  resolveBranchStateSqlitePath,
  resolveQuarantineStorePath,
} from "./branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const children = new Set<ChildProcess>();
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    [...children].map(async (child) => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    }),
  );
  children.clear();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

async function openChild(pathname: string, env: NodeJS.ProcessEnv, sharedPath?: string) {
  const script = sharedPath
    ? "./branch-agent-db-schema-contention.test-support.mjs"
    : "./branch-agent-db-held-child.test-support.ts";
  const child = fork(
    fileURLToPath(new URL(script, import.meta.url)),
    sharedPath ? [pathname, sharedPath] : ["integrity-lease", pathname],
    {
      execArgv: sharedPath ? [] : ["--import", "tsx"],
      env: { ...process.env, ...env },
      silent: true,
    },
  );
  children.add(child);
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    const failed = () => reject(new Error(`Agent child exited before opening: ${stderr}`));
    child.once("error", reject);
    child.once("exit", failed);
    child.once("message", (message) => {
      child.off("exit", failed);
      if (message === "ready") {
        resolve();
      } else {
        reject(new Error(`Unexpected agent child message: ${JSON.stringify(message)}`));
      }
    });
  });
  return child;
}

function openOwner() {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-integrity-lease-") };
  const database = openBranchAgentDatabase({ agentId: "integrity-lease", env });
  return {
    env,
    database,
    record: () => readBranchAgentIntegrityVerification(database.path, env),
  };
}

it("independent schema registration lets an agent writer commit shared state before admission", async () => {
  const owner = openOwner();
  const shared = openBranchStateDatabase({ env: owner.env });
  closeBranchAgentDatabaseByPath(owner.database.path);
  using database = openNodeSqliteDatabase(owner.database.path);
  const child = await openChild(owner.database.path, owner.env, shared.path);
  const committed = once(child, "message");
  const exited = once(child, "exit");
  const execute = database.exec.bind(database);
  let signaled = false;
  vi.spyOn(database, "exec").mockImplementation((sql) => {
    if (!signaled && sql.trim() === "BEGIN IMMEDIATE") {
      signaled = true;
      child.send("commit");
    }
    return execute(sql);
  });

  ensureBranchAgentDatabaseSchema(database, {
    agentId: "integrity-lease",
    path: owner.database.path,
    env: owner.env,
    register: true,
  });

  const [outcome] = await committed;
  expect(outcome).toEqual({ status: "committed" });
  expect(await exited).toEqual([0, null]);
  expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(
    database
      .prepare("SELECT state_json FROM auth_profile_state WHERE state_key='schema-lock-order'")
      .get(),
  ).toEqual({ state_json: "{}" });
  expect(
    shared.db
      .prepare("SELECT value_json FROM config_machine_state WHERE state_key='schema-lock-order'")
      .get(),
  ).toEqual({ value_json: "{}" });
});

it.each(process.platform === "win32" ? [false] : [false, true])(
  "publishes clean close only after the last process closes (alias: %s)",
  async (alias) => {
    const owner = openOwner();
    const childPath = alias ? `${owner.database.path}.alias` : owner.database.path;
    if (alias) {
      fs.symlinkSync(owner.database.path, childPath);
      closeBranchAgentDatabaseByPath(owner.database.path);
      openBranchAgentDatabase({ agentId: "integrity-lease", env: owner.env, path: childPath });
      closeBranchAgentDatabaseByPath(childPath);
      openBranchAgentDatabase({
        agentId: "integrity-lease",
        env: owner.env,
        path: owner.database.path,
      });
    }
    const child = await openChild(childPath, owner.env);
    expect(owner.record()?.clean_close).toBe(0);

    closeBranchAgentDatabaseByPath(owner.database.path);
    expect(owner.record()?.clean_close).toBe(0);

    const exited = once(child, "exit");
    child.send("close");
    expect(await exited).toEqual([0, null]);
    expect(readBranchAgentIntegrityVerification(childPath, owner.env)?.clean_close).toBe(1);
  },
);

it.each(["forced cleanup", "stale admission"])(
  "recovers a killed process via %s without certifying a surviving handle",
  async (recovery) => {
    const owner = openOwner();
    const child = await openChild(owner.database.path, owner.env);
    const state = openBranchStateDatabase({ env: owner.env });
    const row = state.db
      .prepare("SELECT * FROM agent_database_leases WHERE owner_pid = ?")
      .get(child.pid!) as {
      lease_id: string;
      agent_id: string;
      path: string;
      owner_pid: number;
      owner_start_time: number | null;
    };
    const receipt: BranchAgentDatabaseWorkerLeaseReceipt = {
      leaseId: row.lease_id,
      agentId: row.agent_id,
      path: row.path,
      ownerPid: row.owner_pid,
      ownerStartTime: row.owner_start_time,
      sharedStatePath: state.path,
      sharedStateIdentity: readDatabasePathIdentitySync(state.path).key,
    };
    const writing = once(child, "message");
    child.send("begin-write");
    expect(await writing).toEqual(["writing", undefined]);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    if (recovery === "forced cleanup") {
      await cleanupRetiredAgentDatabaseLease({
        context: captureBranchStateWorkerContext({ env: owner.env }),
        stopped: exited.then(() => {}),
        assertOwned() {
          expect(child.signalCode).toBe("SIGKILL");
        },
        lease: receipt,
      });
      expect(owner.record()).toBeUndefined();
      closeBranchAgentDatabaseByPath(owner.database.path);
      expect(owner.record()).toBeUndefined();
    } else {
      closeBranchAgentDatabaseByPath(owner.database.path);
      expect(owner.record()?.clean_close).toBe(0);
    }
    const gate = schema.agentDatabaseIntegrityBeforeMutationSteps;
    let diagnostics: SqliteIntegrityDiagnostics | undefined;
    vi.spyOn(schema, "agentDatabaseIntegrityBeforeMutationSteps").mockImplementation(function* (
      ...args
    ) {
      const result = yield* gate(...args);
      diagnostics = args[3];
      return result;
    });
    const reopened = openBranchAgentDatabase({ agentId: "integrity-lease", env: owner.env });
    expect(diagnostics?.integrityGateOutcome).toBe("healthy");
    if (recovery === "stale admission") {
      expect(diagnostics?.integrityGateReason).toBe("stale-lease-full");
    }
    expect(
      reopened.db
        .prepare("SELECT state_key FROM auth_profile_state WHERE state_key='killed-write'")
        .get(),
    ).toBeUndefined();
    expect(owner.record()?.clean_close).toBe(0);
    expect(
      state.db
        .prepare("SELECT lease_id FROM agent_database_leases WHERE owner_pid = ?")
        .all(child.pid!),
    ).toEqual([]);
    closeBranchAgentDatabaseByPath(owner.database.path);
    expect(owner.record()?.clean_close).toBe(1);
  },
);

it("does not certify a failed checkpoint or native close", () => {
  const owner = openOwner();
  vi.spyOn(owner.database.walMaintenance, "close").mockReturnValueOnce(false);
  closeBranchAgentDatabaseByPath(owner.database.path);
  expect(owner.record()).toBeUndefined();

  closeBranchAgentDatabasesForTest();
  const reopened = openBranchAgentDatabase({ agentId: "integrity-lease", env: owner.env });
  const failure = new Error("synthetic native close failed");
  vi.spyOn(reopened.db, "close").mockImplementationOnce(() => {
    throw failure;
  });
  expect(() => closeBranchAgentDatabaseByPath(reopened.path)).toThrow(failure);
  expect(owner.record()).toBeUndefined();
  closeBranchAgentDatabaseByPath(reopened.path);
  expect(owner.record()).toBeUndefined();
});

it.each(["before", "after"] as const)(
  "keeps verification dirty when a same-process read lease is claimed %s writer admission",
  (order) => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("branch-integrity-peer-") };
    const options = { agentId: "integrity-lease", env };
    const pathname = resolveBranchAgentSqlitePath(options);
    if (order === "after") {
      openBranchAgentDatabase(options);
    }
    const lease = claimBranchAgentDatabaseLease({ ...options, path: pathname });
    const database = openBranchAgentDatabase(options);
    const reader = order === "after" ? openBranchAgentDatabaseReadOnly(options) : undefined;
    try {
      if (reader) {
        expect(reader.found).toBe(true);
      }
      expect(readBranchAgentIntegrityVerification(database.path, env)?.clean_close).toBe(0);
      closeBranchAgentDatabaseByPath(database.path);
      expect(readBranchAgentIntegrityVerification(database.path, env)?.clean_close).toBe(0);
    } finally {
      if (reader?.found) {
        reader.database.close();
      }
      releaseBranchAgentDatabaseLease(lease, { env }, "read-only");
    }
    expect(readBranchAgentIntegrityVerification(database.path, env)?.clean_close).toBe(0);
  },
);

it.each(["closing", "unregistering", "reopening shared state before closing"])(
  "does not recreate deletion history when %s an external store after shared state is lost",
  (operation) => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("agent-lease-lost-state-") };
    const pathname = path.join(tempDirs.make("agent-lease-external-"), "retained.sqlite");
    const database = openBranchAgentDatabase({ agentId: "retained", path: pathname, env });
    database.db.exec("INSERT INTO auth_profile_state VALUES ('preserved', '{\"ok\":true}', 1)");
    const shared = openBranchStateDatabase({ env });
    const registeredAgentDatabases = listBranchRegisteredAgentDatabases({ env });
    if (operation === "unregistering") {
      closeBranchAgentDatabaseByPath(pathname);
    }

    closeBranchStateDatabase();
    expect(shared.db.isOpen).toBe(false);
    for (const file of resolveSqliteDatabaseFilePaths(shared.path)) {
      fs.rmSync(file, { force: true });
    }

    if (operation === "reopening shared state before closing") {
      const reopened = openBranchStateDatabase({ env });
      expect(
        reopened.db
          .prepare("SELECT name FROM sqlite_schema WHERE name='agent_deletion_journal'")
          .get(),
      ).toBeUndefined();
    }
    expect(() =>
      operation === "unregistering"
        ? unregisterBranchAgentDatabase({ agentId: "retained", path: pathname, env })
        : closeBranchAgentDatabaseByPath(pathname),
    ).not.toThrow();
    expect(database.db.isOpen).toBe(false);
    {
      using retained = openNodeSqliteDatabase(pathname, { readOnly: true });
      expect(
        retained
          .prepare("SELECT state_json FROM auth_profile_state WHERE state_key='preserved'")
          .get(),
      ).toEqual({ state_json: '{"ok":true}' });
    }
    {
      using reopened = openNodeSqliteDatabase(shared.path, { readOnly: true });
      expect(
        reopened
          .prepare("SELECT name FROM sqlite_schema WHERE name='agent_deletion_journal'")
          .get(),
      ).toBeUndefined();
      expect(reopened.prepare("SELECT * FROM agent_database_leases").all()).toEqual([]);
    }
    const discovery = discoverAgentDatabaseMigrationTargets({
      env,
      configuredAgentDatabaseTargets: [],
      registeredAgentDatabases,
    });
    expect(discovery.targets).toEqual([]);
    expect(discovery.unverifiedTargets).toEqual([
      expect.objectContaining({ agentId: "retained", path: pathname }),
    ]);
    expect(discovery.warnings.join("\n")).toContain(`Held agent retained database ${pathname}`);
    expect(discovery.warnings.join("\n")).toContain("branch doctor --fix");
    const reopened = openBranchAgentDatabase({ agentId: "retained", path: pathname, env });
    expect(
      reopened.db
        .prepare("SELECT state_json FROM auth_profile_state WHERE state_key='preserved'")
        .get(),
    ).toEqual({ state_json: '{"ok":true}' });
  },
);

it("retains the selected sibling inventory when failed-open cleanup must recreate shared state", () => {
  const siblingDir = tempDirs.make("agent-cleanup-sibling-");
  const siblingPath = createLegacyDatabaseFixture({
    agentId: "sibling",
    path: path.join(siblingDir, "branch-agent.sqlite"),
    env: { BRANCH_STATE_DIR: tempDirs.make("agent-cleanup-seed-") },
    eventsBySession: {},
    schemaVersion: 19,
  });
  closeBranchStateDatabase();
  const env = {
    BRANCH_STATE_DIR: tempDirs.make("agent-cleanup-owner-"),
    BRANCH_CONFIG_PATH: path.join(tempDirs.make("agent-cleanup-config-"), "selected.json"),
    SIBLING_STORE: siblingDir,
  };
  fs.writeFileSync(
    env.BRANCH_CONFIG_PATH,
    JSON.stringify({ agents: { entries: { sibling: { agentDir: "${SIBLING_STORE}" } } } }),
  );
  const pathname = path.join(tempDirs.make("agent-cleanup-new-"), "new.sqlite");
  const sharedPath = resolveBranchStateSqlitePath(env);
  const before = fs.readFileSync(siblingPath);
  const failure = new Error("synthetic agent open failed after shared state loss");
  const nativeOpen = nodeSqlite.openNodeSqliteDatabase;
  const open = vi
    .spyOn(nodeSqlite, "openNodeSqliteDatabase")
    .mockImplementation((file, options) => {
      if (file === pathname) {
        closeBranchStateDatabase();
        for (const part of resolveSqliteDatabaseFilePaths(sharedPath)) {
          fs.rmSync(part, { force: true });
        }
        throw failure;
      }
      return nativeOpen(file, options);
    });
  try {
    expect(() => openBranchAgentDatabase({ agentId: "new", path: pathname, env })).toThrow(
      failure,
    );
  } finally {
    open.mockRestore();
  }
  using shared = openNodeSqliteDatabase(sharedPath, { readOnly: true });
  expect(
    shared.prepare("SELECT name FROM sqlite_schema WHERE name='agent_deletion_journal'").get(),
  ).toBeUndefined();
  expect(shared.prepare("SELECT * FROM agent_database_leases").all()).toEqual([]);
  expect(fs.existsSync(pathname)).toBe(false);
  expect(fs.readFileSync(siblingPath)).toEqual(before);
});

it.each(["", "-wal", "-shm", "-journal"])(
  "preserves unknown deletion history from a surviving integrity-store family (%s)",
  (suffix) => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("agent-prior-integrity-state-") };
    const quarantinePath = resolveQuarantineStorePath(env);
    fs.mkdirSync(path.dirname(quarantinePath));
    // No live handles or receipt rows exist; the durable footprint alone proves prior admission.
    fs.writeFileSync(quarantinePath + suffix, "");
    for (let attempt = 0; attempt < 2; attempt++) {
      const reopened = openBranchStateDatabase({ env });
      expect(
        reopened.db
          .prepare("SELECT name FROM sqlite_schema WHERE name='agent_deletion_journal'")
          .get(),
      ).toBeUndefined();
      closeBranchStateDatabase();
    }
  },
);

it.each(["quarantine", "terminal latch", "healthy"] as const)(
  "gates fresh read-only admission on %s and permits a repaired generation",
  (condition) => {
    const owner = openOwner();
    const options = { agentId: "integrity-lease", env: owner.env };
    closeBranchAgentDatabaseByPath(owner.database.path);
    closeBranchStateDatabase();
    if (condition === "quarantine") {
      // Drop process-held proof after persisting quarantine, as on restart.
      expect(
        recordBranchDatabaseQuarantine({
          kind: "agent",
          path: owner.database.path,
          reason: "synthetic readonly quarantine",
          env: owner.env,
        }),
      ).toBe(true);
    }
    closeBranchAgentDatabasesForTest();
    const latchError = new Error("synthetic terminal latch");
    latchError.name = "SqliteIntegrityError";
    if (condition === "terminal latch") {
      expect(recordBranchAgentDatabaseOpenFailure(owner.database.path, latchError)).toBe(true);
      expect(
        readBranchDatabaseQuarantineFailure("agent", owner.database.path, { env: owner.env }),
      ).toBeUndefined();
      expect(() => openBranchAgentDatabaseReadOnly(options)).toThrow(latchError);
      expect(clearBranchAgentDatabaseOpenFailure(owner.database.path, { env: owner.env })).toBe(
        true,
      );
    } else if (condition === "quarantine") {
      expect(
        readBranchDatabaseQuarantineFailure("agent", owner.database.path, { env: owner.env }),
      ).toBeDefined();

      expect(() => openBranchAgentDatabaseReadOnly(options)).toThrow(
        expect.objectContaining({ name: "SqliteIntegrityError" }),
      );

      // Clearing the quarantine (Doctor repair) makes the same generation readable again.
      expect(clearBranchDatabaseQuarantine(owner.database.path, { env: owner.env })).toBe(true);
    }
    const repaired = openBranchAgentDatabaseReadOnly(options);
    expect(repaired.found).toBe(true);
    if (repaired.found) {
      repaired.database.close();
    }
  },
);

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { prepareAgentDeleteDatabases } from "../../agents/agent-delete-databases.js";
import { withAgentDeletion } from "../../agents/agent-lifecycle-registry.js";
import * as sessionDirs from "../../agents/session-dirs.js";
import * as nodeSqlite from "../../infra/node-sqlite.js";
import { createDeferredCore } from "../../shared/deferred.js";
import { readAgentDatabaseAdmissionRefusal } from "../../state/agent-database-admission.js";
import { reconstructAgentDeletionJournal } from "../../state/agent-deletion-journal-recovery.js";
import {
  beginAgentDeletionJournal,
  completeAgentDeletionJournalInDatabase,
} from "../../state/agent-deletion-journal.js";
import { assertNoBranchAgentDatabaseLeasesReadOnly } from "../../state/branch-agent-db-lease.js";
import { invalidateRegisteredAgentDatabasesMemo } from "../../state/branch-agent-db-registry-listing.js";
import { unregisterBranchAgentDatabase } from "../../state/branch-agent-db-registry.js";
import {
  closeBranchAgentDatabasesForTest,
  closeBranchAgentDatabasesAsync,
  getBranchAgentDatabaseIfOpen,
  isBranchAgentDatabaseOpen,
  listBranchRegisteredAgentDatabases,
  openBranchAgentDatabase,
  type BranchAgentDatabaseOptions,
} from "../../state/branch-agent-db.js";
import { assertBranchDatabasesReady } from "../../state/branch-database-preflight.js";
import { clearBranchAgentIntegrityVerification } from "../../state/branch-quarantine-store.js";
import * as stateReads from "../../state/branch-state-db-readonly.js";
import {
  closeBranchStateDatabaseForTest,
  prepareBranchStateDatabaseSchema,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";
import { withEnvAsync } from "../../test-utils/env.js";
import type { BranchConfig } from "../types.branch.js";
import { loadCombinedSessionStoreForGatewayCore } from "./combined-store-gateway.js";
import { replaceSessionEntry } from "./session-accessor.js";
import { isCanonicalSqliteSessionMainKeyCurrent } from "./session-canonical-key-read.js";
import { setCanonicalSqliteSessionMainKey } from "./session-canonical-key.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";
import { reconcileSessionTranscriptIndexes } from "./session-transcript-reconcile.js";
import { runSessionStartupMigration } from "./startup-migration.js";
import { resolveAllAgentSessionStoreTargetsSync } from "./targets.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(async () => {
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

it.each(["cold", "preexisting"] as const)(
  "preserves the %s database lifetime for maintenance without a runtime handoff",
  async (lifetime) => {
    const stateDir = fs.realpathSync.native(tempDirs.make("branch-startup-handle-lifetime-"));
    const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
    const options = { agentId: "main", env };
    const initial = openBranchAgentDatabase(options);
    await replaceSessionEntry(
      { ...options, sessionKey: "agent:main:retained" },
      { sessionId: "retained-session", updatedAt: 1 },
    );
    setCanonicalSqliteSessionMainKey(initial, "previous");
    if (lifetime === "cold") {
      await closeBranchAgentDatabasesAsync(stateDir);
      closeBranchAgentDatabasesForTest();
    }

    await runSessionStartupMigration({
      cfg: { agents: { entries: { main: {} } } },
      env,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(isCanonicalSqliteSessionMainKeyCurrent(options, undefined)).toBe(true);
    expect(isBranchAgentDatabaseOpen(initial.path)).toBe(lifetime === "preexisting");
    if (lifetime === "preexisting") {
      expect(getBranchAgentDatabaseIfOpen(options)).toBe(initial);
    } else {
      expect(() => assertNoBranchAgentDatabaseLeasesReadOnly({ env })).not.toThrow();
    }
  },
);

it("does not create a missing configured agent database during startup maintenance", async () => {
  const root = fs.realpathSync.native(tempDirs.make("branch-startup-missing-agent-db-"));
  const stateDir = path.join(root, "state");
  const storePath = path.join(stateDir, "agents", "idle", "sessions", "sessions.json");
  const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
  const cfg: BranchConfig = {
    agents: { entries: { idle: {} } },
    session: { store: path.join(stateDir, "agents", "{agentId}", "sessions", "sessions.json") },
  };
  const sqlitePath = resolveSqliteTargetFromSessionStorePath(storePath, {
    agentId: "idle",
    env,
  }).path;

  await runSessionStartupMigration({
    cfg,
    env,
    log: { info: vi.fn(), warn: vi.fn() },
    deps: {
      migrateLegacyMainSessionKeys: vi.fn(async () => ({
        armed: false,
        changes: [],
        complete: false,
        ledgerComplete: false,
        legacyAgentId: "main",
        mainKey: "main",
        outcomes: [{ kind: "not-armed" as const }],
        warnings: [],
      })),
      resolveAllAgentSessionStoreTargetsSync: () => [{ agentId: "idle", storePath }],
    },
  });

  expect(fs.existsSync(sqlitePath)).toBe(false);
});

it.each([false, true])(
  "reconciles surviving stores while retained deleted stores stay fenced (cleanup completed: %s)",
  async (cleanupCompleted) => {
    const stateDir = fs.realpathSync.native(tempDirs.make("branch-startup-deleted-agent-"));
    const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
    const sharedPath = path.join(stateDir, "shared.sqlite");
    const cfg: BranchConfig = {
      agents: { ownership: "explicit", entries: { alpha: {} } },
      session: { store: sharedPath },
    };
    const survivorOptions = { agentId: "alpha", env, path: sharedPath };
    const survivor = openBranchAgentDatabase(survivorOptions);
    const deletedOptions = { agentId: "ops", env };
    const deleted = openBranchAgentDatabase(deletedOptions);
    for (const agentId of ["alpha", "ops"]) {
      await replaceSessionEntry(
        { agentId, env, storePath: sharedPath, sessionKey: `agent:${agentId}:shared` },
        { sessionId: `${agentId}-shared`, updatedAt: 1 },
      );
    }
    setCanonicalSqliteSessionMainKey(survivor, "previous");
    setCanonicalSqliteSessionMainKey(deleted, "previous");
    await closeBranchAgentDatabasesAsync(stateDir);
    closeBranchAgentDatabasesForTest();
    const deletion = beginAgentDeletionJournal(
      {
        agentId: "ops",
        operationId: randomUUID(),
        agentDir: path.dirname(deleted.path),
        sessionsDir: path.join(stateDir, "agents", "ops", "sessions"),
        workspaceDir: path.join(stateDir, "workspace-ops"),
        deleteFiles: false,
      },
      { env },
    );
    if (cleanupCompleted) {
      runBranchStateWriteTransaction(
        (database) => completeAgentDeletionJournalInDatabase(database, "ops", deletion.operationId),
        { env },
      );
    }
    expect(resolveAllAgentSessionStoreTargetsSync(cfg, { env })).toContainEqual(
      expect.objectContaining({ agentId: "ops" }),
    );
    const log = { info: vi.fn(), warn: vi.fn() };
    const handoffDatabase = vi.fn(async (options: BranchAgentDatabaseOptions) => {
      await reconcileSessionTranscriptIndexes(options);
    });

    await runSessionStartupMigration({ cfg, env, log, handoffDatabase });

    expect(handoffDatabase).toHaveBeenCalledExactlyOnceWith(survivorOptions);
    expect(isCanonicalSqliteSessionMainKeyCurrent(survivorOptions, undefined)).toBe(true);
    expect(isCanonicalSqliteSessionMainKeyCurrent(deletedOptions, "previous")).toBe(true);
    expect(isBranchAgentDatabaseOpen(deleted.path)).toBe(false);
    expect(() => openBranchAgentDatabase(deletedOptions)).toThrow("agent ops is deleted");
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining(cleanupCompleted ? "cleanup complete" : "cleanup pending"),
    );
  },
);

it("observes committed deletion before startup handoff after canonical database drainage", async () => {
  const stateDir = fs.realpathSync.native(tempDirs.make("branch-startup-journal-delivery-"));
  const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
  const storePath = path.join(stateDir, "shared.sqlite");
  const options = { agentId: "alpha", env, path: storePath };
  const cfg: BranchConfig = {
    agents: { ownership: "explicit", entries: { alpha: {} } },
    session: { store: storePath },
  };
  const database = openBranchAgentDatabase(options);
  await replaceSessionEntry(
    { agentId: "alpha", env, storePath, sessionKey: "agent:alpha:retained" },
    { sessionId: "retained-session", updatedAt: 1 },
  );
  setCanonicalSqliteSessionMainKey(database, "previous");
  await closeBranchAgentDatabasesAsync(stateDir);
  closeBranchAgentDatabasesForTest();
  expect(readAgentDatabaseAdmissionRefusal("alpha", { env })).toBeUndefined();

  const entered = createDeferredCore();
  const release = createDeferredCore();
  const readiness = await import("./session-canonical-validation-readiness.js");
  const certify = readiness.certifySessionCanonicalValidationPending;
  let validationFinished = false;
  const certification = vi
    .spyOn(readiness, "certifySessionCanonicalValidationPending")
    .mockImplementation(async (...args) => {
      const result = await certify(...args);
      validationFinished = true;
      return result;
    });
  const originalRead = stateReads.executeExistingBranchStateRead;
  let held = false;
  const reading = vi
    .spyOn(stateReads, "executeExistingBranchStateRead")
    .mockImplementation(async (...args) => {
      const reply = await originalRead(...args);
      if (args[1].type === "agentDatabaseDeletion.snapshot" && validationFinished && !held) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return reply;
    });
  const log = { info: vi.fn(), warn: vi.fn() };
  const handoffs =
    vi.fn<
      (target: { agentId: string; path: string | undefined; stateDir: string | undefined }) => void
    >();
  const handoffDatabase = async (handoffOptions: BranchAgentDatabaseOptions) => {
    handoffs({
      agentId: handoffOptions.agentId,
      path: handoffOptions.path,
      stateDir: handoffOptions.env?.BRANCH_STATE_DIR,
    });
  };
  const outcome = runSessionStartupMigration({ cfg, env, log, handoffDatabase }).then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    await Promise.race([
      entered.promise,
      outcome.then((result) => {
        throw new Error("Startup finished before the held native snapshot", {
          cause: result.ok ? undefined : result.error,
        });
      }),
    ]);
    expect(handoffs).not.toHaveBeenCalled();
    const agentDir = path.join(stateDir, "agents", "alpha", "agent");
    await withAgentDeletion(
      "alpha",
      async (begin) => {
        const deletion = await begin({
          agentId: "alpha",
          agentDir,
          sessionsDir: path.join(stateDir, "agents", "alpha", "sessions"),
          workspaceDir: path.join(stateDir, "workspace-alpha"),
          databasePaths: [storePath],
          deleteFiles: false,
        });
        await prepareAgentDeleteDatabases(cfg, "alpha", agentDir, { env });
        deletion.assertCurrent();
        deletion.finish();
      },
      { env },
    );
    release.resolve();
    expect(await outcome).toEqual({ ok: true });
    expect(handoffs).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("skipping deleted agent database"),
    );
  } finally {
    release.resolve();
    await outcome;
    reading.mockRestore();
    certification.mockRestore();
  }
});

it.each(["missing", "receipt-held", "malformed-receipt", "malformed-journal"])(
  "prepares and projects ordinary stores with %s deletion history",
  async (history) => {
    const stateDir = fs.realpathSync.native(tempDirs.make("branch-startup-recovery-hold-"));
    await withEnvAsync({ BRANCH_STATE_DIR: stateDir }, async () => {
      const env = { ...process.env };
      const options = ["main", "active"].map((agentId) => {
        const database = openBranchAgentDatabase({ agentId, env });
        setCanonicalSqliteSessionMainKey(database, "previous");
        return { agentId, env, path: database.path };
      });
      for (const { agentId, path: storePath } of options) {
        await replaceSessionEntry(
          { agentId, env, storePath, sessionKey: `agent:${agentId}:session` },
          { sessionId: `${agentId}-session`, updatedAt: 1 },
        );
      }
      await closeBranchAgentDatabasesAsync(stateDir);
      closeBranchAgentDatabasesForTest();
      runBranchStateWriteTransaction(
        (database) => {
          database.db.exec("DROP TABLE agent_deletion_journal");
          if (history !== "missing") {
            reconstructAgentDeletionJournal(
              database,
              options.filter(({ agentId }) => agentId === "main"),
            );
            if (history === "malformed-journal") {
              database.db
                .prepare(
                  "INSERT INTO agent_deletion_journal (agent_id, agent_dir, workspace_dir, sessions_dir, database_paths_json, created_at, cleanup_completed, delete_files) VALUES (?, ?, ?, ?, ?, 1, 1, 0)",
                )
                .run("archived", stateDir, stateDir, stateDir, "{");
            }
            if (history === "malformed-receipt") {
              database.db.exec(
                "UPDATE migration_sources SET report_json = '{}' WHERE source_key = 'agent-deletion-journal-reconstruction'",
              );
            }
          }
        },
        { env },
      );
      const cfg: BranchConfig = { agents: { entries: { main: {}, active: {} } } };
      const log = { info: vi.fn(), warn: vi.fn() };
      const handoffDatabase = vi.fn(async (_options: BranchAgentDatabaseOptions) => {});
      const maintenance = vi.spyOn(
        await import("./session-canonical-key.js"),
        "setCanonicalSqliteSessionMainKey",
      );
      const certification = vi.spyOn(
        await import("./session-canonical-validation-readiness.js"),
        "certifySessionCanonicalValidationPending",
      );
      try {
        for (const operation of ["gateway-startup", "gateway-restart"] as const) {
          const onAgentInspection = vi.fn();
          await assertBranchDatabasesReady({ env, operation, config: cfg, onAgentInspection });
          expect(onAgentInspection).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ schemaInspectionCount: 2 }),
          );
        }
        await runSessionStartupMigration({ cfg, env, log, handoffDatabase });

        expect(maintenance).toHaveBeenCalledTimes(2);
        expect(certification.mock.calls.map(([scope]) => scope.agentId).toSorted()).toEqual([
          "active",
          "main",
        ]);
        expect(handoffDatabase.mock.calls.map(([scope]) => scope)).toEqual(
          expect.arrayContaining(options),
        );
        expect(handoffDatabase).toHaveBeenCalledTimes(2);
        for (const scope of options) {
          expect(isCanonicalSqliteSessionMainKeyCurrent(scope, undefined)).toBe(true);
          expect(isBranchAgentDatabaseOpen(scope.path)).toBe(true);
        }
        const { store } = loadCombinedSessionStoreForGatewayCore(cfg, {
          configuredAgentsOnly: true,
        });
        expect(store["agent:main:session"]?.sessionId).toBe("main-session");
        expect(store["agent:active:session"]?.sessionId).toBe("active-session");
        expect(log.warn).not.toHaveBeenCalled();
        expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining("skipping held"));
      } finally {
        maintenance.mockRestore();
        certification.mockRestore();
      }
    });
  },
);

it("re-registers durable lineage children before configured-only runtime reads", async () => {
  const root = fs.realpathSync.native(tempDirs.make("branch-startup-registry-recovery-"));
  const stateDir = path.join(root, "state");
  await withEnvAsync({ BRANCH_STATE_DIR: stateDir }, async () => {
    const env = { ...process.env };
    const storeTemplate = path.join(stateDir, "agents", "{agentId}", "sessions", "sessions.json");
    const cfg: BranchConfig = {
      agents: { entries: { ops: {} } },
      session: { store: storeTemplate },
    };
    const mainKey = "agent:ops:main";
    const childKey = "agent:codex:subagent:upgrade-child";
    const storePathFor = (agentId: string) => storeTemplate.replace("{agentId}", agentId);

    await replaceSessionEntry(
      { agentId: "ops", env, sessionKey: mainKey, storePath: storePathFor("ops") },
      { sessionId: "session-ops", updatedAt: 20 },
    );
    await replaceSessionEntry(
      { agentId: "codex", env, sessionKey: childKey, storePath: storePathFor("codex") },
      { sessionId: "session-codex", spawnedBy: mainKey, updatedAt: 30 },
    );
    await replaceSessionEntry(
      {
        agentId: "local",
        env,
        sessionKey: "agent:local:main",
        storePath: storePathFor("local"),
      },
      { sessionId: "session-local", updatedAt: 10 },
    );

    const childDatabasePath = resolveSqliteTargetFromSessionStorePath(storePathFor("codex"), {
      agentId: "codex",
      env,
    }).path;
    await closeBranchAgentDatabasesAsync(stateDir);
    closeBranchAgentDatabasesForTest();
    unregisterBranchAgentDatabase({ agentId: "codex", env, path: childDatabasePath });

    expect(fs.existsSync(childDatabasePath)).toBe(true);
    expect(
      listBranchRegisteredAgentDatabases({ env }).some(
        (entry) => entry.agentId === "codex" && entry.path === childDatabasePath,
      ),
    ).toBe(false);

    await runSessionStartupMigration({
      cfg,
      env,
      log: { info: vi.fn(), warn: vi.fn() },
      deps: {
        migrateLegacyMainSessionKeys: vi.fn(async () => ({
          armed: false,
          changes: [],
          complete: false,
          ledgerComplete: false,
          legacyAgentId: "main",
          mainKey: "main",
          outcomes: [{ kind: "not-armed" as const }],
          warnings: [],
        })),
      },
    });

    expect(listBranchRegisteredAgentDatabases({ env })).toContainEqual(
      expect.objectContaining({ agentId: "codex", path: childDatabasePath }),
    );

    const enumerateAgentDirs = vi.spyOn(sessionDirs, "resolveAgentSessionDirsFromAgentsDirSync");
    try {
      const store = loadCombinedSessionStoreForGatewayCore(cfg, {
        configuredAgentsOnly: true,
      }).store;
      expect(store[mainKey]?.sessionId).toBe("session-ops");
      expect(store[childKey]?.sessionId).toBe("session-codex");
      expect(store["agent:local:main"]).toBeUndefined();
      expect(enumerateAgentDirs).not.toHaveBeenCalled();
    } finally {
      enumerateAgentDirs.mockRestore();
    }
  });
});

it("keeps copied state directories self-contained for combined gateway reads", async () => {
  const root = fs.realpathSync.native(tempDirs.make("branch-copied-state-registry-"));
  const sourceStateDir = path.join(root, "source");
  fs.mkdirSync(sourceStateDir);
  const canonicalSourceStateDir = fs.realpathSync.native(sourceStateDir);
  const copiedStateDir = path.join(root, "copy");
  const cfg: BranchConfig = {
    agents: { entries: { main: {} } },
  };
  const sessionKey = "agent:main:copied-state";

  await withEnvAsync({ BRANCH_STATE_DIR: canonicalSourceStateDir }, async () => {
    const env = { ...process.env };
    await replaceSessionEntry(
      { agentId: "main", env, sessionKey },
      { sessionId: "copied-session", updatedAt: 1 },
    );
    await closeBranchAgentDatabasesAsync(canonicalSourceStateDir);
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    invalidateRegisteredAgentDatabasesMemo({ env });
  });

  fs.cpSync(canonicalSourceStateDir, copiedStateDir, { recursive: true });
  const canonicalCopiedStateDir = fs.realpathSync.native(copiedStateDir);
  await withEnvAsync({ BRANCH_STATE_DIR: canonicalCopiedStateDir }, async () => {
    const env = { ...process.env };
    expect((await prepareBranchStateDatabaseSchema({ env })).warnings).toEqual([]);
    const combined = loadCombinedSessionStoreForGatewayCore(cfg, {
      configuredAgentsOnly: true,
    });

    expect(combined.store[sessionKey]?.sessionId).toBe("copied-session");
    expect(Object.keys(combined.store).filter((key) => key === sessionKey)).toHaveLength(1);
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    invalidateRegisteredAgentDatabasesMemo({ env });
  });
});

it.each(["registry", "main-key"] as const)(
  "keeps the event loop responsive while repairing a cold %s startup contract",
  async (repair) => {
    const stateDir = fs.realpathSync.native(tempDirs.make("branch-startup-admission-"));
    const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
    const options = { agentId: "main", env };
    const cfg: BranchConfig = {
      agents: { entries: { main: {} } },
      session: {},
    };
    const initial = openBranchAgentDatabase(options);
    setCanonicalSqliteSessionMainKey(initial, repair === "main-key" ? "previous" : "main");
    closeBranchAgentDatabasesForTest();
    clearBranchAgentIntegrityVerification(initial.path, env);
    if (repair === "registry") {
      unregisterBranchAgentDatabase({ ...options, path: initial.path });
    }
    const originalOpen = nodeSqlite.openNodeSqliteDatabase;
    let yielded = false;
    let tick: ReturnType<typeof setImmediate> | undefined;
    const open = vi
      .spyOn(nodeSqlite, "openNodeSqliteDatabase")
      .mockImplementation((location, behavior) => {
        const database = originalOpen(location, behavior);
        if (location === initial.path && behavior?.readOnly !== true) {
          // Earlier async setup cannot satisfy this admission-phase progress check.
          tick = setImmediate(() => {
            yielded = true;
            cfg.session!.mainKey = "later";
          });
        }
        return database;
      });
    const log = { info: vi.fn(), warn: vi.fn() };
    try {
      await runSessionStartupMigration({
        cfg,
        env,
        log,
      });
      expect(log.warn).not.toHaveBeenCalled();
      expect(yielded).toBe(true);
      expect(isCanonicalSqliteSessionMainKeyCurrent(options, undefined)).toBe(true);
      expect(listBranchRegisteredAgentDatabases({ env })).toContainEqual(
        expect.objectContaining({ agentId: "main", path: initial.path }),
      );
      expect(isBranchAgentDatabaseOpen(initial.path)).toBe(false);
    } finally {
      if (tick) {
        clearImmediate(tick);
      }
      open.mockRestore();
    }
  },
);

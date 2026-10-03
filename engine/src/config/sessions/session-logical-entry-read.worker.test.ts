import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  emptySqliteCounts,
  observeParentSqlite,
  sqliteMethods,
} from "../../../test/helpers/sqlite-parent-observer.js";
import { openNodeSqliteDatabase } from "../../infra/node-sqlite.js";
import { createDeferredCore } from "../../shared/deferred.js";
import {
  registerBranchAgentDatabase,
  unregisterBranchAgentDatabase,
} from "../../state/branch-agent-db-registry.js";
import {
  closeBranchAgentDatabasesAsync,
  openBranchAgentDatabase,
  resolveBranchAgentSqlitePath,
  resolveIncognitoBranchAgentSqlitePath,
} from "../../state/branch-agent-db.js";
import type { AgentDatabaseRequestExecutionSource } from "../../state/branch-agent-execution-contract.js";
import type { AgentDatabaseExecutionScope } from "../../state/branch-agent-execution-native.js";
import * as executionOwner from "../../state/branch-agent-execution.js";
import { runBranchAgentWorkerWrite } from "../../state/branch-agent-write-admission.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../../test-utils/branch-test-state.js";
import { loadSessionEntry, replaceSessionEntrySync } from "./session-accessor.sqlite-entry.js";
import { loadExactSessionEntryReadOnly } from "./session-accessor.sqlite-exact-read.js";
import { resolveSqliteScope, toDatabaseOptions } from "./session-accessor.sqlite-scope.js";
import type { SessionAccessScope } from "./session-accessor.types.js";
import {
  readSessionEntryInWorker,
  withSessionEntriesFromStoresInWorker,
} from "./session-entry-read-runtime.js";
import { historyLane } from "./session-transcript-worker-resources.js";

let state: BranchTestState;
beforeAll(async () => {
  state = await createBranchTestState({ scenario: "minimal" });
});
afterAll(async () => {
  await state.cleanup();
});

it("preserves logical and physical owners without parent SQLite calls", async () => {
  const custom = state.statePath("logical-read", "sessions.json");
  const canonical = state.sessionsDir("ops") + "/sessions.json";
  const cases: Array<{ scope: SessionAccessScope; writerAgent: string; sessionId: string }> = [
    {
      scope: {
        agentId: "ops",
        storePath: state.statePath("unregistered", "sessions.json"),
        sessionKey: "global",
      },
      writerAgent: "ops",
      sessionId: "unregistered",
    },
    {
      scope: { agentId: "ops", storePath: custom, sessionKey: "global" },
      writerAgent: "ops",
      sessionId: "global",
    },
    {
      scope: { agentId: "ops", storePath: custom, sessionKey: "unknown" },
      writerAgent: "ops",
      sessionId: "unknown",
    },
    {
      scope: { agentId: "ops", storePath: custom, sessionKey: "main" },
      writerAgent: "ops",
      sessionId: "main",
    },
    {
      scope: {
        agentId: "ops",
        storePath: custom,
        sessionKey: "agent:ops:matrix:group:!Room:example.org",
      },
      writerAgent: "ops",
      sessionId: "opaque",
    },
    {
      scope: { storePath: canonical, sessionKey: "topic" },
      writerAgent: "ops",
      sessionId: "inferred",
    },
    {
      scope: {
        defaultAgentId: "ops",
        storePath: state.statePath("default-owner", "sessions.json"),
        sessionKey: "global",
      },
      writerAgent: "ops",
      sessionId: "configured-default",
    },
    {
      scope: { agentId: "ops", storePath: state.statePath("shared.sqlite"), sessionKey: "global" },
      writerAgent: "main",
      sessionId: "shared-physical-main",
    },
  ];
  for (const { scope, writerAgent, sessionId } of cases) {
    replaceSessionEntrySync(
      { ...scope, agentId: writerAgent, env: state.env },
      {
        sessionId,
        updatedAt: 1,
        pendingFinalDelivery: {
          kind: "replayable",
          createdAt: 1,
          text: "retained final",
          intentId: sessionId,
        },
      },
    );
  }
  const unregistered = cases[0]!;
  const unregisteredTarget = toDatabaseOptions(
    resolveSqliteScope({ ...unregistered.scope, env: state.env }),
  );
  unregisterBranchAgentDatabase({
    agentId: "ops",
    path: resolveBranchAgentSqlitePath(unregisteredTarget),
    env: state.env,
  });
  await closeBranchAgentDatabasesAsync();
  const observer = observeParentSqlite();
  try {
    const calibration = openNodeSqliteDatabase(":memory:");
    calibration.exec("CREATE TABLE calibration (value INTEGER)");
    calibration.prepare("INSERT INTO calibration VALUES (?)").run(7);
    const query = calibration.prepare("SELECT value FROM calibration");
    expect(query.get()).toEqual({ value: 7 });
    expect(query.all()).toEqual([{ value: 7 }]);
    expect([...query.iterate()]).toEqual([{ value: 7 }]);
    calibration.close();
    sqliteMethods.forEach((method) => expect(observer.counts[method], method).toBeGreaterThan(0));
    observer.reset();
    for (const { scope, sessionId } of cases) {
      expect(await readSessionEntryInWorker({ ...scope, env: state.env }, () => {})).toMatchObject({
        sessionId,
        pendingFinalDelivery: { text: "retained final", intentId: sessionId },
      });
    }
    expect(observer.counts).toEqual(emptySqliteCounts());
  } finally {
    observer.restore();
  }
});

it("settles a consumed read after an unrelated registry change", async () => {
  const scope = {
    agentId: "ops",
    env: state.env,
    storePath: state.statePath("consumed-read", "sessions.json"),
    sessionKey: "global",
  };
  replaceSessionEntrySync(scope, { sessionId: "consumed-session", updatedAt: 1 });
  const unrelated = openBranchAgentDatabase({ agentId: "unrelated", env: state.env });
  const unrelatedPath = unrelated.path;
  await closeBranchAgentDatabasesAsync();
  let registryChange: Promise<void> | undefined;
  let consumed = 0;
  const reading = withSessionEntriesFromStoresInWorker(
    [{ ...scope, sessionKeys: [scope.sessionKey] }],
    ([read]) => {
      read!.assertCurrent();
      expect(read!.result.entries[0]?.entry.sessionId).toBe("consumed-session");
      consumed++;
      registryChange = Promise.resolve().then(() => {
        unregisterBranchAgentDatabase({
          agentId: "unrelated",
          path: unrelatedPath,
          env: state.env,
        });
      });
      return "consumed";
    },
  ).then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
  try {
    const result = await reading;
    expect(consumed).toBe(1);
    expect(result).toEqual({ value: "consumed", error: undefined });
  } finally {
    await registryChange;
  }
});

it("retains the captured relative locator and environment across worker preparation", async () => {
  const originalCwd = process.cwd();
  const storePath = state.statePath("relative", "sessions.json");
  const scope = { agentId: "ops", env: { ...state.env }, storePath, sessionKey: "global" };
  replaceSessionEntrySync(scope, { sessionId: "captured-location", updatedAt: 1 });
  const reading = readSessionEntryInWorker(
    { ...scope, storePath: path.relative(originalCwd, storePath) },
    () => {},
  );
  try {
    scope.env.BRANCH_STATE_DIR = state.statePath("later-environment");
    process.chdir(state.stateDir);
    await expect(reading).resolves.toMatchObject({ sessionId: "captured-location" });
  } finally {
    process.chdir(originalCwd);
    await reading;
  }
});

it("keeps creating and writable schema-repair admission for a logical read", async () => {
  const scope = { agentId: "creating", env: state.env, sessionKey: "global" };
  const databasePath = resolveBranchAgentSqlitePath(scope);
  expect(fs.existsSync(databasePath)).toBe(false);
  await expect(readSessionEntryInWorker(scope, () => {})).resolves.toBeUndefined();
  expect(fs.existsSync(databasePath)).toBe(true);
  await closeBranchAgentDatabasesAsync();
  const database = openBranchAgentDatabase(scope);
  database.db.exec("DROP INDEX idx_agent_session_nodes_label");
  await closeBranchAgentDatabasesAsync();
  await expect(readSessionEntryInWorker(scope, () => {})).resolves.toBeUndefined();
  const inspect = openNodeSqliteDatabase(databasePath, { readOnly: true });
  try {
    expect(
      inspect
        .prepare("SELECT name FROM sqlite_master WHERE name = ?")
        .get("idx_agent_session_nodes_label"),
    ).toEqual({ name: "idx_agent_session_nodes_label" });
  } finally {
    inspect.close();
  }
});

it("refuses malformed folded candidate state while retaining the healthy requested row", async () => {
  const scope = {
    agentId: "aliases",
    env: state.env,
    sessionKey: "agent:aliases:matrix:group:!Room:example.org",
  };
  const folded = "agent:aliases:matrix:group:!room:example.org";
  replaceSessionEntrySync(scope, { sessionId: "healthy", updatedAt: 1 });
  replaceSessionEntrySync({ ...scope, sessionKey: folded }, { sessionId: "broken", updatedAt: 1 });
  expect(loadExactSessionEntryReadOnly(scope)?.entry.sessionId).toBe("healthy");
  const database = openBranchAgentDatabase(scope);
  database.db
    .prepare("UPDATE session_nodes SET entry_json = ? WHERE session_key = ?")
    .run("{", folded);
  await expect(Promise.resolve().then(() => loadSessionEntry(scope))).rejects.toMatchObject({
    code: "SESSION_CANONICAL_KEY_MIGRATION_REQUIRED",
  });
  await expect(readSessionEntryInWorker(scope, () => {})).rejects.toMatchObject({
    code: "SESSION_CANONICAL_KEY_MIGRATION_REQUIRED",
  });
});

it.each([
  { stage: "while-queued", change: "registry", registration: "changed" },
  { stage: "while-queued", change: "file", registration: "changed" },
  { stage: "while-queued", change: "file", registration: "unchanged" },
  { stage: "while-queued", change: "caller", registration: "changed" },
  { stage: "before-open", change: "registry", registration: "changed" },
  { stage: "after-row", change: "registry", registration: "changed" },
  { stage: "after-release", change: "registry", registration: "changed" },
  { stage: "after-discovery-cleanup", change: "registry", registration: "changed" },
] as const)(
  "refuses $change replacement $stage ($registration registration)",
  async ({ stage, change, registration }) => {
    const scope = {
      agentId: "ops",
      env: state.env,
      storePath: state.statePath(stage, change, registration, "sessions.json"),
      sessionKey: "global",
    };
    replaceSessionEntrySync(scope, { sessionId: "selected-row", updatedAt: 1 });
    const target = toDatabaseOptions(resolveSqliteScope(scope));
    if (change === "file") {
      await closeBranchAgentDatabasesAsync();
    }
    const entered = createDeferredCore();
    const release = createDeferredCore();
    let executionReleased = false;
    const holdDiscoveryCleanup = async () => {
      if (stage === "after-discovery-cleanup" && executionReleased) {
        entered.resolve();
        await release.promise;
      }
    };
    const closeResources = historyLane.pool.closeResources.bind(historyLane.pool);
    const rotate = historyLane.pool.rotate.bind(historyLane.pool);
    const closeIntercept = vi
      .spyOn(historyLane.pool, "closeResources")
      .mockImplementation(async (key) => {
        await closeResources(key);
        await holdDiscoveryCleanup();
      });
    const rotateIntercept = vi.spyOn(historyLane.pool, "rotate").mockImplementation(async () => {
      await rotate();
      await holdDiscoveryCleanup();
    });
    const capture = executionOwner.captureBranchAgentDatabaseExecution;
    const intercept = vi
      .spyOn(executionOwner, "captureBranchAgentDatabaseExecution")
      .mockImplementation((...args) => {
        const execution = capture(...args);
        if (stage === "while-queued") {
          entered.resolve();
        }
        return {
          ...execution,
          async prepare(source: AgentDatabaseRequestExecutionSource): Promise<void> {
            if (stage === "before-open") {
              entered.resolve();
              await release.promise;
            }
            await execution.prepare(source);
          },
          async runExisting<T>(
            source: AgentDatabaseRequestExecutionSource,
            operation: (worker: AgentDatabaseExecutionScope) => Promise<T>,
            options?: { retireNativeOnFailure: true },
          ): Promise<T | undefined> {
            return execution.runExisting(
              source,
              async (worker) => {
                const result = await operation(worker);
                if (stage === "after-row") {
                  entered.resolve();
                  await release.promise;
                }
                return result;
              },
              options,
            );
          },
          async release() {
            await execution.release();
            executionReleased = true;
            if (stage === "after-release") {
              entered.resolve();
              await release.promise;
            }
          },
        };
      });
    const writerEntered = createDeferredCore();
    const priorWriter =
      stage === "while-queued"
        ? runBranchAgentWorkerWrite(target, async () => {
            writerEntered.resolve();
            await release.promise;
          })
        : undefined;
    if (priorWriter) {
      await writerEntered.promise;
    }
    let callerCurrent = true;
    const reading = readSessionEntryInWorker(scope, () => {
      if (!callerCurrent) {
        throw new Error("Captured caller was revoked");
      }
    }).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    );
    void reading.then((result) => {
      entered.reject(result.error ?? new Error("Logical read completed before its held boundary"));
    });
    try {
      await entered.promise;
      const databasePath = resolveBranchAgentSqlitePath(target);
      if (change === "registry") {
        unregisterBranchAgentDatabase({ agentId: "ops", path: databasePath, env: state.env });
      } else if (change === "file") {
        fs.renameSync(databasePath, `${databasePath}.original`);
        fs.copyFileSync(`${databasePath}.original`, databasePath);
      } else {
        callerCurrent = false;
      }
      if (registration === "changed") {
        registerBranchAgentDatabase({
          agentId: change === "registry" ? "other" : "ops",
          path: databasePath,
          env: state.env,
        });
      }
      release.resolve();
      const result = await reading;
      expect(result.value).toBeUndefined();
      expect(result.error).toBeInstanceOf(Error);
    } finally {
      release.resolve();
      await reading;
      await priorWriter;
      intercept.mockRestore();
      closeIntercept.mockRestore();
      rotateIntercept.mockRestore();
    }
  },
);

it.each(
  [undefined, "main", "other"].flatMap((agentId) =>
    ["global", "topic"].map((sessionKey) => ({ agentId, sessionKey })),
  ),
)(
  "preserves a populated incognito owner for a mismatched explicit locator ($agentId, $sessionKey)",
  async ({ agentId, sessionKey }) => {
    const owner = { agentId: `ops-memory-${agentId ?? "missing"}-${sessionKey}`, env: state.env };
    const storePath = resolveIncognitoBranchAgentSqlitePath(owner);
    const ownedScope = { ...owner, storePath, sessionKey };
    replaceSessionEntrySync(ownedScope, { sessionId: "private-ops-session", updatedAt: 1 });
    const scope = { env: state.env, storePath, sessionKey, agentId };
    expect(() => loadSessionEntry(scope)).toThrow(/already open for agent ops-memory-/);
    expect(fs.existsSync(storePath)).toBe(false);
    await expect
      .soft(readSessionEntryInWorker(scope, () => {}))
      .rejects.toThrow(/already open for agent ops-memory-/);
    expect.soft(fs.existsSync(storePath)).toBe(false);
    expect(loadSessionEntry(ownedScope)).toMatchObject({ sessionId: "private-ops-session" });
  },
);

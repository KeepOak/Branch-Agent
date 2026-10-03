import { execFile } from "node:child_process";
import { renameSync } from "node:fs";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { observeHostDataSql } from "../../../test/helpers/sqlite-statement-execution-counter.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import type { SessionAcpMeta } from "../../config/sessions/types.js";
import type { BranchConfig } from "../../config/types.branch.js";
import {
  resolveRuntimeWorkerArgv,
  resolveRuntimeWorkerUrl,
} from "../../infra/runtime-worker-url.js";
import { runWithSqliteWorkerStateContext } from "../../infra/sqlite-worker-state-context.js";
import { storageProcessTestEntrypoints } from "../../infra/storage-process-runtime.test-support.js";
import { createDeferredCore } from "../../shared/deferred.js";
import {
  closeBranchAgentDatabasesAsync,
  openBranchAgentDatabase,
} from "../../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../../state/branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import * as stateWorker from "../../state/branch-state-worker-store.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { prepareAcpSessionControlRead } from "./session-meta-control.js";
import { buildAcpDatabaseSessionKey, selectAcpSessionRow } from "./session-meta-keys.js";
import { readAcpSessionControlInWorker } from "./session-meta-source.worker.js";
import { upsertAcpSessionMeta, upsertAcpSessionMetaForControl } from "./session-meta-write.js";
import { writeAcpSessionMetaForMigration } from "./session-meta.js";

const meta: SessionAcpMeta = {
  backend: "fixture",
  agent: "fixture",
  runtimeSessionName: "fixture-runtime",
  mode: "persistent",
  state: "idle",
  lastActivityAt: 100,
};

afterEach(async () => {
  vi.restoreAllMocks();
  await closeBranchAgentDatabasesAsync();
  await closeBranchStateDatabaseAsync();
});

it("rechecks same-binding metadata updates and clear through fresh joins without host data SQL", async () => {
  await withBranchTestState({ label: "acp-control-fresh" }, async () => {
    const cfg: BranchConfig = { agents: { ownership: "explicit", entries: { main: {} } } };
    const scope = {
      cfg,
      sessionKey: "agent:main:acp:control",
      agentId: "main",
      skipMaintenance: true,
    };
    await replaceSessionEntry(scope, {
      sessionId: "session",
      lifecycleRevision: "original",
      updatedAt: 100,
      spawnedBy: "agent:main:parent",
    });
    await upsertAcpSessionMeta({ ...scope, mutate: () => meta });
    const observe = observeHostDataSql();
    let prepared: Awaited<ReturnType<typeof prepareAcpSessionControlRead>> | undefined;
    try {
      prepared = await prepareAcpSessionControlRead(scope);
      const original = await prepared.readCurrent(cfg);
      expect(original).toMatchObject({ session: { acp: { state: "idle" } } });
      await upsertAcpSessionMeta({ ...scope, mutate: () => ({ ...meta, state: "running" }) });
      expect((await prepared.readCurrent(cfg)).session.acp).toMatchObject({ state: "running" });
      prepared.assertCurrent(cfg);
      await upsertAcpSessionMeta({ ...scope, mutate: () => null });
      expect((await prepared.readCurrent(cfg)).session.acp).toBeUndefined();
      const missing = vi.fn(() => meta);
      await expect(
        upsertAcpSessionMetaForControl({ ...scope, mutate: missing }, original.constraint!),
      ).rejects.toThrow(/no longer present/);
      expect(missing).not.toHaveBeenCalled();
      expect(observe.queries).toEqual([]);
      prepared.release();
      await expect(prepared.readCurrent(cfg)).rejects.toThrow(/unavailable/);
    } finally {
      prepared?.release();
      observe.restore();
    }
  });
});

it.each(["owner", "lifecycle", "shared-source"] as const)(
  "refuses retained control after same-ID %s replacement",
  async (replacement) => {
    await withBranchTestState({ label: "acp-control-replacement" }, async (state) => {
      const cfg: BranchConfig = { agents: { ownership: "explicit", entries: { main: {} } } };
      const scope = { cfg, sessionKey: "agent:main:acp:control", agentId: "main" };
      const entry = {
        sessionId: "same-id",
        lifecycleRevision: "original",
        updatedAt: 100,
        spawnedBy: "agent:main:parent",
      };
      await replaceSessionEntry(scope, entry);
      await upsertAcpSessionMeta({ ...scope, mutate: () => meta, skipMaintenance: true });
      const prepared = await prepareAcpSessionControlRead(scope);
      try {
        if (replacement === "shared-source") {
          const databasePath = resolveBranchStateSqlitePath(state.env);
          await closeBranchStateDatabaseAsync();
          renameSync(databasePath, `${databasePath}.retired`);
          writeAcpSessionMetaForMigration({
            sessionKey: buildAcpDatabaseSessionKey(scope.sessionKey, scope.agentId),
            lifecycleRevision: entry.lifecycleRevision,
            meta,
          });
        } else {
          await replaceSessionEntry(scope, {
            ...entry,
            ...(replacement === "owner"
              ? { spawnedBy: "agent:main:successor" }
              : { lifecycleRevision: "successor" }),
          });
        }
        await expect(prepared.readCurrent(cfg)).rejects.toThrow(/changed|unavailable/);
      } finally {
        prepared.release();
      }
    });
  },
);

it("keeps the physical shared-store owner and validates canonical ACP aliases in the worker kernel", async () => {
  await withBranchTestState({ label: "acp-control-shared-owner" }, async (state) => {
    const storePath = state.statePath("shared.sqlite");
    const cfg: BranchConfig = {
      agents: { ownership: "explicit", entries: { main: {}, worker: {} } },
      session: { store: storePath },
    };
    openBranchAgentDatabase({ agentId: "main", path: storePath });
    const sessionKey = "agent:worker:acp:control";
    const scope = { cfg, storePath, sessionKey, agentId: "worker" };
    await replaceSessionEntry(scope, {
      sessionId: "worker-session",
      lifecycleRevision: "original",
      updatedAt: 100,
      spawnedBy: "agent:main:parent",
    });
    writeAcpSessionMetaForMigration({
      sessionKey: "agent:WORKER:acp:CONTROL",
      lifecycleRevision: "original",
      meta,
    });
    const prepared = await prepareAcpSessionControlRead(scope);
    try {
      const current = await prepared.readCurrent(cfg);
      expect(current.session.acp).toMatchObject({ state: "idle" });
      const constraint = current.constraint!;
      expect(constraint.source.agentId).toBe("main");
      expect(constraint.agentId).toBe("worker");
      const database = openBranchStateDatabase();
      const context = captureBranchStateWorkerContext();
      const read = () =>
        runWithSqliteWorkerStateContext(context, () =>
          runBranchStateWriteTransaction((db) => readAcpSessionControlInWorker(db, constraint), {
            database,
          }),
        );
      expect(read().row).toMatchObject({ session_id: "original" });
      const missingKey = "agent:worker:acp:missing";
      const missingMetadataKey = buildAcpDatabaseSessionKey(missingKey, "worker");
      writeAcpSessionMetaForMigration({
        sessionKey: missingMetadataKey,
        lifecycleRevision: "deleted-lifecycle",
        meta,
      });
      expect(
        runWithSqliteWorkerStateContext(context, () =>
          runBranchStateWriteTransaction(
            (db) =>
              readAcpSessionControlInWorker(db, {
                ...constraint,
                sessionKey: missingKey,
                entry: undefined,
                ownerKey: undefined,
                read: { keys: [missingMetadataKey] },
              }),
            { database },
          ),
        ).row,
      ).toBeUndefined();
      writeAcpSessionMetaForMigration({
        sessionKey: "agent:WORKER:acp:CONTROL",
        lifecycleRevision: "successor",
        meta,
      });
      expect(read().row).toBeUndefined();
      await replaceSessionEntry(scope, {
        sessionId: "worker-session",
        lifecycleRevision: "successor",
        updatedAt: 100,
        spawnedBy: "agent:main:parent",
      });
      expect(read).toThrow(/changed/);
    } finally {
      prepared.release();
    }
  });
});

it.each(["clear", "rebind", "destination-rebind", "same-binding", "runtime-rebind"] as const)(
  "rechecks global metadata at controlled commit after an independent %s write",
  async (change) => {
    await withBranchTestState({ label: `acp-control-commit-${change}` }, async (state) => {
      const storePath = state.statePath("shared-agent.sqlite");
      const cfg: BranchConfig = {
        agents: {
          ownership: "explicit",
          entries: { main: {} },
          defaults: { sessionStore: { agentId: "main" } },
        },
        session: { scope: "global", store: storePath },
      };
      await state.writeConfig(cfg);
      const scope = { cfg, agentId: "main", sessionKey: "global", skipMaintenance: true };
      await replaceSessionEntry(
        { ...scope, storePath },
        {
          sessionId: "original-id",
          lifecycleRevision: "original-lifecycle",
          updatedAt: 100,
          spawnedBy: "agent:main:parent",
        },
      );
      const aliasKey = "@agent:main:global";
      writeAcpSessionMetaForMigration({
        sessionKey: aliasKey,
        lifecycleRevision: "original-lifecycle",
        meta,
      });
      const prepared = await prepareAcpSessionControlRead(scope);
      const constraint = {
        ...(await prepared.readCurrent(cfg)).constraint!,
        runtimeLocator: { backend: meta.backend, runtimeSessionName: meta.runtimeSessionName },
      };
      const reached = createDeferredCore();
      const release = createDeferredCore();
      const original = stateWorker.runBranchStateWorkerOperation;
      let paused = false;
      const intercepted = vi
        .spyOn(stateWorker, "runBranchStateWorkerOperation")
        .mockImplementation((context, operation, options) =>
          original(
            context,
            (worker) =>
              operation({
                ...worker,
                execute: new Proxy(worker.execute, {
                  apply(execute, receiver, args: Parameters<typeof worker.execute>) {
                    if (args[0].type === "acp.commitMutation" && !paused) {
                      paused = true;
                      reached.resolve();
                      return release.promise.then(() => Reflect.apply(execute, receiver, args));
                    }
                    return Reflect.apply(execute, receiver, args);
                  },
                }),
              }),
            options,
          ),
        );
      const mutate = vi.fn((current: SessionAcpMeta | undefined) => {
        if (!current) {
          throw new Error("Expected a current ACP row at preparation");
        }
        return { ...current, state: "idle" as const, lastActivityAt: 300 };
      });
      const observe = observeHostDataSql();
      const pending = upsertAcpSessionMetaForControl({ ...scope, mutate }, constraint);
      const outcome = pending.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      try {
        await Promise.race([
          reached.promise,
          outcome.then(() => {
            throw new Error("Controlled update settled before its commit gate");
          }),
        ]);
        const moduleUrl = resolveRuntimeWorkerUrl(storageProcessTestEntrypoints.acpMetadataWriter);
        const input = {
          mutation:
            change === "clear"
              ? { kind: "upsert", scope, clear: true }
              : {
                  kind: "migration",
                  rows: [
                    {
                      sessionKey:
                        change === "destination-rebind"
                          ? buildAcpDatabaseSessionKey("global", "main")
                          : aliasKey,
                      lifecycleRevision:
                        change === "same-binding" || change === "runtime-rebind"
                          ? "original-lifecycle"
                          : "replacement-lifecycle",
                      meta: {
                        ...meta,
                        runtimeSessionName:
                          change === "runtime-rebind"
                            ? "replacement-runtime"
                            : meta.runtimeSessionName,
                        state: "running",
                        lastActivityAt: 200,
                      },
                    },
                    ...(change === "rebind"
                      ? [{ sessionKey: "global", lifecycleRevision: "original-lifecycle", meta }]
                      : []),
                  ],
                },
        } satisfies Parameters<
          typeof import("./session-meta-process.test-support.js").writeAcpMetadataFromProcess
        >[0];
        const childSource = `
          const { writeAcpMetadataFromProcess } = await import(${JSON.stringify(moduleUrl.href)});
          await writeAcpMetadataFromProcess(${JSON.stringify(input)});
        `;
        await promisify(execFile)(
          process.execPath,
          [
            ...resolveRuntimeWorkerArgv(moduleUrl).slice(0, -1),
            "--input-type=module",
            "--eval",
            childSource,
          ],
          {
            cwd: process.cwd(),
            env: {
              PATH: process.env.PATH,
              BRANCH_STATE_DIR: state.env.BRANCH_STATE_DIR,
              BRANCH_CONFIG_PATH: state.env.BRANCH_CONFIG_PATH,
              NODE_ENV: "test",
            },
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
          },
        );
        release.resolve();
        const result = await outcome;
        expect(result.ok).toBe(change === "same-binding");
        if (!result.ok) {
          expect(String(result.error)).toMatch(/ACP.*(metadata|binding|changed)/i);
        }
        expect(mutate).toHaveBeenCalledOnce();
        expect(observe.queries).toEqual([]);
      } finally {
        release.resolve();
        await outcome;
        observe.restore();
        intercepted.mockRestore();
        prepared.release();
      }
      const { db } = openBranchStateDatabase();
      const canonical = selectAcpSessionRow(db, buildAcpDatabaseSessionKey("global", "main"));
      const alias = selectAcpSessionRow(db, aliasKey);
      if (change === "same-binding") {
        expect(canonical).toMatchObject({
          session_id: "original-lifecycle",
          state: "idle",
          last_activity_at: 300,
        });
      } else if (change === "runtime-rebind") {
        expect(canonical).toBeUndefined();
        expect(alias).toMatchObject({
          session_id: "original-lifecycle",
          runtime_session_name: "replacement-runtime",
          state: "running",
          last_activity_at: 200,
        });
      } else if (change === "destination-rebind") {
        expect(canonical).toMatchObject({ session_id: "replacement-lifecycle", state: "running" });
        expect(alias).toMatchObject({ session_id: "original-lifecycle", state: "idle" });
      } else {
        expect(canonical).toBeUndefined();
        if (change === "rebind") {
          expect(alias).toMatchObject({ session_id: "replacement-lifecycle", state: "running" });
        } else {
          expect(alias).toBeUndefined();
        }
      }
    });
  },
);

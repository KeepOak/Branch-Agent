import { spawnSync } from "node:child_process";
import { renameSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { afterEach, expect, it, vi } from "vitest";
import {
  resolveRuntimeWorkerArgv,
  resolveRuntimeWorkerUrl,
} from "../../infra/runtime-worker-url.js";
import { createDeferredCore } from "../../shared/deferred.js";
import {
  hasBranchAgentCanonicalValidation,
  invalidateBranchAgentDatabaseValidation,
} from "../../state/branch-agent-db-validation-cache.js";
import {
  closeBranchAgentDatabases,
  openBranchAgentDatabase,
} from "../../state/branch-agent-db.js";
import { runBranchAgentWriteAdmission } from "../../state/branch-agent-write-admission.js";
import { listBranchSessionRowQuarantines } from "../../state/branch-quarantine-store.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { sessionNativeProcessEntrypoints } from "./native-process-runtime.test-support.js";
import * as archiveWorker from "./session-accessor.sqlite-archive.js";
import { withSqliteCanonicalValidationWorker } from "./session-accessor.sqlite-reclamation-worker.js";
import { certifySessionCanonicalValidationPending } from "./session-canonical-validation-readiness.js";
import { hasPendingCanonicalSessionValidation } from "./session-canonical-validation.js";

afterEach(() => vi.restoreAllMocks());

function seedPendingRows(count: number, textBytes = 0, agentId = "main") {
  const options = { agentId };
  const database = openBranchAgentDatabase(options);
  const insert = database.db.prepare(`
    INSERT INTO session_nodes (session_key, current_session_id, entry_json, entry_valid, updated_at)
    VALUES (?, ?, ?, 1, 1)
  `);
  database.db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < count; index++) {
      const sessionId = `pending-${index}`;
      insert.run(
        `agent:${agentId}:${sessionId}`,
        sessionId,
        JSON.stringify({ sessionId, updatedAt: 1, lastRunError: "x".repeat(textBytes) }),
      );
    }
    database.db.exec("UPDATE session_nodes SET entry_valid = 1");
    database.db.exec("COMMIT");
  } catch (error) {
    database.db.exec("ROLLBACK");
    throw error;
  }
  return { options, database };
}

it("refuses foreign schema drift before reusing a warm canonical readiness receipt", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    const { options, database } = seedPendingRows(0);
    expect(hasBranchAgentCanonicalValidation(database)).toBe(true);
    expect(hasPendingCanonicalSessionValidation(database)).toBe(false);
    await certifySessionCanonicalValidationPending(options);
    const peer = new DatabaseSync(database.path);
    try {
      peer.exec("DROP TRIGGER session_nodes_canonical_pending_after_update");
    } finally {
      peer.close();
    }
    await expect(certifySessionCanonicalValidationPending(options)).rejects.toThrow(
      /canonical validation schema is missing or drifted.*branch doctor --fix/u,
    );
  });
});

it.each(["unchanged", "pending edit", "replacement", "revoked", "unregistered"] as const)(
  "admits only changed or revoked populated stores after a process restart (%s)",
  async (change) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const agentIds = ["main", "worker-a", "worker-b"];
      for (const agentId of agentIds) {
        const { options } = seedPendingRows(3, 0, agentId);
        await withSqliteCanonicalValidationWorker((withWorker) =>
          certifySessionCanonicalValidationPending(options, withWorker),
        );
      }
      const database = openBranchAgentDatabase({ agentId: "main" });
      const copiedPath = state.statePath("replacement.sqlite");
      if (change === "replacement") {
        database.db.prepare("VACUUM INTO ?").run(copiedPath);
      } else if (change === "pending edit") {
        database.db.exec("UPDATE session_nodes SET parent_session_key = 'agent:main:changed'");
      }
      closeBranchAgentDatabases(state.stateDir);
      if (change === "replacement") {
        renameSync(copiedPath, database.path);
      }
      const readinessUrl = resolveRuntimeWorkerUrl(
        sessionNativeProcessEntrypoints.canonicalReadiness,
      );
      const readiness = readinessUrl.href;
      const reader = resolveRuntimeWorkerUrl(sessionNativeProcessEntrypoints.databaseReadOnly).href;
      const validation = resolveRuntimeWorkerUrl(
        sessionNativeProcessEntrypoints.databaseValidation,
      ).href;
      const registry = resolveRuntimeWorkerUrl(
        sessionNativeProcessEntrypoints.databaseRegistry,
      ).href;
      const result = spawnSync(
        process.execPath,
        [
          ...resolveRuntimeWorkerArgv(readinessUrl).slice(0, -1),
          "--input-type=module",
          "--eval",
          `import { certifySessionCanonicalValidationPending } from ${JSON.stringify(readiness)};
           import { openBranchAgentDatabaseReadOnly } from ${JSON.stringify(reader)};
           import { unregisterBranchAgentDatabases } from ${JSON.stringify(registry)};
           import {
             getBranchAgentDatabaseValidation,
             invalidateBranchAgentDatabaseValidation,
           } from ${JSON.stringify(validation)};
           if (${JSON.stringify(change)} === "revoked") {
             invalidateBranchAgentDatabaseValidation(${JSON.stringify(database.path)});
           } else if (${JSON.stringify(change)} === "unregistered") {
             unregisterBranchAgentDatabases({ agentId: "main" });
           }
           let workers = 0;
           let integrityReceipts = 0;
         const observed = new Error("canonical worker requested");
           for (const agentId of ${JSON.stringify(agentIds)}) {
             try {
               await certifySessionCanonicalValidationPending({ agentId }, async () => {
                 workers++;
                 throw observed;
               });
             } catch (error) {
               if (error !== observed) throw error;
             }
             const opened = openBranchAgentDatabaseReadOnly({ agentId });
             if (!opened.found) throw new Error("fixture database missing");
             if (getBranchAgentDatabaseValidation(opened.database)) integrityReceipts++;
             opened.database.close();
           }
           process.stdout.write(JSON.stringify({ workers, integrityReceipts }));`,
        ],
        { env: { ...process.env, ...state.env }, encoding: "utf8", timeout: 30_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        workers: change === "unchanged" ? 0 : 1,
        integrityReceipts: 0,
      });
    });
  },
);

it("drains a large backlog in one retained worker while admitting foreground writes between batches", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    const { options, database } = seedPendingRows(260, 16 * 1024);
    const before = database.db
      .prepare("SELECT session_key, entry_json FROM session_nodes ORDER BY session_key")
      .all();
    const events: string[] = [];
    let foreground: Promise<void> | undefined;
    const createWorker = archiveWorker.createSqliteTranscriptArchiveWorker;
    const started = vi
      .spyOn(archiveWorker, "createSqliteTranscriptArchiveWorker")
      .mockImplementation((data) => {
        const worker = createWorker(data);
        worker.on("message", (message: { type: string }) => {
          if (message.type !== "reclaimed") {
            return;
          }
          events.push("batch");
          foreground ??= runBranchAgentWriteAdmission(options, () => {
            events.push("foreground");
          });
        });
        return worker;
      });
    await certifySessionCanonicalValidationPending(options);
    await foreground;
    expect(started).toHaveBeenCalledOnce();
    expect(events[0]).toBe("batch");
    expect(events.indexOf("foreground")).toBeGreaterThan(0);
    expect(events.lastIndexOf("batch")).toBeGreaterThan(events.indexOf("foreground"));
    expect(hasPendingCanonicalSessionValidation(database)).toBe(false);
    expect(
      database.db
        .prepare("SELECT session_key, entry_json FROM session_nodes ORDER BY session_key")
        .all(),
    ).toEqual(before);
  });
});

it.each(["row changed", "receipt revoked", "startup revoked"] as const)(
  "retains validation authority when %s during worker admission",
  async (change) => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const { options, database } = seedPendingRows(1);
      if (change === "startup revoked") {
        invalidateBranchAgentDatabaseValidation(database.path);
        expect(hasBranchAgentCanonicalValidation(database)).toBe(false);
      }
      let changed = false;
      let markerRetainedAfterFirstBatch = false;
      let firstBatchSettled = false;
      const createWorker = archiveWorker.createSqliteTranscriptArchiveWorker;
      vi.spyOn(archiveWorker, "createSqliteTranscriptArchiveWorker").mockImplementation((data) => {
        const worker = createWorker(data);
        worker.on("message", (message: { type: string }) => {
          if (message.type === "admission-request" && !changed) {
            if (change === "row changed") {
              changed = true;
              database.db.exec(
                "UPDATE session_nodes SET parent_session_key = 'agent:main:changed'",
              );
            } else if (change === "startup revoked") {
              changed = true;
            }
          } else if (message.type === "reclaimed") {
            if (change === "row changed" && !firstBatchSettled) {
              firstBatchSettled = true;
              markerRetainedAfterFirstBatch = hasPendingCanonicalSessionValidation(database);
            } else if (change === "receipt revoked") {
              invalidateBranchAgentDatabaseValidation(database.path);
            }
          }
        });
        return worker;
      });
      const assertCurrentOwner =
        change === "startup revoked"
          ? () => {
              if (changed) {
                throw new Error("startup preparation was superseded");
              }
            }
          : undefined;
      const result = certifySessionCanonicalValidationPending(
        options,
        undefined,
        assertCurrentOwner,
      );
      if (change === "row changed") {
        await result;
      } else {
        await expect(result).rejects.toThrow(
          {
            "receipt revoked": "database owner is no longer current",
            "startup revoked": "startup preparation was superseded",
          }[change],
        );
      }
      if (change !== "receipt revoked") {
        expect(changed).toBe(true);
      }
      if (change === "row changed") {
        // The changed bytes were never certified; the next batch set the invalid row aside.
        expect(markerRetainedAfterFirstBatch).toBe(true);
        expect(hasPendingCanonicalSessionValidation(database)).toBe(false);
        expect(database.db.prepare("SELECT parent_session_key FROM session_nodes").get()).toEqual({
          parent_session_key: null,
        });
        expect(
          listBranchSessionRowQuarantines(database.path).map((entry) => [
            entry.sessionKey,
            entry.row.parent_session_key,
          ]),
        ).toEqual([["agent:main:pending-0", "agent:main:changed"]]);
      } else {
        if (change === "startup revoked") {
          expect(hasPendingCanonicalSessionValidation(database)).toBe(true);
        }
        expect(hasBranchAgentCanonicalValidation(database)).toBe(false);
      }
    });
  },
);

it.each([false, true])(
  "fully validates a copied populated store whose pending table is clean (invalid row: %s)",
  async (invalid) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const { options, database } = seedPendingRows(130);
      await certifySessionCanonicalValidationPending(options);
      const copiedPath = state.statePath("copied-agent.sqlite");
      database.db.prepare("VACUUM INTO ?").run(copiedPath);
      if (invalid) {
        const imported = new DatabaseSync(copiedPath);
        try {
          // Untrusted copied derived state cannot certify its own source contents.
          imported.exec(
            "UPDATE session_nodes SET parent_session_key = 'agent:main:changed' WHERE session_key = 'agent:main:pending-0'",
          );
          imported.exec("DELETE FROM session_canonical_validation_pending");
        } finally {
          imported.close();
        }
      }
      const copiedOptions = { ...options, path: copiedPath };
      const copied = openBranchAgentDatabase(copiedOptions);
      expect(hasPendingCanonicalSessionValidation(copied)).toBe(false);
      expect(hasBranchAgentCanonicalValidation(copied)).toBe(false);
      await certifySessionCanonicalValidationPending(copiedOptions);
      expect(hasBranchAgentCanonicalValidation(copied)).toBe(true);
      expect(hasPendingCanonicalSessionValidation(copied)).toBe(false);
      // An invalid row no longer refuses the store: its original is kept, then it is rewritten.
      expect(listBranchSessionRowQuarantines(copiedPath).map((entry) => entry.sessionKey)).toEqual(
        invalid ? ["agent:main:pending-0"] : [],
      );
      expect(
        copied.db
          .prepare("SELECT parent_session_key FROM session_nodes WHERE session_key = ?")
          .get("agent:main:pending-0"),
      ).toEqual({ parent_session_key: null });
    });
  },
);

it("forces a fresh worker to revalidate a canonical receipt revoked by its parent", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    const { options, database } = seedPendingRows(1);
    await withSqliteCanonicalValidationWorker((withWorker) =>
      certifySessionCanonicalValidationPending(options, withWorker),
    );
    database.db.exec(`
      UPDATE session_nodes SET parent_session_key = 'agent:main:changed';
      DELETE FROM session_canonical_validation_pending;
    `);
    invalidateBranchAgentDatabaseValidation(database.path);
    await withSqliteCanonicalValidationWorker((withWorker) =>
      certifySessionCanonicalValidationPending(options, withWorker),
    );
    // The fresh worker revalidated every row instead of trusting the revoked receipt.
    expect(hasPendingCanonicalSessionValidation(database)).toBe(false);
    expect(listBranchSessionRowQuarantines(database.path).map((entry) => entry.sessionKey)).toEqual(
      ["agent:main:pending-0"],
    );
  });
});

it("shares active runtime certification without retaining success or failure", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    const { options, database } = seedPendingRows(1);
    const entered = createDeferredCore();
    let holdNext = false;
    let resume: (() => void) | undefined;
    const jobs = vi.fn();
    const createWorker = archiveWorker.createSqliteTranscriptArchiveWorker;
    vi.spyOn(archiveWorker, "createSqliteTranscriptArchiveWorker").mockImplementation((data) => {
      const worker = createWorker(data);
      const post = worker.postMessage.bind(worker);
      vi.spyOn(worker, "postMessage").mockImplementation((message: unknown, ...args) => {
        if (isRecord(message) && message.type === "canonical-validation") {
          jobs();
          if (holdNext) {
            holdNext = false;
            resume = () => post(message, ...args);
            entered.resolve();
            return;
          }
        }
        post(message, ...args);
      });
      return worker;
    });
    await certifySessionCanonicalValidationPending(options);
    jobs.mockClear();
    const dirty = () =>
      database.db.exec(
        "UPDATE session_nodes SET entry_json = entry_json || ' '; UPDATE session_nodes SET entry_valid = 1",
      );
    dirty();
    holdNext = true;
    const pending = [certifySessionCanonicalValidationPending(options)];
    try {
      await entered.promise;
      pending.push(
        ...Array.from({ length: 3 }, () => certifySessionCanonicalValidationPending(options)),
      );
      resume?.();
      resume = undefined;
      await Promise.all(pending);
      expect(hasPendingCanonicalSessionValidation(database)).toBe(false);
      expect(jobs).toHaveBeenCalledOnce();
      dirty();
      await certifySessionCanonicalValidationPending(options);
      expect(hasPendingCanonicalSessionValidation(database)).toBe(false);
      expect(jobs).toHaveBeenCalledTimes(2);
      // A non-canonical key still needs Doctor's merge, so it keeps refusing readiness.
      database.db.exec(
        "UPDATE session_nodes SET session_key = 'agent:main:pending-0 ' WHERE session_key = 'agent:main:pending-0'",
      );
      const failures = await Promise.allSettled(
        Array.from({ length: 3 }, () => certifySessionCanonicalValidationPending(options)),
      );
      expect(failures).toEqual(
        Array.from({ length: 3 }, () => ({
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringContaining("non-canonical persisted row"),
          }),
        })),
      );
      expect(jobs).toHaveBeenCalledTimes(3);
      expect(hasPendingCanonicalSessionValidation(database)).toBe(true);
      database.db.exec(
        "UPDATE session_nodes SET session_key = 'agent:main:pending-0' WHERE session_key = 'agent:main:pending-0 '",
      );
      await certifySessionCanonicalValidationPending(options);
      expect(hasPendingCanonicalSessionValidation(database)).toBe(false);
      expect(jobs).toHaveBeenCalledTimes(4);
    } finally {
      resume?.();
      await Promise.allSettled(pending);
    }
  });
});

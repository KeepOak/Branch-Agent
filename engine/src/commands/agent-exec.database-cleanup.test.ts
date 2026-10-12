import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  deleteSessionEntryLifecycle,
  replaceSessionEntry,
} from "../config/sessions/session-accessor.js";
import { registerSqliteAuditRecordAsync } from "../infra/sqlite-audit-record-store.async.js";
import { createSqliteAuditRecordStore } from "../infra/sqlite-audit-record-store.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  closeBranchAgentDatabaseByPathAsync,
  withBranchAgentDatabaseAsync,
} from "../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseByPathAsync,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { runAgentExecWithMock } from "./agent-exec.test-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
  "closes temporary databases before removal and preserves independent handles (run error: %s)",
  async (runError) => {
    const independentRoot = tempDirs.make("branch-agent-exec-independent-");
    const independent = openBranchStateDatabase({
      env: { BRANCH_STATE_DIR: independentRoot },
    });
    const previousStateDir = process.env.BRANCH_STATE_DIR;
    const runtime: RuntimeEnv = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    let runStateDir: string | undefined;
    let agentPath: string | undefined;
    let statePath: string | undefined;
    const handles: DatabaseSync[] = [];
    const remove = fs.rm.bind(fs);
    const removed = vi.spyOn(fs, "rm").mockImplementation(async (pathname, options) => {
      if (pathname === runStateDir) {
        // Refuse the destructive step if the command has not settled native ownership.
        expect(handles).toHaveLength(2);
        expect(handles.every((handle) => !handle.isOpen)).toBe(true);
        expect(independent.db.isOpen).toBe(true);
      }
      await remove(pathname, options);
    });
    try {
      const result = await runAgentExecWithMock(
        "inspect",
        { authEnvOnly: true },
        runtime,
        async () => {
          runStateDir = process.env.BRANCH_STATE_DIR;
          const shared = openBranchStateDatabase();
          handles.push(shared.db);
          statePath = shared.path;
          await withBranchAgentDatabaseAsync({ agentId: "main" }, (database) => {
            handles.push(database.db);
            agentPath = database.path;
          });
          const storePath = path.join(runStateDir!, "agents", "main", "sessions", "sessions.json");
          const sessionKey = "agent:main:exec-cleanup";
          await replaceSessionEntry(
            { sessionKey, storePath },
            { sessionId: "exec-cleanup", updatedAt: 1 },
          );
          const deletion = await deleteSessionEntryLifecycle({
            agentId: "main",
            storePath,
            target: { canonicalKey: sessionKey, storeKeys: [sessionKey] },
            archiveTranscript: false,
            deleteTranscriptWithoutArchive: true,
          });
          expect(deletion.deleted).toBe(true);
          await registerSqliteAuditRecordAsync(
            { scope: "agent-exec-cleanup", maxEntries: 1 },
            { key: "completed", value: "synthetic", createdAt: 1 },
          );
          expect(
            createSqliteAuditRecordStore({ scope: "agent-exec-cleanup", maxEntries: 1 }).entries(),
          ).toEqual([{ key: "completed", value: "synthetic", createdAt: 1 }]);
          if (runError) {
            throw new Error("Synthetic run failure");
          }
          return { payloads: [{ text: "done" }], meta: { durationMs: 1 } };
        },
      );
      expect(result.exitCode).toBe(runError ? 1 : 0);
      expect(runtime.error).not.toHaveBeenCalledWith(expect.stringContaining("cleanup failed"));
      expect(process.env.BRANCH_STATE_DIR).toBe(previousStateDir);
      expect(runStateDir).toBeDefined();
      await expect(fs.stat(runStateDir!)).rejects.toMatchObject({ code: "ENOENT" });
      expect(independent.db.prepare("SELECT 1 AS value").get()).toEqual({ value: 1 });
    } finally {
      removed.mockRestore();
      if (agentPath) {
        await closeBranchAgentDatabaseByPathAsync(agentPath);
      }
      if (statePath) {
        await closeBranchStateDatabaseByPathAsync(statePath);
      }
      await closeBranchStateDatabaseByPathAsync(independent.path);
      if (runStateDir) {
        await remove(runStateDir, { recursive: true, force: true });
      }
    }
  },
);

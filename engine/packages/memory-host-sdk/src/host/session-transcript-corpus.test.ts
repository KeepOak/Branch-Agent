import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { StatementSync } from "node:sqlite";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
} from "branch/plugin-sdk/runtime-config-snapshot";
import { describe, expect, it, vi } from "vitest";
import { upsertSessionEntryCore } from "../../../../src/config/sessions/session-accessor.js";
import { closeBranchAgentDatabasesAsync } from "../../../../src/state/branch-agent-db-lifecycle.js";
import { registerBranchAgentDatabase } from "../../../../src/state/branch-agent-db-registry.js";
import { getBranchAgentDatabaseIfOpen } from "../../../../src/state/branch-agent-db.js";
import { tableExists } from "../../../../src/state/branch-state-db-schema-helpers.js";
import { withBranchTestState } from "../../../../src/test-utils/branch-test-state.js";
import { createDeferred } from "../../../../test/helpers/promise.js";
import { observeSqliteReadSql } from "../../../../test/helpers/sqlite-statement-execution-counter.js";
import { listSessionTranscriptCorpusEntriesForAgent } from "./session-files.js";
import { listSessionTranscriptCorpusEntriesForAgentSync } from "./session-transcript-corpus.js";

function pauseDirectoryDiscovery(sessionsDir: string) {
  const entered = createDeferred();
  const release = createDeferred();
  const realpath = fs.realpath.bind(fs);
  let paused = false;
  const realpathSpy = vi.spyOn(fs, "realpath").mockImplementation(async (file) => {
    if (!paused && file === sessionsDir) {
      paused = true;
      entered.resolve();
      await release.promise;
    }
    return realpath(file);
  });
  return { entered, release, realpathSpy };
}

describe("listSessionTranscriptCorpusEntriesForAgent", () => {
  it.each([
    { includeContentRevision: true, archiveTablePresent: true, readOnly: false },
    { includeContentRevision: false, archiveTablePresent: true, readOnly: false },
    { includeContentRevision: false, archiveTablePresent: false, readOnly: false },
    { includeContentRevision: false, archiveTablePresent: true, readOnly: true },
    { includeContentRevision: false, archiveTablePresent: false, readOnly: true },
  ])(
    "preserves corpus selection with content revisions $includeContentRevision and archive table $archiveTablePresent (readOnly: $readOnly)",
    async ({ includeContentRevision, archiveTablePresent, readOnly }) => {
      await withBranchTestState({ scenario: "minimal" }, async (state) => {
        const sessionsDir = state.sessionsDir();
        await fs.mkdir(sessionsDir, { recursive: true });
        const archivePath = path.join(
          sessionsDir,
          "cron-thread.jsonl.deleted.2026-02-16T22-27-33.000Z",
        );
        await fs.writeFile(archivePath, "retained transcript");
        await fs.writeFile(path.join(sessionsDir, "loose.jsonl"), "unowned live file");
        await upsertSessionEntryCore(
          {
            sessionKey: "agent:main:cron:job-1:run:run-1",
            storePath: path.join(sessionsDir, "sessions.json"),
          },
          { sessionId: "cron-thread", updatedAt: 1 },
        );
        const { db } = getBranchAgentDatabaseIfOpen({ agentId: "main", env: state.env })!;
        if (!archiveTablePresent) {
          db.exec("DROP TABLE session_transcript_archives");
        }
        expect(tableExists(db, "session_transcript_archives")).toBe(archiveTablePresent);

        const options = { includeContentRevision, readOnly };
        const expected = listSessionTranscriptCorpusEntriesForAgentSync("main", options);
        const actual = await listSessionTranscriptCorpusEntriesForAgent("main", options);

        expect(actual).toEqual(expected);
        expect(actual).toHaveLength(2);
        const archive = actual.find((entry) => entry.artifactKind === "archive-artifact");
        expect(archive).toMatchObject({
          sessionFile: archivePath,
          sessionId: "cron-thread",
          generatedByCronRun: true,
          sessionKind: "cron",
        });
        expect(archive?.contentRevision !== undefined).toBe(includeContentRevision);
        expect(tableExists(db, "session_transcript_archives")).toBe(archiveTablePresent);
      });
    },
  );

  it.each([
    { readOnly: false, includeRetainedSqlite: true },
    { readOnly: true, includeRetainedSqlite: true },
    { readOnly: true, includeRetainedSqlite: false },
  ])(
    "classifies prompt-rich entries without decoding saved prompts (readOnly: $readOnly, retained: $includeRetainedSqlite)",
    async ({ readOnly, includeRetainedSqlite }) => {
      await withBranchTestState({ scenario: "minimal" }, async (state) => {
        const sessionKey = "agent:main:corpus-metadata";
        const storePath = path.join(state.sessionsDir(), "sessions.json");
        const persisted = await upsertSessionEntryCore(
          { sessionKey, storePath },
          {
            sessionId: "corpus-metadata",
            updatedAt: 10,
            heartbeatIsolatedBaseSessionKey: "agent:main:main",
            skillsSnapshot: { prompt: "unused corpus prompt ".repeat(256), skills: [] },
            systemPromptReport: {
              source: "run",
              generatedAt: 1,
              systemPrompt: { chars: 1, projectContextChars: 0, nonProjectContextChars: 1 },
              injectedWorkspaceFiles: [],
              skills: { promptChars: 0, entries: [] },
              tools: { listChars: 0, schemaChars: 0, entries: [] },
            },
          },
        );

        const parse = vi.spyOn(JSON, "parse");
        const observed = observeSqliteReadSql(StatementSync.prototype);
        const isSummaryRead = (sql: string) =>
          /^\s*select\b[\s\S]*\bfrom\s+["`]?session_nodes\b/i.test(sql) &&
          /\bentry_json\b|\*/i.test(sql.split(/\bfrom\b/i)[0]!);
        try {
          const { db } = getBranchAgentDatabaseIfOpen({ agentId: "main", env: state.env })!;
          expect(
            db.prepare('select "session_key", "entry_json" from "session_nodes" where 0').all(),
          ).toEqual([]);
          expect(observed.queries.filter(isSummaryRead)).toHaveLength(1);
          // A cold reader must perform the real projection, not reuse a warm host snapshot.
          await closeBranchAgentDatabasesAsync(state.stateDir);
          observed.queries.length = 0;
          parse.mockClear();
          const entries = await listSessionTranscriptCorpusEntriesForAgent("main", {
            includeContentRevision: false,
            includeRetainedSqlite,
            readOnly,
          });
          expect(entries).toEqual([
            {
              agentId: "main",
              artifactKind: "active-session",
              sessionFile: sessionKey,
              sessionId: "corpus-metadata",
              sessionKey,
              sessionKind: "heartbeat",
              storePath,
              transcriptSource: "sqlite",
              updatedAtMs: persisted?.updatedAt,
            },
          ]);
          if (readOnly && !includeRetainedSqlite) {
            expect(observed.queries.filter(isSummaryRead)).toEqual([]);
          }
          const decodedEntries = parse.mock.calls.filter(([json]) =>
            json.includes('"sessionId":"corpus-metadata"'),
          );
          expect(
            decodedEntries.every(
              ([json]) =>
                !json.includes('"skillsSnapshot"') && !json.includes('"systemPromptReport"'),
            ),
          ).toBe(true);
        } finally {
          parse.mockRestore();
          observed.restore();
        }
      });
    },
  );

  it("preserves admitted metadata parsing when readonly corpus discovery crosses the worker", async () => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const sessionKey = "agent:main:admitted-corpus";
      const sessionId = "admitted-corpus";
      const storePath = path.join(state.sessionsDir(), "sessions.json");
      const persisted = await upsertSessionEntryCore(
        { sessionKey, storePath },
        { sessionId, updatedAt: 10 },
      );
      const { db } = getBranchAgentDatabaseIfOpen({ agentId: "main", env: state.env })!;
      const options = { readOnly: true, includeContentRevision: false };
      const expected = {
        agentId: "main",
        artifactKind: "active-session",
        sessionFile: sessionKey,
        sessionId,
        sessionKey,
        sessionKind: "heartbeat",
        storePath,
        transcriptSource: "sqlite",
        updatedAtMs: persisted?.updatedAt,
      };
      expect(listSessionTranscriptCorpusEntriesForAgentSync("main", options)).toEqual([
        { ...expected, sessionKind: "interactive" },
      ]);

      // Raw metadata edits preserve the original admitted reader's parsing contract.
      db.prepare(
        "UPDATE session_nodes SET entry_json = json_set(entry_json, '$.heartbeatIsolatedBaseSessionKey', ?) WHERE session_key = ?",
      ).run("agent:main:main", sessionKey);
      const validity = () =>
        db.prepare("SELECT entry_valid FROM session_nodes WHERE session_key = ?").get(sessionKey)
          ?.entry_valid;
      expect(validity()).toBe(0);
      expect(listSessionTranscriptCorpusEntriesForAgentSync("main", options)).toEqual([expected]);
      expect(validity()).toBe(0);

      await expect(listSessionTranscriptCorpusEntriesForAgent("main", options)).resolves.toEqual([
        expected,
      ]);
      expect(validity()).toBe(0);
      expect(db.isOpen).toBe(true);
      expect(getBranchAgentDatabaseIfOpen({ agentId: "main", env: state.env })?.db === db).toBe(
        true,
      );
      await closeBranchAgentDatabasesAsync(state.stateDir);
      expect(db.isOpen).toBe(false);
      await expect(listSessionTranscriptCorpusEntriesForAgent("main", options)).rejects.toThrow(
        "branch doctor --fix",
      );
    });
  });

  it.each([false, true])(
    "yields during filesystem discovery while retaining its store and reading fresh entries (readOnly: %s)",
    async (readOnly) => {
      await withBranchTestState({ scenario: "minimal" }, async (state) => {
        const sessionsDir = state.statePath("custom-sessions");
        const storePath = path.join(sessionsDir, "sessions.json");
        await fs.mkdir(sessionsDir, { recursive: true });
        await state.writeConfig({ session: { store: storePath } });
        clearRuntimeConfigSnapshot();
        clearConfigCache();
        await upsertSessionEntryCore(
          { sessionKey: "agent:main:chat:original", storePath },
          { sessionId: "original", updatedAt: 1 },
        );
        const { entered, release, realpathSpy } = pauseDirectoryDiscovery(sessionsDir);
        const listing = listSessionTranscriptCorpusEntriesForAgent("main", {
          readOnly,
          ...(readOnly ? { includeContentRevision: false } : {}),
        });
        try {
          await expect(
            Promise.race([entered.promise.then(() => "waiting"), listing.then(() => "completed")]),
          ).resolves.toBe("waiting");
          await new Promise<void>((resolve) => {
            setImmediate(resolve);
          });
          await state.writeConfig({
            session: { store: state.statePath("replacement", "sessions.json") },
          });
          clearRuntimeConfigSnapshot();
          clearConfigCache();
          await upsertSessionEntryCore(
            { sessionKey: "agent:main:chat:fresh", storePath },
            { sessionId: "fresh", updatedAt: 2 },
          );
          release.resolve();

          const entries = await listing;
          expect(entries.map((entry) => entry.sessionId).toSorted()).toEqual(["fresh", "original"]);
          expect(entries.every((entry) => entry.storePath === storePath)).toBe(true);
        } finally {
          release.resolve();
          await listing.finally(() => realpathSpy.mockRestore());
        }
      });
    },
  );

  it.each([false, true])(
    "retains the custom store's registry environment while discovery is pending (readOnly: %s)",
    async (readOnly) => {
      await withBranchTestState({ scenario: "minimal" }, async (state) => {
        const sessionsDir = state.statePath("custom-sessions");
        const storePath = path.join(sessionsDir, "sessions.json");
        const unsuffixedDatabase = path.join(sessionsDir, "branch-agent.sqlite");
        await fs.mkdir(sessionsDir, { recursive: true });
        await state.writeConfig({ session: { store: storePath } });
        clearRuntimeConfigSnapshot();
        clearConfigCache();
        registerBranchAgentDatabase({ agentId: "ops", path: unsuffixedDatabase });
        const { entered, release, realpathSpy } = pauseDirectoryDiscovery(sessionsDir);
        const listing = listSessionTranscriptCorpusEntriesForAgent("main", {
          readOnly,
          ...(readOnly ? { includeContentRevision: false } : {}),
        });
        try {
          await expect(
            Promise.race([entered.promise.then(() => "waiting"), listing.then(() => "completed")]),
          ).resolves.toBe("waiting");
          Reflect.set(process.env, "BRANCH_STATE_DIR", state.statePath("replacement-state"));
          release.resolve();

          await expect(listing).resolves.toEqual([]);
          expect(fsSync.existsSync(path.join(sessionsDir, "branch-agent.main.sqlite"))).toBe(
            !readOnly,
          );
          expect(fsSync.existsSync(unsuffixedDatabase)).toBe(false);
          if (readOnly) {
            expect(fsSync.existsSync(state.statePath("replacement-state"))).toBe(false);
          }
        } finally {
          release.resolve();
          await listing.finally(() => {
            Reflect.set(process.env, "BRANCH_STATE_DIR", state.stateDir);
            realpathSpy.mockRestore();
          });
        }
      });
    },
  );
});

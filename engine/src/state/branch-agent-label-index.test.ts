import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
  BRANCH_AGENT_SCHEMA_VERSION,
  runBranchAgentWriteTransaction,
} from "./branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

it.each(["fresh", "missing", "drifted"])(
  "serves indexed label lookups after opening a %s label index without changing session data",
  (kind) => {
    const options = {
      agentId: "main",
      env: { BRANCH_STATE_DIR: tempDirs.make("agent-label-index-") },
    };
    let database = openBranchAgentDatabase(options);
    runBranchAgentWriteTransaction((db) => {
      for (const [suffix, fields] of [
        ["a", { label: "Shared" }],
        ["b", { label: "Shared", archivedAt: 2 }],
        ["case", { label: "shared" }],
        ["empty", { label: "" }],
        ["none", {}],
      ] as const) {
        writeSessionEntry(db, `agent:main:label-${suffix}`, {
          sessionId: `label-${suffix}`,
          updatedAt: 1,
          ...fields,
        });
      }
    }, options);
    const readRows = () =>
      database.db.prepare("SELECT * FROM session_nodes ORDER BY session_key").all();
    const before = readRows();
    if (kind !== "fresh") {
      const pathname = database.path;
      closeBranchAgentDatabasesForTest();
      const previous = new DatabaseSync(pathname);
      try {
        previous.exec("DROP INDEX IF EXISTS idx_agent_session_nodes_label;");
        if (kind === "drifted") {
          previous.exec(
            "CREATE INDEX idx_agent_session_nodes_label ON session_nodes(label, session_key) WHERE archived_at IS NULL;",
          );
        }
      } finally {
        previous.close();
      }
      database = openBranchAgentDatabase(options);
    }

    expect(readRows()).toEqual(before);
    const query = "SELECT session_key FROM session_nodes WHERE label = ? ORDER BY session_key";
    expect(database.db.prepare(query).all("Shared")).toEqual([
      { session_key: "agent:main:label-a" },
      { session_key: "agent:main:label-b" },
    ]);
    expect(database.db.prepare(query).all("shared")).toEqual([
      { session_key: "agent:main:label-case" },
    ]);
    expect(database.db.prepare(query).all("")).toEqual([]);
    expect(database.db.prepare(query).all("missing")).toEqual([]);
    expect(database.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all("Shared")).toEqual([
      expect.objectContaining({
        detail: expect.stringMatching(/^SEARCH session_nodes USING COVERING INDEX /u),
      }),
    ]);
    expect(database.db.prepare("PRAGMA user_version").get()).toEqual({
      user_version: BRANCH_AGENT_SCHEMA_VERSION,
    });
    const schemaVersion = database.db.prepare("PRAGMA schema_version").get();
    closeBranchAgentDatabasesForTest();
    database = openBranchAgentDatabase(options);
    expect(database.db.prepare("PRAGMA schema_version").get()).toEqual(schemaVersion);
    expect(readRows()).toEqual(before);
  },
);

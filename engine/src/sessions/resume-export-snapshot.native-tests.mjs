import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const file = new URL("../config/sessions/session-accessor.sqlite-read.ts", import.meta.url);
const body = readFileSync(file, "utf8").match(/^export function readTranscriptExportSnapshotReadOnlySync\([\s\S]*?^\}/m)?.[0];
assert.ok(body, "Extract the actual native readonly export snapshot function");
const javascript = stripTypeScriptTypes(body).replace(/^export /, "");
const scope = { agentId: "fixture-agent", sessionId: "fixture-session", sessionKey: "agent:fixture-agent:non-main", storePath: "fixture" };

function fixture(callback) {
  const parent = path.join(tmpdir(), "Codex-session-files", "resume-sessions-20261003");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(path.join(parent, "snapshot-"));
  const filename = path.join(directory, "fixture.sqlite");
  const writer = new DatabaseSync(filename);
  writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE fixture_state (leaf TEXT); CREATE TABLE fixture_events (seq INTEGER PRIMARY KEY, event TEXT); INSERT INTO fixture_state VALUES ('old');");
  writer.prepare("INSERT INTO fixture_events VALUES (?, ?)").run(1, JSON.stringify({ id: "old" }));
  try { callback({ filename, writer }); } finally { writer.close(); rmSync(directory, { recursive: true, force: true }); }
}

function nativeFunction({ filename, writer }, options = {}) {
  const calls = []; let reader;
  const owners = {
    resolveSqliteTranscriptReadScope: value => { calls.push(["scope", value]); return value; },
    toDatabaseOptions: value => value,
    withBranchAgentDatabaseReadOnly: (read, target) => {
      assert.deepEqual(target, scope); reader = new DatabaseSync(filename, { readOnly: true });
      try { return { found: true, value: read({ db: reader, path: filename }) }; } finally { reader.close(); }
    },
    runSqliteDeferredTransactionSync: (db, read) => {
      assert.equal(db, reader); db.exec("BEGIN DEFERRED");
      try { const result = read(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    resolveSqliteSessionTranscriptReadFence: value => { assert.equal(value.database.db, reader); return undefined; },
    readCurrentProjectionSnapshot: (database, target, read) => {
      calls.push(["projection", target]); assert.equal(database.db, reader); assert.ok(reader.isTransaction);
      if (options.unavailable) return { kind: "unavailable" };
      const leaf = reader.prepare("SELECT leaf FROM fixture_state").get().leaf;
      if (options.concurrentWrite) {
        writer.exec("BEGIN IMMEDIATE; UPDATE fixture_state SET leaf='new';");
        writer.prepare("INSERT INTO fixture_events VALUES (?, ?)").run(2, JSON.stringify({ id: "new", parentId: "old" }));
        writer.exec("COMMIT");
      }
      return { kind: "value", value: read({ state: { leafEventId: leaf } }) };
    },
    loadTranscriptEventsFromDatabase: database => {
      calls.push(["events"]); assert.equal(database.db, reader); assert.ok(reader.isTransaction);
      assert.throws(() => reader.exec("UPDATE fixture_state SET leaf='wrong'"), /readonly/i);
      return reader.prepare("SELECT event FROM fixture_events ORDER BY seq").all().map(row => JSON.parse(row.event));
    },
    readTranscriptStatsFromDatabase: database => ({ eventCount: database.db.prepare("SELECT COUNT(*) AS count FROM fixture_events").get().count }),
    SessionTranscriptProjectionUnavailableError: class extends Error {},
  };
  const operation = new Function(...Object.keys(owners), `${javascript}; return readTranscriptExportSnapshotReadOnlySync;`)(...Object.values(owners));
  return { operation, calls };
}

test("actual native export snapshot pairs old leaf and events across a concurrent WAL writer", () => fixture(state => {
  const { operation } = nativeFunction(state, { concurrentWrite: true });
  const snapshot = operation(scope, { includeActiveLeaf: true });
  assert.equal(snapshot.activeLeafEntryId, "old"); assert.deepEqual(snapshot.events, [{ id: "old" }]);
  assert.equal(snapshot.stats.eventCount, 1);
  assert.equal(state.writer.prepare("SELECT leaf FROM fixture_state").get().leaf, "new");
}));
test("default native export snapshot preserves prior shape and does not acquire projection ownership", () => fixture(state => {
  const { operation, calls } = nativeFunction(state);
  const snapshot = operation(scope); assert.ok(!("activeLeafEntryId" in snapshot));
  assert.ok(!calls.some(([name]) => name === "projection"));
}));
test("unavailable native projection fails before raw events and never acquires a writer", () => fixture(state => {
  const { operation, calls } = nativeFunction(state, { unavailable: true });
  assert.throws(() => operation(scope, { includeActiveLeaf: true }));
  assert.ok(!calls.some(([name]) => name === "events"));
  assert.equal(state.writer.prepare("SELECT leaf FROM fixture_state").get().leaf, "old");
}));

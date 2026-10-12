import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import { closeBranchStateDatabaseForTest, openBranchStateDatabase } from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => closeBranchStateDatabaseForTest());

it("upgrades a v20 shared-state database to v21 rooms without changing existing rows", () => {
  const options = { env: { BRANCH_STATE_DIR: tempDirs.make("rooms-v20-upgrade-") } };
  const path = openBranchStateDatabase(options).path;
  closeBranchStateDatabaseForTest();

  // Follow the existing shared-state upgrade fixtures: remove only the new
  // physical schema and publish the former user/content version before reopening.
  const v20 = new DatabaseSync(path);
  const rows = [
    { state_key: "rooms-upgrade.alpha", value_json: '{"name":"alpha"}', updated_at_ms: 17 },
    { state_key: "rooms-upgrade.beta", value_json: '{"name":"beta"}', updated_at_ms: 23 },
  ];
  try {
    const insert = v20.prepare(
      "INSERT INTO config_machine_state(state_key,value_json,updated_at_ms) VALUES (?,?,?)",
    );
    for (const row of rows) {
      insert.run(row.state_key, row.value_json, row.updated_at_ms);
    }
    v20.exec(`
      DROP TABLE room_events;
      DROP TABLE room_members;
      DROP TABLE rooms;
      PRAGMA user_version = 20;
      UPDATE schema_meta SET schema_version = 20 WHERE meta_key = 'primary';
    `);
    expect(v20.prepare("PRAGMA user_version").get()).toEqual({ user_version: 20 });
    expect(
      v20.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'room%'").all(),
    ).toEqual([]);
  } finally {
    v20.close();
  }

  const { db } = openBranchStateDatabase(options);
  expect(db.prepare("PRAGMA user_version").get()).toEqual({
    user_version: BRANCH_STATE_SCHEMA_VERSION,
  });
  expect(db.prepare("SELECT schema_version FROM schema_meta WHERE meta_key='primary'").get()).toEqual({
    schema_version: BRANCH_STATE_SCHEMA_VERSION,
  });
  expect(
    db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('rooms','room_members','room_events') ORDER BY name",
    ).all(),
  ).toEqual([
    { name: "room_events" },
    { name: "room_members" },
    { name: "rooms" },
  ]);
  expect(
    db.prepare(
      "SELECT state_key,value_json,updated_at_ms FROM config_machine_state WHERE state_key LIKE 'rooms-upgrade.%' ORDER BY state_key",
    ).all(),
  ).toEqual(rows);
});

import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { ensureCronRunReceiptSchema } from "../cron/store/run-receipt-store.js";
import { preflightBranchDatabaseSchemas } from "./branch-database-preflight.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
  repairBranchStateDatabaseSchema,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => closeBranchStateDatabaseForTest());

function legacyReceiptDatabase() {
  const options = { env: { BRANCH_STATE_DIR: tempDirs.make("cron-delivery-migration-") } };
  const database = openBranchStateDatabase(options);
  ensureCronRunReceiptSchema(database.db);
  const databasePath = database.path;
  closeBranchStateDatabaseForTest();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    ALTER TABLE cron_run_receipts DROP COLUMN delivery_attempt_state;
    INSERT INTO cron_run_receipts (
      receipt_id, store_key, job_id, config_revision, agent_id, status,
      owner_pid, owner_start_time, started_at_ms
    ) VALUES ('legacy-receipt', '/fixture/cron', 'legacy-job', 'revision', 'main', 'running', 123, 1, 2);
    PRAGMA user_version = 19;
    UPDATE schema_meta SET schema_version = 19;
  `);
  legacy.close();
  return { options, databasePath };
}

it.each(["runtime open", "doctor repair"] as const)(
  "%s preserves legacy receipt uncertainty and refuses a schema-19 downgrade",
  async (entry) => {
    const { options } = legacyReceiptDatabase();
    if (entry === "doctor repair") {
      expect(repairBranchStateDatabaseSchema(options).warnings).toEqual([]);
    }
    const { db } = openBranchStateDatabase(options);
    expect(
      db.prepare("SELECT receipt_id, status, delivery_attempt_state FROM cron_run_receipts").all(),
    ).toEqual([
      { receipt_id: "legacy-receipt", status: "running", delivery_attempt_state: "unknown" },
    ]);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 20 });
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    db.exec("UPDATE cron_run_receipts SET delivery_attempt_state = 'started'");
    closeBranchStateDatabaseForTest();
    expect(
      openBranchStateDatabase(options)
        .db.prepare("SELECT delivery_attempt_state FROM cron_run_receipts")
        .get(),
    ).toEqual({ delivery_attempt_state: "started" });
    closeBranchStateDatabaseForTest();
    const preflight = await preflightBranchDatabaseSchemas({
      env: options.env,
      scope: "state",
      supportedVersions: { state: 19, agent: 23 },
    });
    expect(preflight.incompatible).toEqual([
      expect.objectContaining({ kind: "state", foundVersion: 20, supportedVersion: 19 }),
    ]);
  },
);

it("rolls receipt migration back with schema publication failure", () => {
  const { options, databasePath } = legacyReceiptDatabase();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`CREATE TRIGGER refuse_schema_publication BEFORE UPDATE ON schema_meta
    BEGIN SELECT RAISE(ABORT, 'fixture publication refusal'); END;`);
  legacy.close();
  expect(() => openBranchStateDatabase(options)).toThrow("fixture publication refusal");
  const after = new DatabaseSync(databasePath, { readOnly: true });
  try {
    expect(after.prepare("PRAGMA user_version").get()).toEqual({ user_version: 19 });
    expect(after.prepare("SELECT receipt_id, status FROM cron_run_receipts").all()).toEqual([
      { receipt_id: "legacy-receipt", status: "running" },
    ]);
    expect(
      after
        .prepare(
          "SELECT 1 FROM pragma_table_info('cron_run_receipts') WHERE name = 'delivery_attempt_state'",
        )
        .get(),
    ).toBeUndefined();
  } finally {
    after.close();
  }
});

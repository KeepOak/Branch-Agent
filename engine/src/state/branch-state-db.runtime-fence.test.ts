import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setImmediate"] });
});

afterEach(() => {
  closeBranchStateDatabaseForTest();
  vi.useRealTimers();
});

describe("shared state runtime schema fence", () => {
  it("latches a newer schema committed under an open cached handle", () => {
    const options = { env: { BRANCH_STATE_DIR: tempDirs.make("branch-runtime-schema-") } };
    const initial = openBranchStateDatabase(options);
    const external = new DatabaseSync(initial.path);
    try {
      external.exec(`
        BEGIN IMMEDIATE;
        PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION + 1};
        UPDATE schema_meta
           SET schema_version = ${BRANCH_STATE_SCHEMA_VERSION + 1},
               app_version = 'future-build'
         WHERE meta_key = 'primary';
        COMMIT;
      `);
    } finally {
      external.close();
    }

    vi.runOnlyPendingTimers();

    let failure: unknown;
    try {
      openBranchStateDatabase(options);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: "SqliteSchemaVersionError",
      message: expect.stringContaining(
        `uses newer schema version ${BRANCH_STATE_SCHEMA_VERSION + 1}`,
      ),
    });
    expect(initial.db.isOpen).toBe(false);
    expect(() => openBranchStateDatabase(options)).toThrow(failure);
  });

  it("retains the cached handle after a compatible external data commit", () => {
    const options = { env: { BRANCH_STATE_DIR: tempDirs.make("branch-runtime-data-") } };
    const initial = openBranchStateDatabase(options);
    const external = new DatabaseSync(initial.path);
    try {
      external.exec(`
        UPDATE schema_meta
           SET updated_at = updated_at + 1
         WHERE meta_key = 'primary';
      `);
    } finally {
      external.close();
    }

    vi.runOnlyPendingTimers();

    expect(openBranchStateDatabase(options)).toBe(initial);
    expect(initial.db.isOpen).toBe(true);
  });
});

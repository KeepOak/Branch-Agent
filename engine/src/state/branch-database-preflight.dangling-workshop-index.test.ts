import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "./branch-agent-db-contract.js";
import { preflightBranchDatabaseSchemas } from "./branch-database-preflight.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import { openDoctorStateSchemaReadAdmission } from "./branch-state-db-doctor-schema.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(closeBranchStateDatabaseForTest);

describe("dangling Workshop index preflight", () => {
  it("admits the exact defect only for Doctor without mutating the source", async () => {
    const stateDir = tempDirs.make("branch-preflight-dangling-workshop-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const statePath = openBranchStateDatabase({ env }).path;
    closeBranchStateDatabaseForTest();
    const { DatabaseSync } = requireNodeSqlite();
    const database = new DatabaseSync(statePath);
    try {
      database.exec(
        "CREATE INDEX idx_skill_workshop_collection_reviews_workspace_time ON skill_workshop_collection_reviews(review_id, create_time DESC);",
      );
      database.enableDefensive?.(false);
      database.exec("PRAGMA writable_schema = ON;");
      database
        .prepare(
          `UPDATE sqlite_schema
            SET sql = 'CREATE INDEX idx_skill_workshop_collection_reviews_workspace_time
                         ON skill_workshop_collection_reviews(workspace_dir, create_time DESC, review_id DESC)'
          WHERE type = 'index'
            AND name = 'idx_skill_workshop_collection_reviews_workspace_time'`,
        )
        .run();
      // SAFETY: PRAGMA schema_version always returns one numeric row for an open database.
      const { schema_version } = database.prepare("PRAGMA schema_version").get() as {
        schema_version: number;
      };
      database.exec(`PRAGMA writable_schema = OFF; PRAGMA schema_version = ${schema_version + 1};`);
    } finally {
      database.close();
    }
    const sourceDir = path.dirname(statePath);
    const snapshot = () =>
      fs
        .readdirSync(sourceDir)
        .toSorted()
        .map((name) => [name, fs.readFileSync(path.join(sourceDir, name))]);
    const before = snapshot();

    const runtime = await preflightBranchDatabaseSchemas({ env, scope: "state" });
    expect(runtime.indeterminate).toEqual([
      expect.objectContaining({ reason: expect.stringMatching(/branch doctor --fix/) }),
    ]);
    expect(snapshot()).toEqual(before);

    await expect(
      preflightBranchDatabaseSchemas({
        env,
        scope: "state",
        openStateSchemaReadAdmission: openDoctorStateSchemaReadAdmission,
        supportedVersions: {
          state: BRANCH_STATE_SCHEMA_VERSION,
          agent: BRANCH_AGENT_SCHEMA_VERSION,
        },
      }),
    ).resolves.toEqual({ incompatible: [], indeterminate: [] });
    expect(snapshot()).toEqual(before);
  });
});

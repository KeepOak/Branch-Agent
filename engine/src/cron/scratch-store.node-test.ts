import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { openBranchStateDatabase, closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { readScratchStateFromDatabase } from "./scratch-read.kernel.js";
import { writeCronJobScratchInDatabase } from "./scratch-write.kernel.js";
import { upsertCronJobRow } from "./store/row-codec.js";
import type { CronJob } from "./types.js";

test("scratch survives reopen, rejects stale writers and retains unset revision", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "branch-automation-scratch-proof-"));
  const databasePath = path.join(directory, "state.sqlite");
  const storeKey = "automation-proof-store";
  const job: CronJob = { id: "scratch-proof", name: "scratch proof", enabled: false,
    createdAtMs: 1, updatedAtMs: 1, schedule: { kind: "every", everyMs: 60000 },
    sessionTarget: "main", wakeMode: "next-heartbeat", payload: { kind: "systemEvent", text: "proof" }, state: {} };
  let reopened: DatabaseSync | undefined;
  try {
    const { db } = openBranchStateDatabase({ path: databasePath });
    upsertCronJobRow(db, storeKey, job, 0);
    const input = { storeKey, jobId: job.id, content: "cursor=5\né", expectedRevision: 0, nowMs: 10 };
    assert.equal(writeCronJobScratchInDatabase(db, input).result.ok, true);
    assert.equal(writeCronJobScratchInDatabase(db, input).result.ok, false);
    closeBranchStateDatabaseForTest();
    reopened = new DatabaseSync(databasePath);
    assert.deepEqual(readScratchStateFromDatabase(reopened, storeKey, job.id), {
      currentRevision: 1, scratch: { content: input.content, revision: 1, updatedAtMs: 10 },
    });
    assert.equal(writeCronJobScratchInDatabase(reopened, { ...input, content: null, expectedRevision: 1 }).result.ok, true);
    assert.deepEqual(readScratchStateFromDatabase(reopened, storeKey, job.id), { currentRevision: 2 });
    assert.equal(writeCronJobScratchInDatabase(reopened, input).result.ok, false);
    assert.equal(writeCronJobScratchInDatabase(reopened, { ...input, jobId: "unknown" }).result.ok, false);
  } finally {
    reopened?.close();
    closeBranchStateDatabaseForTest();
    assert.ok(directory.startsWith(path.join(os.tmpdir(), "branch-automation-scratch-proof-")));
    rmSync(directory, { recursive: true, force: true });
  }
});

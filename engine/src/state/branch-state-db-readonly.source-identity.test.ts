import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collectNestedErrorCandidates } from "@branch/normalization-core/error-coercion";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resolvePrivateSqliteSnapshotStagingRoot } from "../infra/sqlite-private-directory.js";
import { cleanupSnapshotOperations } from "../infra/sqlite-readonly-location-cleanup.js";
import * as snapshots from "../infra/sqlite-snapshot-source.js";
import { readDatabasePathIdentitySync } from "../infra/sqlite-worker-identity.js";
import {
  executeExistingBranchStateRead,
  withArtifactPreservingStateReads,
} from "./branch-state-db-readonly.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";
import { captureBranchStateReadWorkerContext } from "./branch-state-worker-context.js";

const directories = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(async () => {
    await closeBranchStateDatabaseAsync();
    await cleanupSnapshotOperations();
    closeBranchStateDatabaseForTest();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    cleanup();
  });
});

it("rejects successor bytes substituted after fresh validation and before snapshot preparation", async () => {
  const root = directories.make("state-read-source-identity-");
  vi.stubEnv("XDG_CACHE_HOME", path.join(root, "cache"));
  const options = {
    path: path.join(root, "state", "branch.sqlite"),
    env: { BRANCH_STATE_DIR: root, BRANCH_TEST_FAST: "1" },
  };
  const replacement = path.join(root, "replacement.sqlite");
  const archived = path.join(root, "original.sqlite");
  const stateKey = "readonly.source-identity.fixture";
  const sources = [
    { pathname: options.path, value: "original" },
    { pathname: replacement, value: "successor" },
  ];
  for (const { pathname, value } of sources) {
    const database = openBranchStateDatabase({ ...options, path: pathname });
    database.db
      .prepare(
        "INSERT INTO config_machine_state(state_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
      )
      .run(stateKey, JSON.stringify({ source: value }), 1);
    database.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
  }
  // The measured read must take fresh snapshot preparation, never the cached native branch.
  await closeBranchStateDatabaseAsync();
  const originalIdentity = readDatabasePathIdentitySync(options.path);
  const replacementIdentity = readDatabasePathIdentitySync(replacement);
  expect(replacementIdentity.key).not.toBe(originalIdentity.key);
  const originalBytes = fs.readFileSync(options.path);
  const replacementBytes = fs.readFileSync(replacement);
  const context = captureBranchStateReadWorkerContext(options);
  expect(context.admission.identity.key).toBe(originalIdentity.key);

  const startPreparation = snapshots.startSqliteReadOnlyLocationAsync;
  const preparation = vi
    .spyOn(snapshots, "startSqliteReadOnlyLocationAsync")
    .mockImplementationOnce((pathname, preparationOptions) => {
      expect(pathname).toBe(options.path);
      // This real entry is reached only after the original fresh-validation operation settles.
      fs.renameSync(options.path, archived);
      fs.renameSync(replacement, options.path);
      return startPreparation(pathname, preparationOptions);
    });
  const outcome = await withArtifactPreservingStateReads(() =>
    executeExistingBranchStateRead(
      options,
      { type: "tui.lastSession.read", stateKey },
      { context },
    ),
  ).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );

  expect(preparation).toHaveBeenCalledOnce();
  expect(readDatabasePathIdentitySync(options.path).key).toBe(replacementIdentity.key);
  expect(outcome).toHaveProperty("error");
  if (!("error" in outcome)) {
    throw new Error("The original read admission accepted a replacement database");
  }
  expect(
    collectNestedErrorCandidates(outcome.error).some(
      (error) => error instanceof Error && /identity|source.*changed/i.test(error.message),
    ),
  ).toBe(true);
  expect(fs.readFileSync(archived)).toEqual(originalBytes);
  expect(fs.readFileSync(options.path)).toEqual(replacementBytes);
});

it.runIf(process.platform === "darwin" && fs.existsSync("/usr/bin/SetFile"))(
  "reads the admitted source after a same-inode birthtime metadata change",
  async () => {
    const root = directories.make("state-read-birthtime-");
    vi.stubEnv("XDG_CACHE_HOME", path.join(root, "cache"));
    const options = {
      path: path.join(root, "state", "branch.sqlite"),
      env: { BRANCH_STATE_DIR: root, BRANCH_TEST_FAST: "1" },
    };
    const stateKey = "readonly.birthtime.fixture";
    const value = JSON.stringify({ source: "original" });
    const database = openBranchStateDatabase(options);
    database.db
      .prepare(
        "INSERT INTO config_machine_state(state_key, value_json, updated_at_ms) VALUES (?, ?, ?)",
      )
      .run(stateKey, value, 1);
    database.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
    await closeBranchStateDatabaseAsync();
    const context = captureBranchStateReadWorkerContext(options);
    const before = fs.statSync(options.path, { bigint: true });
    const sourceBytes = fs.readFileSync(options.path);
    const sourceFiles = fs.readdirSync(path.dirname(options.path)).toSorted();
    expect(context.admission.identity.birthtime).toBe(before.birthtimeNs.toString());
    const stagingRoot = resolvePrivateSqliteSnapshotStagingRoot();
    const stagingBefore = fs.readdirSync(stagingRoot).toSorted();

    // Creation-time metadata can change without retiring the admitted physical file.
    execFileSync("/usr/bin/SetFile", ["-d", "01/02/2000 03:04:05", options.path]);
    const after = fs.statSync(options.path, { bigint: true });
    expect([after.dev, after.ino]).toEqual([before.dev, before.ino]);
    expect(after.birthtimeNs).not.toBe(before.birthtimeNs);
    expect(() => context.admission.assertCurrent()).not.toThrow();
    expect(
      await withArtifactPreservingStateReads(() =>
        executeExistingBranchStateRead(
          options,
          { type: "tui.lastSession.read", stateKey },
          { context },
        ),
      ),
    ).toMatchObject({
      ok: true,
      type: "tui.lastSession.read",
      row: { value_json: value, updated_at_ms: 1 },
    });
    await closeBranchStateDatabaseAsync();
    await cleanupSnapshotOperations();
    expect(fs.readdirSync(stagingRoot).toSorted()).toEqual(stagingBefore);
    expect(fs.readFileSync(options.path)).toEqual(sourceBytes);
    expect(fs.readdirSync(path.dirname(options.path)).toSorted()).toEqual(sourceFiles);
    const retained = fs.statSync(options.path, { bigint: true });
    expect([retained.dev, retained.ino, retained.birthtimeNs]).toEqual([
      after.dev,
      after.ino,
      after.birthtimeNs,
    ]);
  },
);

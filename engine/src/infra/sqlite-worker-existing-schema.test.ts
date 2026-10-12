import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db-cache.js";
import { withExistingBranchStateSchema } from "../state/branch-state-db-schema-policy.js";
import { openBranchStateDatabase } from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { executeBranchStateWorker } from "../state/branch-state-worker-store.js";
import { openNodeSqliteDatabase } from "./node-sqlite.js";
import { runtimeProcessEntrypoints } from "./runtime-process-entrypoints.js";
import { resolveRuntimeWorkerUrl } from "./runtime-worker-url.js";
import { openSharedStateSqliteWorkerStore } from "./sqlite-worker-store.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeBranchStateDatabaseAsync();
    cleanup();
  }),
);

function readAppVersion(databasePath: string) {
  const db = openNodeSqliteDatabase(databasePath, { readOnly: true });
  try {
    return db.prepare("SELECT app_version FROM schema_meta WHERE meta_key = 'primary'").get()
      ?.app_version;
  } finally {
    db.close();
  }
}

async function fixture() {
  const env = { BRANCH_STATE_DIR: tempDirs.make("worker-existing-schema-") };
  const { db, path: databasePath } = openBranchStateDatabase({ env });
  db.prepare("UPDATE schema_meta SET app_version = ? WHERE meta_key = 'primary'").run(
    "synthetic-installed-runtime",
  );
  await closeBranchStateDatabaseAsync();
  return { env, databasePath };
}

function read(context: ReturnType<typeof captureBranchStateWorkerContext>) {
  return executeBranchStateWorker(context, {
    type: "plugins.conversationBindingApprovals.read",
    input: undefined,
  });
}

describe("existing-schema shared-state workers", () => {
  it("preserves installed release metadata through managed and ordinary worker opens", async () => {
    const { env, databasePath } = await fixture();

    await withExistingBranchStateSchema({ path: databasePath }, async () => {
      const captured = captureBranchStateWorkerContext({ path: databasePath, env });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(await read(captured)).toEqual([]);
        expect(readAppVersion(databasePath)).toBe("synthetic-installed-runtime");
      }
    });

    const ordinary = captureBranchStateWorkerContext({ path: databasePath, env });
    await expect(
      openSharedStateSqliteWorkerStore(
        {
          moduleUrl: resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.sharedStateStore),
          databasePath,
        },
        ordinary,
      ),
    ).rejects.toThrow("schema policy changed");
    expect(await read(ordinary)).toEqual([]);
    expect(readAppVersion(databasePath)).toBe("synthetic-installed-runtime");
  });

  it("admits queued checks only while their captured existing-schema scope remains active", async () => {
    const { env, databasePath } = await fixture();
    const outsideScope = AsyncLocalStorage.snapshot();
    const captured = await withExistingBranchStateSchema({ path: databasePath }, async () => {
      const context = captureBranchStateWorkerContext({ env });
      expect(() => outsideScope(context.admission.assertCurrent)).not.toThrow();
      expect(await outsideScope(() => read(context))).toEqual([]);
      expect(readAppVersion(databasePath)).toBe("synthetic-installed-runtime");
      return context;
    });

    await expect(read(captured)).rejects.toThrow("schema admission has ended");
    expect(readAppVersion(databasePath)).toBe("synthetic-installed-runtime");
  });
});

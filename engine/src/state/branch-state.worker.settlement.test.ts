import { copyFileSync, existsSync, linkSync, readFileSync, unlinkSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getNodeSqliteKysely, iterateSqliteQuerySync } from "../infra/kysely-sync.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { runWithSqliteWorkerStateContext } from "../infra/sqlite-worker-state-context.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../test-utils/branch-test-state.js";
import { closeBranchStateDatabaseAsync } from "./branch-state-db-cache.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "./branch-state-db-contract.js";
import { withExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import { openBranchStateDatabase } from "./branch-state-db.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";
import {
  createSqliteWorkerBackend,
  openExistingSqliteWorkerBackend,
} from "./branch-state.worker.js";

let state: BranchTestState;
beforeEach(async () => {
  state = await createBranchTestState({ prefix: "branch-worker-settlement-", applyEnv: true });
});
afterEach(async () => {
  await closeBranchStateDatabaseAsync();
  await state.cleanup();
});

it("rechecks a foreign commit before the next worker operation", async () => {
  const context = captureBranchStateWorkerContext();
  const backend = runWithSqliteWorkerStateContext(context, () =>
    createSqliteWorkerBackend(undefined, { databasePath: context.admission.databasePath }),
  );
  const peer = new (requireNodeSqlite().DatabaseSync)(context.admission.databasePath);
  try {
    peer.exec(`PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION + 1}`);
    const command = { type: "database.inspectIdle" as const, input: undefined };
    expect(() => runWithSqliteWorkerStateContext(context, () => backend.execute(command))).toThrow(
      "newer schema version",
    );
  } finally {
    peer.exec(`PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION}`);
    peer.close();
    await backend.close();
  }
});

it("retires an existing-only idle actor without opening its missing database", async () => {
  const databasePath = openBranchStateDatabase().path;
  await closeBranchStateDatabaseAsync();
  const context = captureBranchStateWorkerContext();
  const backend = runWithSqliteWorkerStateContext(context, () =>
    openExistingSqliteWorkerBackend(undefined, {
      databasePath,
      existingIdentity: context.admission.identity.key,
    }),
  );
  unlinkSync(databasePath);
  try {
    expect(
      runWithSqliteWorkerStateContext(context, () =>
        backend.execute({ type: "database.inspectIdle", input: undefined }),
      ),
    ).toBe("retire");
    expect(existsSync(context.admission.databasePath)).toBe(false);
  } finally {
    await backend.close();
  }
});

it.each(["removed", "replaced"] as const)(
  "refuses a lazy actor's %s original locator even while a hardlink survives",
  async (kind) => {
    const databasePath = openBranchStateDatabase().path;
    await closeBranchStateDatabaseAsync();
    const alias = state.statePath("retained.sqlite");
    linkSync(databasePath, alias);
    const original = readFileSync(alias);
    const context = captureBranchStateWorkerContext();
    const backend = runWithSqliteWorkerStateContext(context, () =>
      openExistingSqliteWorkerBackend(undefined, {
        databasePath,
        existingIdentity: context.admission.identity.key,
      }),
    );
    unlinkSync(databasePath);
    if (kind === "replaced") {
      copyFileSync(alias, databasePath);
    }
    try {
      for (const command of [
        {
          type: "stateLease.verify",
          input: { identity: { scope: "fixture", key: "lease", owner: "owner" } },
        },
        {
          type: "stateLease.acquire",
          input: {
            identity: { scope: "fixture", key: "lease", owner: "owner" },
            leaseMs: 300_000,
            operationLabel: "fixture",
            schemaPolicy: "existing",
          },
        },
        { type: "deviceIdentity.load", input: { identityKey: "fixture" } },
      ] as const) {
        expect(() =>
          runWithSqliteWorkerStateContext(context, () => backend.execute(command)),
        ).toThrow(kind === "removed" ? /ENOENT/ : /identity changed/);
        expect(readFileSync(alias)).toEqual(original);
        if (kind === "removed") {
          expect(existsSync(databasePath)).toBe(false);
        } else {
          expect(readFileSync(databasePath)).toEqual(original);
        }
      }
    } finally {
      await backend.close();
    }
  },
);

it("does not checkpoint a retained existing-schema actor during idle inspection", async () => {
  const databasePath = openBranchStateDatabase().path;
  await closeBranchStateDatabaseAsync();
  await withExistingBranchStateSchema({ path: databasePath }, async () => {
    const context = captureBranchStateWorkerContext();
    const backend = runWithSqliteWorkerStateContext(context, () =>
      createSqliteWorkerBackend(undefined, { databasePath }),
    );
    const { db } = openBranchStateDatabase();
    const { constants } = requireNodeSqlite();
    const checkpoints: string[] = [];
    db.setAuthorizer((action, name) => {
      if (action === constants.SQLITE_PRAGMA && name === "wal_checkpoint") {
        checkpoints.push(name);
      }
      return constants.SQLITE_OK;
    });
    try {
      expect(backend.execute({ type: "database.inspectIdle", input: undefined })).toBe("retire");
      expect(checkpoints).toEqual([]);
    } finally {
      db.setAuthorizer(null);
      await backend.close();
    }
  });
});

it("rejects leaked readers and unfinished transactions through the same actor settlement hook", async () => {
  const context = captureBranchStateWorkerContext();
  const backend = runWithSqliteWorkerStateContext(context, () =>
    createSqliteWorkerBackend(undefined, { databasePath: context.admission.databasePath }),
  );
  const { db } = openBranchStateDatabase();
  const query = getNodeSqliteKysely<{ schema_meta: { schema_version: number } }>(db)
    .selectFrom("schema_meta")
    .select("schema_version");
  const reader = iterateSqliteQuerySync(db, query);
  try {
    expect(() => backend.assertSettled!()).not.toThrow();
    expect(reader.next().done).toBe(false);
    expect(db.isTransaction).toBe(false);
    expect(() => backend.assertSettled!()).toThrow("active SQLite reader");
    reader.return?.();
    expect(() => backend.assertSettled!()).not.toThrow();
    db.exec("BEGIN");
    expect(() => backend.assertSettled!()).toThrow("unsettled transaction");
    db.exec("ROLLBACK");
    expect(() => backend.assertSettled!()).not.toThrow();
  } finally {
    reader.return?.();
    if (db.isTransaction) {
      db.exec("ROLLBACK");
    }
    await backend.close();
  }
});

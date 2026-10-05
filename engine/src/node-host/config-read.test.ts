import fs from "node:fs";
import path from "node:path";
import { isMainThread } from "node:worker_threads";
import { expect, it, vi } from "vitest";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { createDeferredCore } from "../shared/deferred.js";
import * as stateReads from "../state/branch-state-db-readonly.js";
import { withExistingBranchStateSchema } from "../state/branch-state-db-schema-policy.js";
import {
  closeBranchStateDatabaseAsync,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import type { BranchStateReadReply } from "../state/branch-state-read.types.js";
import { observeMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";
import { useStateDatabaseTempDirs } from "../test-utils/state-database-temp-dirs.js";
import { configureNodeHost, loadNodeHostConfig } from "./config.js";

const tempDirs = useStateDatabaseTempDirs();

function fixture() {
  const root = tempDirs.make("branch-node-host-config-reader-");
  return {
    root,
    env: { BRANCH_STATE_DIR: root },
    databasePath: path.join(root, "state", "branch.sqlite"),
  };
}

function seed(env: NodeJS.ProcessEnv) {
  return configureNodeHost({
    env,
    nodeId: "fixture-node",
    displayName: "Fixture Node",
    fallbackDisplayName: "fallback",
    gateway: { host: "gateway.example", port: 18443, tls: true, contextPath: "/gateway" },
    commands: ["fixture.read", "fixture.list"],
    installedAppsSharing: true,
    nowMs: 1234,
  });
}

async function withoutParentSql(operation: () => Promise<void>): Promise<void> {
  requireNodeSqlite();
  const sql = observeMainThreadSql();
  try {
    await operation();
    expect(sql.count()).toBe(0);
  } finally {
    vi.restoreAllMocks();
  }
}

it.each(["cached", "fresh"] as const)(
  "loads %s node-host configuration without parent-thread SQL",
  async (mode) => {
    expect(isMainThread).toBe(true);
    const { env } = fixture();
    const expected = await seed(env);
    const source = openBranchStateDatabase({ env });
    if (mode === "fresh") {
      await closeBranchStateDatabaseAsync();
    }
    await withoutParentSql(async () => {
      expect(await loadNodeHostConfig(env)).toEqual(expected);
    });
    expect(source.db.isOpen).toBe(mode === "cached");
  },
);

it.each(["fresh", "cached"] as const)(
  "loads %s managed node-host configuration without host SQL or schema repair",
  async (mode) => {
    const { env, databasePath } = fixture();
    const expected = await seed(env);
    openBranchStateDatabase({ env })
      .db.prepare("UPDATE schema_meta SET app_version = ? WHERE meta_key = 'primary'")
      .run("synthetic-installed-runtime");
    await closeBranchStateDatabaseAsync();
    const { DatabaseSync } = requireNodeSqlite();
    await withExistingBranchStateSchema({ path: databasePath }, async () => {
      if (mode === "cached") {
        openBranchStateDatabase({ env });
      }
      await withoutParentSql(async () => {
        expect(await loadNodeHostConfig(env)).toEqual(expected);
      });
      const external = new DatabaseSync(databasePath);
      try {
        external.exec("DROP INDEX idx_plugin_state_listing");
      } finally {
        external.close();
      }
      await withoutParentSql(async () => {
        await expect(loadNodeHostConfig(env)).rejects.toThrow(/idx_plugin_state_listing|schema/i);
      });
    });
    await closeBranchStateDatabaseAsync();
    const persisted = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(
        persisted.prepare("SELECT app_version FROM schema_meta WHERE meta_key = 'primary'").get(),
      ).toEqual({ app_version: "synthetic-installed-runtime" });
      expect(
        persisted
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'idx_plugin_state_listing'")
          .get(),
      ).toBeUndefined();
    } finally {
      persisted.close();
    }
  },
);

it.each([false, true])(
  "reads an absent store only after the legacy gate (legacy=%s)",
  async (legacy) => {
    const { env, root, databasePath } = fixture();
    const execute = vi.spyOn(stateReads, "executeExistingBranchStateRead");
    if (legacy) {
      fs.writeFileSync(path.join(root, "node.json"), "{}\n");
      await expect(loadNodeHostConfig(env)).rejects.toThrow("branch doctor --fix");
      expect(execute).not.toHaveBeenCalled();
    } else {
      expect(await loadNodeHostConfig(env)).toBeNull();
    }
    expect(fs.existsSync(databasePath)).toBe(false);
  },
);

it("joins admitted node-host configuration reads before their disposable scope exits", async () => {
  const { env, databasePath } = fixture();
  const expected = await seed(env);
  const outcomes: unknown[] = [];
  await stateReads.withDisposableBranchStateReads(databasePath, async () => {
    void loadNodeHostConfig(env).then(
      (value) => outcomes.push(value),
      (error: unknown) => outcomes.push(error),
    );
  });
  expect(outcomes).toEqual([expected]);
});

it.each([
  { value_json: "{", updated_at_ms: 1, error: SyntaxError, message: /JSON/u },
  {
    value_json: '{"version":1,"nodeId":"fixture-node"}',
    updated_at_ms: -1,
    error: Error,
    message: /updated_at_ms must be a non-negative integer/u,
  },
  {
    value_json: '{"version":2,"nodeId":"fixture-node"}',
    updated_at_ms: 1,
    error: Error,
    message: /unsupported version 2/u,
  },
])("preserves node-host row decoding errors ($value_json, $updated_at_ms)", async (row) => {
  const { env } = fixture();
  vi.spyOn(stateReads, "executeExistingBranchStateRead").mockResolvedValue({
    ok: true,
    type: "nodeHost.config",
    sourceAdmitted: true,
    row: { value_json: row.value_json, updated_at_ms: row.updated_at_ms },
  });
  const failure = await loadNodeHostConfig(env).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(row.error);
  expect(failure).toMatchObject({ message: expect.stringMatching(row.message) });
});

it.each([true, false])(
  "retains the selected state root while reading (original marker=%s)",
  async (markerAtOriginal) => {
    const original = fixture();
    const other = fixture();
    const env = { ...original.env };
    const reply = createDeferredCore<BranchStateReadReply>();
    const execute = vi
      .spyOn(stateReads, "executeExistingBranchStateRead")
      .mockReturnValue(reply.promise);
    const result = loadNodeHostConfig(env);
    env.BRANCH_STATE_DIR = other.root;
    fs.writeFileSync(path.join(markerAtOriginal ? original.root : other.root, "node.json"), "{}\n");
    reply.resolve({
      ok: true,
      type: "nodeHost.config",
      sourceAdmitted: true,
      row: {
        // The original-root legacy gate must run before decoding the returned row.
        value_json: markerAtOriginal ? "{" : '{"version":1,"nodeId":"original-node"}',
        updated_at_ms: 1,
      },
    });
    if (markerAtOriginal) {
      await expect(result).rejects.toThrow(
        `retired node-host state remains at ${path.join(original.root, "node.json")}`,
      );
    } else {
      await expect(result).resolves.toMatchObject({ nodeId: "original-node" });
    }
    expect(execute.mock.calls[0]?.[0].env?.BRANCH_STATE_DIR).toBe(original.root);
  },
);

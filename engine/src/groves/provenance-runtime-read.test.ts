import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as snapshots from "../infra/sqlite-snapshot-source.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import {
  initializeCachedGroveInstallSchemaVersions,
  readCachedGroveInstallSchemaVersions,
} from "./provenance-runtime-read.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  closeBranchStateDatabaseForTest();
});

describe("Grove runtime provenance cache", () => {
  it("treats an absent first-run state database as empty ownership", () => {
    const root = tempDirs.make("branch-grove-runtime-provenance-first-run-");
    const options = { env: { BRANCH_STATE_DIR: root } };

    initializeCachedGroveInstallSchemaVersions(options);

    expect(readCachedGroveInstallSchemaVersions(options)).toMatchObject({
      kind: "ready",
      schemaVersions: new Map(),
    });
  });

  it("refreshes install ownership written by another process", () => {
    const root = tempDirs.make("branch-grove-runtime-provenance-");
    const options = { env: { BRANCH_STATE_DIR: root } };
    const database = openBranchStateDatabase(options);

    initializeCachedGroveInstallSchemaVersions(options);
    expect(readCachedGroveInstallSchemaVersions(options)).toMatchObject({
      kind: "ready",
      schemaVersions: new Map(),
    });

    const external = new DatabaseSync(database.path);
    try {
      external
        .prepare(
          `INSERT INTO grove_installs (
             agent_id, schema_version, source_kind, grove_name, grove_version,
             package_root, manifest_path, integrity_kind, integrity, source_byte_length,
             manifest_schema_version, plan_integrity, workspace, agent_config_digest,
             agent_owned_paths_json, bootstrap_source_path, bootstrap_content_digest,
             status, added_at_ms, updated_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          "worker",
          "branch.groveInstallRecord.v2",
          "package",
          "@acme/worker",
          "1.0.0",
          root,
          `${root}\\branch.grove.json`,
          "artifact",
          "sha256:manifest",
          100,
          1,
          "sha256:plan",
          `${root}\\workspace`,
          "sha256:agent-config",
          '["agents.entries[\\"worker\\"]"]',
          "complete",
          1,
          1,
        );
    } finally {
      external.close();
    }

    initializeCachedGroveInstallSchemaVersions(options);
    const refreshed = readCachedGroveInstallSchemaVersions(options);
    expect(refreshed.kind).toBe("ready");
    if (refreshed.kind !== "ready") {
      throw new Error("expected ready Grove provenance snapshot");
    }
    expect(refreshed.schemaVersions.get("worker")).toMatchObject({
      kind: "ok",
      schemaVersion: "branch.groveInstallRecord.v2",
      agentConfigDigest: "sha256:agent-config",
    });

    closeBranchStateDatabaseForTest();
    rmSync(database.path);
    initializeCachedGroveInstallSchemaVersions(options);
    expect(readCachedGroveInstallSchemaVersions(options)).toMatchObject({
      kind: "state-error",
      knownAgentIds: new Set(["worker"]),
      ownershipUnknown: true,
    });
  });

  it("does not create WAL/SHM sidecar files when reading schema versions", () => {
    const root = tempDirs.make("branch-grove-runtime-provenance-sidecar-");
    const options = { env: { BRANCH_STATE_DIR: root } };
    const database = openBranchStateDatabase(options);
    closeBranchStateDatabaseForTest();
    const prepare = vi.spyOn(snapshots, "prepareSqliteReadOnlyLocationSync");

    initializeCachedGroveInstallSchemaVersions(options);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(readCachedGroveInstallSchemaVersions(options)).toMatchObject({
      kind: "ready",
      schemaVersions: new Map(),
    });

    const stateDir = join(root, "state");
    expect(existsSync(join(stateDir, "branch.sqlite-wal"))).toBe(false);
    expect(existsSync(join(stateDir, "branch.sqlite-shm"))).toBe(false);

    rmSync(database.path);
  });
});

// Regression coverage for read-only Grove state access on databases that predate
// the additive provenance columns but already report the current schema version.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { BRANCH_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY } from "../state/branch-state-schema-compatibility.js";
import { readGroveResumeStateReadOnly } from "./package-resume.js";
import { parseGroveManifest } from "./schema.js";
import type { GroveSourceIdentity } from "./types.js";
import { buildGroveUpdatePlan } from "./update-plan.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => closeBranchStateDatabaseForTest());

function createBaseShapeState(params: {
  env: { BRANCH_STATE_DIR: string };
  packageRoot: string;
  workspace: string;
}): string {
  const database = openBranchStateDatabase({ env: params.env });
  const databasePath = database.path;
  database.db
    .prepare(
      `INSERT INTO grove_installs (
        agent_id, schema_version, source_kind, grove_name, grove_version, package_root,
        manifest_path, integrity_kind, integrity, source_byte_length, manifest_schema_version,
        plan_integrity, workspace, agent_config_digest, agent_owned_paths_json, status,
        added_at_ms, updated_at_ms
      ) VALUES (
        'legacy-worker', 'branch.groveInstallRecord.v1', 'package', '@acme/legacy', '1.0.0', ?,
        ?, 'artifact', 'sha256:aa', 10, 1, 'sha256:bb', ?, 'sha256:cc', '[]', 'complete',
        1000, 2000
      )`,
    )
    .run(params.packageRoot, join(params.packageRoot, "GROVE.md"), params.workspace);
  for (const column of BRANCH_STATE_MAINTENANCE_SCHEMA_COMPATIBILITY.allowedMissingColumns ??
    []) {
    const [table, name] = column.split(".");
    if (!table || !name) {
      continue;
    }
    // Additive columns can belong to tables that are stripped from grove-scoped
    // schemas entirely (e.g. node_worker_launches); base shape only drops
    // columns whose owning table exists here.
    const tableExists = database.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table);
    if (!tableExists) {
      continue;
    }
    database.db.exec(`ALTER TABLE ${table} DROP COLUMN ${name};`);
  }
  closeBranchStateDatabaseForTest();
  return databasePath;
}

async function createFixture(label: string): Promise<{
  env: { BRANCH_STATE_DIR: string };
  databasePath: string;
  packageRoot: string;
  workspace: string;
}> {
  const root = tempDirs.make(label);
  const packageRoot = join(root, "package");
  const workspace = join(root, "workspace");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(packageRoot, "GROVE.md"), "---\nschemaVersion: 1\n---\n", "utf8");
  const env = { BRANCH_STATE_DIR: join(root, "state") };
  return {
    env,
    databasePath: createBaseShapeState({ env, packageRoot, workspace }),
    packageRoot,
    workspace,
  };
}

describe("read-only Grove state compatibility", () => {
  it("plans an update against a base-shape database without mutating it", async () => {
    const fixture = await createFixture("branch-grove-base-shape-");
    const before = await readFile(fixture.databasePath);
    const parsed = parseGroveManifest({
      schemaVersion: 1,
      agent: { id: "legacy-worker", name: "Legacy Worker" },
    });
    if (!parsed.ok) {
      throw new Error(JSON.stringify(parsed.diagnostics));
    }
    const source: GroveSourceIdentity = {
      kind: "package",
      name: "@acme/legacy",
      version: "1.1.0",
      packageRoot: fixture.packageRoot,
      manifestPath: join(fixture.packageRoot, "GROVE.md"),
      integrityKind: "artifact",
      integrity: "sha256:dd",
      byteLength: 12,
    };

    const plan = await buildGroveUpdatePlan({
      agentId: "legacy-worker",
      targetManifest: parsed.manifest,
      targetSource: source,
      config: {},
      sourceMcpServers: {},
      stateOptions: { env: fixture.env },
      packagePreflight: async () => ({
        ok: true as const,
        action: "install" as const,
        integrity: `sha256:${"a".repeat(64)}`,
      }),
    });

    expect(plan.blockers).not.toContainEqual(expect.objectContaining({ code: "grove_not_found" }));
    expect(plan.blockers).not.toContainEqual(
      expect.objectContaining({ code: "grove_identity_mismatch" }),
    );
    expect(before.equals(await readFile(fixture.databasePath))).toBe(true);
  });

  it("resumes a base-shape database without mutating it", async () => {
    const fixture = await createFixture("branch-grove-base-shape-resume-");
    const before = await readFile(fixture.databasePath);

    const state = await readGroveResumeStateReadOnly("legacy-worker", {
      path: fixture.databasePath,
    });

    expect(state?.record).toMatchObject({ agentId: "legacy-worker", status: "complete" });
    expect(state?.record.bootstrap).toBeUndefined();
    expect(before.equals(await readFile(fixture.databasePath))).toBe(true);
  });
});

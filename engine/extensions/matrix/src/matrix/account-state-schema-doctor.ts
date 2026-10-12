// Matrix plugin module owns Doctor repair of account-scoped SQLite databases.
import path from "node:path";
import type { BranchStateDatabaseSchemaMigration } from "branch/plugin-sdk/doctor-repair-runtime";
import type { PluginDoctorStateMigration } from "branch/plugin-sdk/runtime-doctor-migrations";
import { describeRetiredMatrixState, RETIRED_MATRIX_STATE_FILENAMES } from "./retired-state.js";
import { resolveMatrixSqliteStateEnv } from "./sqlite-state.js";
import { walkMatrixStateFiles } from "./state-layout-walk.js";

const STATE_DATABASE_FILENAME = "branch.sqlite";

async function collectMatrixAccountStateRoots(stateDir: string): Promise<string[]> {
  const { entries, failedDirs } = await walkMatrixStateFiles(
    stateDir,
    (name, depth) =>
      (depth === 5 && name === STATE_DATABASE_FILENAME) ||
      ((depth === 0 || depth === 2 || depth === 4) && RETIRED_MATRIX_STATE_FILENAMES.has(name)),
    [2, 4],
  );
  if (failedDirs.length > 0) {
    throw failedDirs[0]!.error;
  }
  const retired = entries.filter((entry) => path.basename(entry.path) !== STATE_DATABASE_FILENAME);
  if (retired.length > 0) {
    throw new Error(retired.map((entry) => describeRetiredMatrixState(entry.path)).join("\n"));
  }
  return entries.map((entry) => path.dirname(path.dirname(entry.path))).toSorted();
}

function describeMatrixAccountStateMigration(
  storageRootDir: string,
  migration: BranchStateDatabaseSchemaMigration,
): string {
  return `Matrix account SQLite schema migration (${migration.kind}): ${storageRootDir}`;
}

export const matrixAccountStateSchemaMigration: PluginDoctorStateMigration = {
  id: "matrix-account-sqlite-schema",
  label: "Matrix account SQLite schemas",
  async detectLegacyState(params) {
    const preview: string[] = [];
    for (const storageRootDir of await collectMatrixAccountStateRoots(params.stateDir)) {
      // Empty-state startup scans must not load the schema repair runtime.
      const { detectBranchStateDatabaseSchemaMigrations } =
        await import("branch/plugin-sdk/doctor-repair-runtime");
      const env = resolveMatrixSqliteStateEnv({ env: params.env, stateDir: storageRootDir });
      preview.push(
        ...detectBranchStateDatabaseSchemaMigrations({ env }).map((migration) =>
          describeMatrixAccountStateMigration(storageRootDir, migration),
        ),
      );
    }
    return preview.length > 0 ? { preview } : null;
  },
  async migrateLegacyState(params) {
    const changes: string[] = [];
    const warnings: string[] = [];
    for (const storageRootDir of await collectMatrixAccountStateRoots(params.stateDir)) {
      const { detectBranchStateDatabaseSchemaMigrations, repairBranchStateDatabaseSchema } =
        await import("branch/plugin-sdk/doctor-repair-runtime");
      const env = resolveMatrixSqliteStateEnv({ env: params.env, stateDir: storageRootDir });
      if (detectBranchStateDatabaseSchemaMigrations({ env }).length === 0) {
        continue;
      }
      const repaired = repairBranchStateDatabaseSchema({ env });
      changes.push(
        ...repaired.changes.map((change) => `Matrix account SQLite ${storageRootDir}: ${change}`),
      );
      warnings.push(
        ...repaired.warnings.map(
          (warning) => `Matrix account SQLite ${storageRootDir}: ${warning}`,
        ),
      );
    }
    return { changes, warnings };
  },
};

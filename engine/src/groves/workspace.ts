// Creates Grove-owned bootstrap and supporting files inside the new agent workspace.
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import type { Selectable } from "kysely";
import { root as fsSafeRoot, FsSafeError, type Root } from "../infra/fs-safe.js";
import {
  compileSqliteQueryBindings,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { coerceRequiredSqliteNumber as sqliteNumber } from "../infra/sqlite-number.js";
import { tableExists } from "../state/branch-state-db-schema-helpers.js";
import type { DB } from "../state/branch-state-db.generated.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { groveContainedRelativePath } from "./path-containment.js";
import { parseGroveMarkdown } from "./reader.js";
import type { GroveAddPlan, GroveAddPlanAction, ClawDiagnostic } from "./types.js";

export const GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION =
  "branch.groveWorkspaceFileRecord.v1" as const;

const MAX_GROVE_WORKSPACE_FILE_BYTES = 1024 * 1024;

export type PersistedGroveWorkspaceFile = {
  schemaVersion: typeof GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION;
  agentId: string;
  workspace: string;
  path: string;
  sourcePath: string;
  contentDigest: string;
  status: "pending" | "complete" | "failed";
  createdAtMs: number;
  updatedAtMs: number;
};

export class GroveWorkspaceWriteError extends Error {
  constructor(
    readonly diagnostics: ClawDiagnostic[],
    readonly createdFiles: PersistedGroveWorkspaceFile[],
  ) {
    super("Grove workspace file creation failed");
    this.name = "GroveWorkspaceWriteError";
  }
}

class GroveWorkspaceSourceAliasError extends Error {}

type WorkspaceDatabase = Pick<DB, "grove_workspace_files">;
type WorkspaceFileRow = Selectable<DB["grove_workspace_files"]>;

function selectWorkspaceFiles(db: DatabaseSync) {
  return getNodeSqliteKysely<WorkspaceDatabase>(db)
    .selectFrom("grove_workspace_files")
    .select([
      "schema_version",
      "agent_id",
      "workspace",
      "target_path",
      "source_path",
      "content_digest",
      "status",
      "created_at_ms",
      "updated_at_ms",
    ]);
}

function rowToWorkspaceFile(
  row: WorkspaceFileRow,
  schemaVersion: PersistedGroveWorkspaceFile["schemaVersion"] = GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION,
): PersistedGroveWorkspaceFile {
  return {
    schemaVersion,
    agentId: row.agent_id,
    workspace: row.workspace,
    path: row.target_path,
    sourcePath: row.source_path,
    contentDigest: row.content_digest,
    // SAFETY: Inventory keeps its unchecked status contract; the retry reader validates it first.
    status: row.status as PersistedGroveWorkspaceFile["status"],
    createdAtMs: sqliteNumber(row.created_at_ms),
    updatedAtMs: sqliteNumber(row.updated_at_ms),
  };
}

function workspaceFileToRow(record: PersistedGroveWorkspaceFile): WorkspaceFileRow {
  return {
    agent_id: record.agentId,
    target_path: record.path,
    schema_version: record.schemaVersion,
    workspace: record.workspace,
    source_path: record.sourcePath,
    content_digest: record.contentDigest,
    status: record.status,
    created_at_ms: record.createdAtMs,
    updated_at_ms: record.updatedAtMs,
  };
}

function diagnostic(action: GroveAddPlanAction, code: string, message: string): ClawDiagnostic {
  return {
    level: "error",
    code,
    phase: "mutation",
    path: `$.workspace[${JSON.stringify(action.id)}]`,
    message,
  };
}

function contentDigest(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function readGroveWorkspaceActionSource(params: {
  action: GroveAddPlanAction;
  packageRoot: string;
  sourceRoot: Root;
}): Promise<{ content: Buffer; sourcePath: string; sourceRelative: string }> {
  if (!params.action.source) {
    throw new Error("Workspace file action lacks a source.");
  }
  const sourcePath = resolve(params.action.source);
  const sourceRelative = groveContainedRelativePath(params.packageRoot, sourcePath);
  if (!sourceRelative) {
    throw new Error("Workspace file source must remain inside the Grove package.");
  }
  const read = await params.sourceRoot.read(sourceRelative, {
    hardlinks: "reject",
    maxBytes: MAX_GROVE_WORKSPACE_FILE_BYTES,
    symlinks: "reject",
  });
  if (resolve(read.realPath) !== sourcePath) {
    throw new GroveWorkspaceSourceAliasError(
      "Workspace source no longer resolves to the consented file.",
    );
  }
  if (params.action.sourceKind !== "groveMarkdownBody") {
    return { content: read.buffer, sourcePath, sourceRelative };
  }
  const parsed = parseGroveMarkdown(read.buffer, sourcePath);
  if (!parsed.ok) {
    throw new Error(parsed.diagnostics.map((item) => item.message).join("; "));
  }
  return { content: parsed.body, sourcePath, sourceRelative };
}

function persistWorkspaceFile(
  record: PersistedGroveWorkspaceFile,
  options: BranchStateDatabaseOptions,
): void {
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<WorkspaceDatabase>(db)
        .insertInto("grove_workspace_files")
        .values(workspaceFileToRow(record)),
    );
  }, options);
}

function readWorkspaceFile(
  agentId: string,
  targetPath: string,
  options: BranchStateDatabaseOptions,
): PersistedGroveWorkspaceFile | undefined {
  return runBranchStateWriteTransaction(({ db }) => {
    const row = executeSqliteQueryTakeFirstSync(
      db,
      selectWorkspaceFiles(db)
        .where("agent_id", "=", agentId)
        .where("target_path", "=", targetPath)
        .limit(1),
    );
    if (!row) {
      return undefined;
    }
    if (
      row.schema_version !== GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION ||
      (row.status !== "pending" && row.status !== "complete" && row.status !== "failed")
    ) {
      throw new Error(
        `Grove workspace file ${JSON.stringify(targetPath)} has unsupported provenance state.`,
      );
    }
    return rowToWorkspaceFile(row);
  }, options);
}

function sameWorkspaceFileOwner(
  existing: PersistedGroveWorkspaceFile,
  expected: PersistedGroveWorkspaceFile,
): boolean {
  return (
    existing.schemaVersion === expected.schemaVersion &&
    existing.agentId === expected.agentId &&
    existing.workspace === expected.workspace &&
    existing.path === expected.path &&
    existing.sourcePath === expected.sourcePath &&
    existing.contentDigest === expected.contentDigest
  );
}

function updateWorkspaceFileStatus(
  record: PersistedGroveWorkspaceFile,
  expectedStatuses: PersistedGroveWorkspaceFile["status"][],
  options: BranchStateDatabaseOptions,
): void {
  runBranchStateWriteTransaction(({ db }) => {
    const result = executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<WorkspaceDatabase>(db)
        .updateTable("grove_workspace_files")
        .set({ status: record.status, updated_at_ms: record.updatedAtMs })
        .where("agent_id", "=", record.agentId)
        .where("target_path", "=", record.path)
        .where("status", "in", expectedStatuses),
    );
    if (result.numAffectedRows !== 1n) {
      throw new Error(
        `Grove workspace file ${JSON.stringify(record.path)} changed ownership state concurrently.`,
      );
    }
  }, options);
}

export function upsertGroveWorkspaceFile(
  record: PersistedGroveWorkspaceFile,
  options: BranchStateDatabaseOptions = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<WorkspaceDatabase>(db)
        .insertInto("grove_workspace_files")
        .values(workspaceFileToRow(record))
        .onConflict((conflict) =>
          conflict.columns(["agent_id", "target_path"]).doUpdateSet((eb) => ({
            schema_version: eb.ref("excluded.schema_version"),
            workspace: eb.ref("excluded.workspace"),
            source_path: eb.ref("excluded.source_path"),
            content_digest: eb.ref("excluded.content_digest"),
            status: eb.ref("excluded.status"),
            // Update rollback restores the complete prior record, including its creation time.
            created_at_ms: eb.ref("excluded.created_at_ms"),
            updated_at_ms: eb.ref("excluded.updated_at_ms"),
          })),
        ),
    );
  }, options);
}

export function deleteGroveWorkspaceFileRecord(
  agentId: string,
  path: string,
  options: BranchStateDatabaseOptions = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<WorkspaceDatabase>(db)
        .deleteFrom("grove_workspace_files")
        .where("agent_id", "=", agentId)
        .where("target_path", "=", path),
    );
  }, options);
}

export function readGroveWorkspaceFiles(
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): PersistedGroveWorkspaceFile[] {
  const { db } = openBranchStateDatabase(options);
  if (options.readOnly && !tableExists(db, "grove_workspace_files")) {
    return [];
  }
  const { compiled, bind } = compileSqliteQueryBindings<string, WorkspaceFileRow>((parameter) =>
    selectWorkspaceFiles(db)
      .where(
        "agent_id",
        "=",
        parameter((value) => value),
      )
      .orderBy("target_path"),
  );
  const rows =
    db /* sqlite-allow-raw: preserve native list errors outside the write-transaction owner. */
      .prepare(compiled.sql)
      .all(...bind(agentId)) as WorkspaceFileRow[];
  return rows.map((row) => rowToWorkspaceFile(row));
}

export function readAllGroveWorkspaceFiles(
  options: BranchStateDatabaseOptions,
): PersistedGroveWorkspaceFile[] {
  const { db } = openBranchStateDatabase(options);
  if (!tableExists(db, "grove_workspace_files")) {
    return [];
  }
  const compiled = selectWorkspaceFiles(db).orderBy("agent_id").orderBy("target_path").compile();
  const rows =
    db /* sqlite-allow-raw: preserve native orphan inventory errors without a write transaction. */
      .prepare(compiled.sql)
      // SAFETY: The canonical table and shared explicit projection provide this generated row shape.
      .all() as WorkspaceFileRow[];
  // Orphan inventory reports the stored version; per-agent inventory uses the current constant.
  return rows.map((row) =>
    rowToWorkspaceFile(row, row.schema_version as PersistedGroveWorkspaceFile["schemaVersion"]),
  );
}

export async function createGroveWorkspaceFiles(
  plan: GroveAddPlan,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): Promise<PersistedGroveWorkspaceFile[]> {
  const actions = plan.actions.filter((action) => action.kind === "workspaceFile");
  if (actions.length === 0) {
    return [];
  }

  const workspaceRoot = await realpath(resolve(plan.agent.workspace));
  const packageRoot = await realpath(resolve(plan.grove.packageRoot));
  const source = await fsSafeRoot(packageRoot, {
    hardlinks: "reject",
    maxBytes: MAX_GROVE_WORKSPACE_FILE_BYTES,
    symlinks: "reject",
  });
  const workspace = await fsSafeRoot(workspaceRoot, {
    hardlinks: "reject",
    maxBytes: MAX_GROVE_WORKSPACE_FILE_BYTES,
    symlinks: "reject",
  });
  const createdFiles: PersistedGroveWorkspaceFile[] = [];
  const nowMs = options.nowMs ?? Date.now();

  for (const action of actions) {
    const writeError = (code: string, message: string) =>
      new GroveWorkspaceWriteError([diagnostic(action, code, message)], createdFiles);
    try {
      if (!action.source || !action.digest) {
        throw writeError("workspace_file_plan_invalid", "File action lacks source or digest.");
      }
      const targetPath = resolve(action.target);
      const targetRelative = groveContainedRelativePath(workspaceRoot, targetPath);
      if (!targetRelative) {
        throw writeError(
          "workspace_file_path_escape",
          "Workspace file source and destination must remain inside their owned roots.",
        );
      }
      const resolvedSource = await readGroveWorkspaceActionSource({
        action,
        packageRoot,
        sourceRoot: source,
      });
      const digest = contentDigest(resolvedSource.content);
      if (digest !== action.digest) {
        throw writeError(
          "workspace_source_changed",
          `Workspace source for ${JSON.stringify(action.id)} changed after planning.`,
        );
      }
      const expectedRecord: PersistedGroveWorkspaceFile = {
        schemaVersion: GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION,
        agentId: plan.agent.finalId,
        workspace: workspace.rootReal,
        path: targetRelative.replaceAll(sep, "/"),
        sourcePath: resolvedSource.sourceRelative.replaceAll(sep, "/"),
        contentDigest: digest,
        status: "pending",
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      };
      const existingRecord = readWorkspaceFile(
        expectedRecord.agentId,
        expectedRecord.path,
        options,
      );
      if (existingRecord && !sameWorkspaceFileOwner(existingRecord, expectedRecord)) {
        throw writeError(
          "workspace_file_ownership_conflict",
          `Workspace destination ${JSON.stringify(targetRelative)} is already claimed by different Grove provenance.`,
        );
      }
      if (await workspace.exists(targetRelative)) {
        if (!existingRecord || existingRecord.status === "failed") {
          throw writeError(
            "workspace_file_collision",
            `Workspace destination ${JSON.stringify(targetRelative)} already exists.`,
          );
        }
        const existingTarget = await workspace.read(targetRelative, {
          hardlinks: "reject",
          maxBytes: MAX_GROVE_WORKSPACE_FILE_BYTES,
          symlinks: "reject",
        });
        if (contentDigest(existingTarget.buffer) !== expectedRecord.contentDigest) {
          throw writeError(
            "workspace_file_drift",
            `Grove-owned workspace destination ${JSON.stringify(targetRelative)} no longer matches its recorded content.`,
          );
        }
        const previousStatus = existingRecord.status;
        existingRecord.status = "complete";
        existingRecord.updatedAtMs = nowMs;
        updateWorkspaceFileStatus(existingRecord, [previousStatus], options);
        createdFiles.push(existingRecord);
        continue;
      }
      const record = existingRecord ?? expectedRecord;
      if (existingRecord) {
        const previousStatus = record.status;
        record.status = "pending";
        record.updatedAtMs = nowMs;
        updateWorkspaceFileStatus(record, [previousStatus], options);
      } else {
        persistWorkspaceFile(record, options);
      }
      try {
        await workspace.write(targetRelative, resolvedSource.content, {
          mkdir: true,
          overwrite: false,
        });
        record.status = "complete";
        updateWorkspaceFileStatus(record, ["pending"], options);
        createdFiles.push(record);
      } catch (error) {
        record.status = "failed";
        try {
          updateWorkspaceFileStatus(record, ["pending"], options);
        } catch {
          // A pending row intentionally remains as evidence of uncertain owner state.
          record.status = "pending";
        }
        createdFiles.push(record);
        throw error;
      }
    } catch (error) {
      if (error instanceof GroveWorkspaceWriteError) {
        throw error;
      }
      const code =
        error instanceof GroveWorkspaceSourceAliasError
          ? "workspace_file_path_alias"
          : error instanceof FsSafeError
            ? `workspace_file_${error.code}`
            : "workspace_file_io_error";
      throw writeError(code, coerceErrorMessage(error));
    }
  }
  return createdFiles;
}

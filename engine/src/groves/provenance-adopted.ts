import type { DatabaseSync } from "node:sqlite";
import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import type { DB } from "../state/branch-state-db.generated.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { digestGroveValue } from "./digest.js";
import {
  GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION,
  encodeGroveAgentOwnership,
} from "./provenance-agent-origin.js";
import {
  cacheGroveInstallSchemaVersion,
  deleteCachedGroveInstallSchemaVersion,
} from "./provenance-runtime-read.js";
import { readGroveSecondaryReferenceTables } from "./provenance-secondary-references.js";
import type { PersistedGroveInstall } from "./provenance-types.js";
import type { GroveAddPlan } from "./types.js";
import type { PersistedGroveWorkspaceFile } from "./workspace.js";

type GroveAdoptedDatabase = Pick<DB, "grove_installs" | "grove_workspace_files">;

function agentOwnedPaths(plan: GroveAddPlan): string[] {
  return plan.actions.filter((action) => action.kind === "agent").map((action) => action.target);
}

/** Atomically records a migration's adopted agent and already-present workspace files. */
export function persistGroveMigrationOwnershipWithInstallRecordReader(
  plan: GroveAddPlan,
  workspaceFiles: PersistedGroveWorkspaceFile[],
  readInstallRecord: (db: DatabaseSync, agentId: string) => PersistedGroveInstall | undefined,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): PersistedGroveInstall {
  const nowMs = options.nowMs ?? Date.now();
  const agentConfigDigest = digestGroveValue(plan.agent.config);
  const ownedPaths = agentOwnedPaths(plan);
  const ownership = encodeGroveAgentOwnership(ownedPaths, "adopted");
  const record = runBranchStateWriteTransaction(({ db }) => {
    if (readInstallRecord(db, plan.agent.finalId)) {
      throw new Error(
        `Agent ${JSON.stringify(plan.agent.finalId)} already has Grove ownership; inspect groves status before migrating.`,
      );
    }
    const secondaryReferences = readGroveSecondaryReferenceTables(db, plan.agent.finalId);
    if (secondaryReferences.length > 0) {
      throw new Error(
        `Agent ${JSON.stringify(plan.agent.finalId)} has unclaimed Grove resource references in ${secondaryReferences.join(", ")}; reconcile them before migration.`,
      );
    }
    const existingWorkspaceOwnership = executeSqliteQueryTakeFirstSync(
      db,
      getNodeSqliteKysely<GroveAdoptedDatabase>(db)
        .selectFrom("grove_workspace_files")
        .select("target_path")
        .where("agent_id", "=", plan.agent.finalId)
        .limit(1),
    );
    if (existingWorkspaceOwnership) {
      throw new Error(
        `Agent ${JSON.stringify(plan.agent.finalId)} has an unclaimed Grove workspace-file ownership record for ${JSON.stringify(existingWorkspaceOwnership.target_path)}; reconcile it before migration.`,
      );
    }
    for (const file of workspaceFiles) {
      if (
        file.agentId !== plan.agent.finalId ||
        file.workspace !== plan.agent.workspace ||
        file.status !== "complete"
      ) {
        throw new Error("Migration workspace ownership does not match its consented agent plan.");
      }
      const collision = executeSqliteQueryTakeFirstSync(
        db,
        getNodeSqliteKysely<GroveAdoptedDatabase>(db)
          .selectFrom("grove_workspace_files")
          .select("agent_id")
          .where("workspace", "=", file.workspace)
          .where("target_path", "=", file.path)
          .limit(1),
      );
      if (collision) {
        throw new Error(
          `Workspace path ${JSON.stringify(file.path)} is already tracked by Grove agent ${JSON.stringify(collision.agent_id)}.`,
        );
      }
    }
    const state = getNodeSqliteKysely<GroveAdoptedDatabase>(db);
    executeSqliteQuerySync(
      db,
      state.insertInto("grove_installs").values({
        agent_id: plan.agent.finalId,
        schema_version: ownership.schemaVersion,
        source_kind: plan.grove.kind,
        grove_name: plan.grove.name,
        grove_version: plan.grove.version,
        package_root: plan.grove.packageRoot,
        manifest_path: plan.grove.manifestPath,
        integrity_kind: plan.grove.integrityKind,
        integrity: plan.grove.integrity,
        source_byte_length: plan.grove.byteLength,
        manifest_schema_version: plan.manifestSchemaVersion,
        plan_integrity: plan.planIntegrity,
        workspace: plan.agent.workspace,
        agent_config_digest: agentConfigDigest,
        agent_owned_paths_json: ownership.agentOwnedPathsJson,
        bootstrap_source_path: null,
        bootstrap_content_digest: null,
        status: "complete",
        added_at_ms: nowMs,
        updated_at_ms: nowMs,
      }),
    );
    for (const file of workspaceFiles) {
      executeSqliteQuerySync(
        db,
        state.insertInto("grove_workspace_files").values({
          schema_version: file.schemaVersion,
          agent_id: file.agentId,
          workspace: file.workspace,
          target_path: file.path,
          source_path: file.sourcePath,
          content_digest: file.contentDigest,
          status: file.status,
          created_at_ms: file.createdAtMs,
          updated_at_ms: file.updatedAtMs,
        }),
      );
    }
    return {
      schemaVersion: GROVE_INSTALL_RECORD_ADOPTED_SCHEMA_VERSION,
      grove: plan.grove,
      manifestSchemaVersion: plan.manifestSchemaVersion,
      planIntegrity: plan.planIntegrity,
      agentId: plan.agent.finalId,
      workspace: plan.agent.workspace,
      agentConfigDigest,
      agentOrigin: "adopted" as const,
      agentOwnedPaths: ownedPaths,
      status: "complete" as const,
      addedAtMs: nowMs,
      updatedAtMs: nowMs,
    };
  }, options);
  cacheGroveInstallSchemaVersion(
    plan.agent.finalId,
    record.schemaVersion,
    record.agentConfigDigest,
    options,
  );
  return record;
}

/** Releases adopted ownership metadata without changing the pre-existing agent or files. */
export function releaseAdoptedGroveInstallRecordWithInstallRecordReader(
  agentId: string,
  expectedPlanIntegrity: string,
  readInstallRecord: (db: DatabaseSync, agentId: string) => PersistedGroveInstall | undefined,
  options: BranchStateDatabaseOptions = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    const record = readInstallRecord(db, agentId);
    if (!record) {
      throw new Error(`No Grove install record exists for agent ${JSON.stringify(agentId)}.`);
    }
    if (
      record.agentOrigin !== "adopted" ||
      record.planIntegrity !== expectedPlanIntegrity ||
      record.status !== "complete"
    ) {
      throw new Error(`Adopted Grove ownership changed for agent ${JSON.stringify(agentId)}.`);
    }
    const secondaryReferences = readGroveSecondaryReferenceTables(db, agentId);
    if (secondaryReferences.length > 0) {
      throw new Error(
        `Adopted Grove ownership for agent ${JSON.stringify(agentId)} now includes secondary resources in ${secondaryReferences.join(", ")}; reconcile them before releasing ownership.`,
      );
    }
    const state = getNodeSqliteKysely<GroveAdoptedDatabase>(db);
    executeSqliteQuerySync(
      db,
      state.deleteFrom("grove_workspace_files").where("agent_id", "=", agentId),
    );
    const removed = executeSqliteQuerySync(
      db,
      state
        .deleteFrom("grove_installs")
        .where("agent_id", "=", agentId)
        .where("schema_version", "=", record.schemaVersion)
        .where("plan_integrity", "=", expectedPlanIntegrity),
    );
    if (removed.numAffectedRows !== 1n) {
      throw new Error(`Adopted Grove ownership changed for agent ${JSON.stringify(agentId)}.`);
    }
  }, options);
  deleteCachedGroveInstallSchemaVersion(agentId, options);
}

import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { coerceRequiredSqliteNumber as sqliteNumber } from "../infra/sqlite-number.js";
import type { DB } from "../state/branch-state-db.generated.js";
import { GROVE_SCHEMA_VERSION } from "./manifest-contract.js";
import {
  rowToPackageRef,
  type PackageRefRow,
  type PersistedClawPackageRef,
  type ClawPackageRefStatus,
} from "./package-extension-provenance.js";
import { decodeGroveAgentOwnership } from "./provenance-agent-origin.js";
import { groveBootstrapProvenanceFromRow } from "./provenance-bootstrap.js";
import * as installRecordSchema from "./provenance-schema-version.js";
import type {
  GroveInstallStatus,
  GroveOrphanWorkspace,
  PersistedGroveInstall,
} from "./provenance-types.js";

type GroveInstallRow = Omit<
  DB["grove_installs"],
  "source_byte_length" | "manifest_schema_version" | "added_at_ms" | "updated_at_ms"
> & {
  source_kind: "package" | "development";
  integrity_kind: "artifact" | "development-snapshot";
  source_byte_length: number | bigint;
  manifest_schema_version: number | bigint;
  status: GroveInstallStatus;
  added_at_ms: number | bigint;
  updated_at_ms: number | bigint;
};

function rowToRecord(row: GroveInstallRow): PersistedGroveInstall {
  const ownership = decodeGroveAgentOwnership(row.agent_owned_paths_json, row.schema_version);
  const manifestSchemaVersion = sqliteNumber(row.manifest_schema_version);
  if (manifestSchemaVersion !== GROVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported Grove manifest schema ${manifestSchemaVersion}.`);
  }
  return {
    schemaVersion: installRecordSchema.parseGroveInstallRecordSchemaVersion(row.schema_version),
    grove: {
      kind: row.source_kind,
      name: row.grove_name,
      version: row.grove_version,
      packageRoot: row.package_root,
      manifestPath: row.manifest_path,
      integrityKind: row.integrity_kind,
      integrity: row.integrity,
      byteLength: sqliteNumber(row.source_byte_length),
    },
    manifestSchemaVersion,
    planIntegrity: row.plan_integrity,
    agentId: row.agent_id,
    workspace: row.workspace,
    agentConfigDigest: row.agent_config_digest,
    agentOrigin: ownership.origin,
    agentOwnedPaths: ownership.paths,
    ...groveBootstrapProvenanceFromRow(row),
    status: row.status,
    addedAtMs: sqliteNumber(row.added_at_ms),
    updatedAtMs: sqliteNumber(row.updated_at_ms),
  };
}

function selectGroveInstallRow(db: DatabaseSync, agentId: string): GroveInstallRow | undefined {
  return (
    db /* sqlite-allow-raw: this Grove prototype state-table read is scoped to one owned row. */
      .prepare(
        `SELECT agent_id, schema_version, source_kind, grove_name, grove_version,
              package_root, manifest_path, integrity_kind, integrity, source_byte_length,
              manifest_schema_version, plan_integrity, workspace, agent_config_digest,
              agent_owned_paths_json, bootstrap_source_path, bootstrap_content_digest,
              status, added_at_ms, updated_at_ms
         FROM grove_installs
        WHERE agent_id = ?`,
      )
      // SAFETY: The explicit projection reads the admitted Grove install table and its writer-owned discriminants.
      .get(agentId) as GroveInstallRow | undefined
  );
}

export function readGroveInstallRecordFromDatabase(
  db: DatabaseSync,
  agentId: string,
): PersistedGroveInstall | undefined {
  const row = selectGroveInstallRow(db, agentId);
  return row ? rowToRecord(row) : undefined;
}

export function readGroveInstallRecordsInDatabase(db: DatabaseSync): PersistedGroveInstall[] {
  const rows =
    db /* sqlite-allow-raw: read-only Grove install inventory ordered by stable agent id. */
      .prepare(
        `SELECT schema_version, source_kind, grove_name, grove_version, package_root,
              manifest_path, integrity_kind, integrity, source_byte_length,
              manifest_schema_version, plan_integrity, agent_id, workspace,
              agent_config_digest, agent_owned_paths_json, bootstrap_source_path, bootstrap_content_digest,
              status, added_at_ms,
              updated_at_ms
         FROM grove_installs
        ORDER BY agent_id`,
      )
      // SAFETY: This inventory uses the same admitted install projection as the exact-row reader.
      .all() as GroveInstallRow[];
  return rows.map(rowToRecord);
}

export type ClawPackageRefQuery = {
  agentId?: string;
  kind?: PersistedClawPackageRef["kind"];
  source?: PersistedClawPackageRef["source"];
  ref?: string;
  version?: string;
  integrity?: string;
  status?: ClawPackageRefStatus;
};

export function readClawPackageRefsInDatabase(
  db: DatabaseSync,
  options: ClawPackageRefQuery = {},
): PersistedClawPackageRef[] {
  const conditions: string[] = [];
  const params: Record<string, string> = {};
  for (const [column, value] of [
    ["agent_id", options.agentId],
    ["package_kind", options.kind],
    ["package_source", options.source],
    ["package_ref", options.ref],
    ["package_version", options.version],
    ["package_integrity", options.integrity],
    ["package_status", options.status],
  ] as const) {
    if (value !== undefined) {
      conditions.push(`${column} = @${column}`);
      params[column] = value;
    }
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows =
    db /* sqlite-allow-raw: read-only Grove package reference lookup with closed column filters. */
      .prepare(
        `SELECT schema_version, agent_id, grove_name, package_kind, package_source,
              package_ref, package_version, package_integrity, package_status, relationship, origin,
              independent_owner, extension_id, extension_format, extension_detected_format,
              extension_mapped_json, extension_unavailable_json, extension_adapter_identity,
              installed_at_ms,
              updated_at_ms
         FROM grove_package_refs${where}
        ORDER BY agent_id, package_kind, package_ref`,
      )
      // SAFETY: The explicit projection matches the admitted package-reference schema consumed by its row codec.
      .all(params) as PackageRefRow[];
  return rows.map(rowToPackageRef);
}

export function readGroveOrphanWorkspaceInDatabase(
  db: DatabaseSync,
  agentId: string,
): GroveOrphanWorkspace | undefined {
  const row = executeSqliteQueryTakeFirstSync(
    db,
    getNodeSqliteKysely<Pick<DB, "grove_workspace_files">>(db)
      .selectFrom("grove_workspace_files")
      .select(["workspace", "updated_at_ms"])
      .where("agent_id", "=", agentId)
      .orderBy("target_path")
      .limit(1),
  );
  return row
    ? { workspace: row.workspace, updatedAtMs: sqliteNumber(row.updated_at_ms) }
    : undefined;
}

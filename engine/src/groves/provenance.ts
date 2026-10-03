// Persists the root ownership record for one Grove-created agent and workspace.

import type { DatabaseSync } from "node:sqlite";
import { stableStringify } from "@branch/normalization-core";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { coerceRequiredSqliteNumber as sqliteNumber } from "../infra/sqlite-number.js";
import type { DB } from "../state/branch-state-db.generated.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { digestGroveValue } from "./digest.js";
import {
  GROVE_PACKAGE_REF_SCHEMA_VERSION,
  rowToPackageRef,
  toPackageRefExtensionSqlParams,
  type ClawPackageOrigin,
  type ClawPackageRefStatus,
  type ClawPackageRelationship,
  type PackageRefRow,
  type PersistedClawPackageRef,
} from "./package-extension-provenance.js";
import {
  persistGroveMigrationOwnershipWithInstallRecordReader,
  releaseAdoptedGroveInstallRecordWithInstallRecordReader,
} from "./provenance-adopted.js";
import {
  decodeGroveAgentOwnership,
  encodeGroveAgentOwnership,
  type GroveAgentOrigin,
} from "./provenance-agent-origin.js";
import {
  groveBootstrapProvenanceFromRow,
  selectGroveBootstrapProvenanceColumns,
} from "./provenance-bootstrap.js";
import { legacySafeColumnProjection } from "./provenance-legacy-columns.js";
import {
  cacheGroveInstallSchemaVersion,
  deleteCachedGroveInstallSchemaVersion,
} from "./provenance-runtime-read.js";
import * as installRecordSchema from "./provenance-schema-version.js";
import type { GroveInstallStatus, PersistedGroveInstall } from "./provenance-types.js";
import type { GroveAddPlan, ClawPackage, ResolvedClawPackage } from "./types.js";
import type { PersistedGroveWorkspaceFile } from "./workspace.js";
export {
  GROVE_PACKAGE_REF_SCHEMA_VERSION,
  type PersistedClawPackageRef,
} from "./package-extension-provenance.js";
export type { GroveInstallStatus, PersistedGroveInstall } from "./provenance-types.js";

type GroveProvenanceDatabase = Pick<
  DB,
  "grove_installs" | "grove_package_refs" | "grove_workspace_files"
>;

type GroveInstallRow = {
  schema_version: string;
  source_kind: "package" | "development";
  grove_name: string;
  grove_version: string;
  package_root: string;
  manifest_path: string;
  integrity_kind: "artifact" | "development-snapshot";
  integrity: string;
  source_byte_length: number | bigint;
  manifest_schema_version: number | bigint;
  plan_integrity: string;
  agent_id: string;
  workspace: string;
  agent_config_digest: string;
  agent_owned_paths_json: string;
  bootstrap_source_path: string | null;
  bootstrap_content_digest: string | null;
  status: GroveInstallStatus;
  added_at_ms: number | bigint;
  updated_at_ms: number | bigint;
};

function rowToRecord(row: GroveInstallRow): PersistedGroveInstall {
  const ownership = decodeGroveAgentOwnership(row.agent_owned_paths_json, row.schema_version);
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
    manifestSchemaVersion: sqliteNumber(
      row.manifest_schema_version,
    ) as GroveAddPlan["manifestSchemaVersion"],
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

function agentOwnedPaths(plan: GroveAddPlan): string[] {
  return plan.actions.filter((action) => action.kind === "agent").map((action) => action.target);
}

function bootstrapProvenance(plan: GroveAddPlan) {
  const action = plan.actions.find((candidate) => candidate.kind === "bootstrap");
  const sourcePath = action?.details?.sourcePath;
  return action && typeof sourcePath === "string" && action.digest
    ? { sourcePath, contentDigest: action.digest }
    : undefined;
}

export function groveInstallRecordMatchesPlan(
  record: PersistedGroveInstall,
  plan: GroveAddPlan,
): boolean {
  const bootstrap = bootstrapProvenance(plan);
  return (
    record.grove.kind === plan.grove.kind &&
    record.grove.name === plan.grove.name &&
    record.grove.version === plan.grove.version &&
    record.grove.packageRoot === plan.grove.packageRoot &&
    record.grove.manifestPath === plan.grove.manifestPath &&
    record.grove.integrityKind === plan.grove.integrityKind &&
    record.grove.integrity === plan.grove.integrity &&
    record.grove.byteLength === plan.grove.byteLength &&
    record.manifestSchemaVersion === plan.manifestSchemaVersion &&
    record.planIntegrity === plan.planIntegrity &&
    record.workspace === plan.agent.workspace &&
    record.agentConfigDigest === digestGroveValue(plan.agent.config) &&
    stableStringify(record.agentOwnedPaths) === stableStringify(agentOwnedPaths(plan)) &&
    record.bootstrap?.sourcePath === bootstrap?.sourcePath &&
    record.bootstrap?.contentDigest === bootstrap?.contentDigest
  );
}

function selectGroveInstallRow(db: DatabaseSync, agentId: string): GroveInstallRow | undefined {
  const bootstrapColumns = selectGroveBootstrapProvenanceColumns(db);
  return db /* sqlite-allow-raw: this Grove prototype state-table read is scoped to one owned row. */
    .prepare(
      `SELECT agent_id, schema_version, source_kind, grove_name, grove_version,
              package_root, manifest_path, integrity_kind, integrity, source_byte_length,
              manifest_schema_version, plan_integrity, workspace, agent_config_digest,
              agent_owned_paths_json, ${bootstrapColumns},
              status, added_at_ms, updated_at_ms
         FROM grove_installs
        WHERE agent_id = ?`,
    )
    .get(agentId) as GroveInstallRow | undefined;
}

export function readGroveInstallRecordFromDatabase(
  db: DatabaseSync,
  agentId: string,
): PersistedGroveInstall | undefined {
  const row = selectGroveInstallRow(db, agentId);
  return row ? rowToRecord(row) : undefined;
}

export function persistGroveMigrationOwnership(
  plan: GroveAddPlan,
  workspaceFiles: PersistedGroveWorkspaceFile[],
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): PersistedGroveInstall {
  return persistGroveMigrationOwnershipWithInstallRecordReader(
    plan,
    workspaceFiles,
    readGroveInstallRecordFromDatabase,
    options,
  );
}

export function releaseAdoptedGroveInstallRecord(
  agentId: string,
  expectedPlanIntegrity: string,
  options: BranchStateDatabaseOptions = {},
): void {
  releaseAdoptedGroveInstallRecordWithInstallRecordReader(
    agentId,
    expectedPlanIntegrity,
    readGroveInstallRecordFromDatabase,
    options,
  );
}

export function readGroveInstallRecord(
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): PersistedGroveInstall | undefined {
  const row = selectGroveInstallRow(openBranchStateDatabase(options).db, agentId);
  return row ? rowToRecord(row) : undefined;
}

export function persistGroveInstallRecord(
  plan: GroveAddPlan,
  options: BranchStateDatabaseOptions & {
    status?: GroveInstallStatus;
    nowMs?: number;
    expectedExistingRecord?: PersistedGroveInstall;
    expectedExistingPlan?: GroveAddPlan;
    deferLegacyPlanUpgrade?: boolean;
    agentOrigin?: GroveAgentOrigin;
  } = {},
): PersistedGroveInstall {
  const nowMs = options.nowMs ?? Date.now();
  const status = options.status ?? "complete";
  const agentConfigDigest = digestGroveValue(plan.agent.config);
  const ownedPaths = agentOwnedPaths(plan);
  const ownership = encodeGroveAgentOwnership(ownedPaths, options.agentOrigin ?? "created");
  const bootstrap = bootstrapProvenance(plan);
  const persistedRecord = runBranchStateWriteTransaction(({ db }) => {
    const existing = selectGroveInstallRow(db, plan.agent.finalId);
    if (existing) {
      const record = rowToRecord(existing);
      const expectedPlan = options.expectedExistingPlan ?? plan;
      if (existing.status !== "complete" && groveInstallRecordMatchesPlan(record, expectedPlan)) {
        if (record.schemaVersion !== installRecordSchema.GROVE_INSTALL_RECORD_SCHEMA_VERSION) {
          if (options.deferLegacyPlanUpgrade) {
            return record;
          }
          return installRecordSchema.upgradeGroveInstallSchema(
            db,
            plan.agent.finalId,
            record,
            options.expectedExistingRecord,
            {
              planIntegrity: plan.planIntegrity,
              agentConfigDigest,
            },
          );
        }
        return record;
      }
      // A nonmatching partial attempt remains durable ownership evidence. A later
      // remove/doctor lifecycle must clear it; a new plan must never overwrite it.
      throw new Error(
        `Grove install record for agent ${JSON.stringify(plan.agent.finalId)} already exists.`,
      );
    }
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<GroveProvenanceDatabase>(db)
        .insertInto("grove_installs")
        .values({
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
          bootstrap_source_path: bootstrap?.sourcePath ?? null,
          bootstrap_content_digest: bootstrap?.contentDigest ?? null,
          status,
          added_at_ms: nowMs,
          updated_at_ms: nowMs,
        }),
    );
    return {
      schemaVersion: ownership.schemaVersion,
      grove: plan.grove,
      manifestSchemaVersion: plan.manifestSchemaVersion,
      planIntegrity: plan.planIntegrity,
      agentId: plan.agent.finalId,
      workspace: plan.agent.workspace,
      agentConfigDigest,
      agentOrigin: options.agentOrigin ?? "created",
      agentOwnedPaths: ownedPaths,
      ...(bootstrap ? { bootstrap } : {}),
      status,
      addedAtMs: nowMs,
      updatedAtMs: nowMs,
    };
  }, options);
  cacheGroveInstallSchemaVersion(
    plan.agent.finalId,
    persistedRecord.schemaVersion,
    persistedRecord.agentConfigDigest,
    options,
  );
  return persistedRecord;
}

export function updateGroveInstallRecordStatus(
  agentId: string,
  status: GroveInstallStatus,
  options: BranchStateDatabaseOptions & {
    nowMs?: number;
    expectedStatuses?: GroveInstallStatus[];
  } = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    const expectedStatuses = options.expectedStatuses ?? [];
    let query = getNodeSqliteKysely<GroveProvenanceDatabase>(db)
      .updateTable("grove_installs")
      .set({ status, updated_at_ms: options.nowMs ?? Date.now() })
      .where("agent_id", "=", agentId);
    if (expectedStatuses.length > 0) {
      query = query.where("status", "in", expectedStatuses);
    }
    if (executeSqliteQuerySync(db, query).numAffectedRows !== 1n) {
      throw new Error(
        `Grove install record for agent ${JSON.stringify(agentId)} did not match the expected phase.`,
      );
    }
  }, options);
}

export function deleteGroveInstallRecord(
  agentId: string,
  options: BranchStateDatabaseOptions & { expectedStatuses?: GroveInstallStatus[] } = {},
): void {
  runBranchStateWriteTransaction(({ db }) => {
    const expectedStatuses = options.expectedStatuses ?? [];
    let query = getNodeSqliteKysely<GroveProvenanceDatabase>(db)
      .deleteFrom("grove_installs")
      .where("agent_id", "=", agentId);
    if (expectedStatuses.length > 0) {
      query = query.where("status", "in", expectedStatuses);
    }
    if (executeSqliteQuerySync(db, query).numAffectedRows !== 1n) {
      throw new Error(
        `Grove install record for agent ${JSON.stringify(agentId)} did not match the expected phase.`,
      );
    }
  }, options);
  deleteCachedGroveInstallSchemaVersion(agentId, options);
}

export function readGroveInstallRecords(
  options: BranchStateDatabaseOptions = {},
): PersistedGroveInstall[] {
  const database = openBranchStateDatabase(options);
  const bootstrapColumns = selectGroveBootstrapProvenanceColumns(database.db);
  const rows =
    database.db /* sqlite-allow-raw: read-only Grove install inventory ordered by stable agent id. */
      .prepare(
        `SELECT schema_version, source_kind, grove_name, grove_version, package_root,
              manifest_path, integrity_kind, integrity, source_byte_length,
              manifest_schema_version, plan_integrity, agent_id, workspace,
              agent_config_digest, agent_owned_paths_json, ${bootstrapColumns},
              status, added_at_ms,
              updated_at_ms
         FROM grove_installs
        ORDER BY agent_id`,
      )
      .all() as GroveInstallRow[];
  return rows.map(rowToRecord);
}

export function updateGroveInstallRecord(
  plan: GroveAddPlan,
  options: BranchStateDatabaseOptions & {
    nowMs?: number;
    expectedGrove?: { version: string; integrity: string };
    status?: GroveInstallStatus;
    agentConfigDigest?: string;
  } = {},
): PersistedGroveInstall {
  const current = readGroveInstallRecord(plan.agent.finalId, options);
  if (!current) {
    throw new Error(
      `No Grove install record exists for agent ${JSON.stringify(plan.agent.finalId)}.`,
    );
  }
  const updatedAtMs = options.nowMs ?? Date.now();
  const status = options.status ?? "complete";
  const agentConfigDigest = options.agentConfigDigest ?? digestGroveValue(plan.agent.config);
  const ownedAgentPaths = plan.actions
    .filter((action) => action.kind === "agent")
    .map((action) => action.target);
  const bootstrap = bootstrapProvenance(plan) ?? current.bootstrap;
  const ownership = encodeGroveAgentOwnership(ownedAgentPaths, current.agentOrigin);
  runBranchStateWriteTransaction(({ db }) => {
    const result = executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<GroveProvenanceDatabase>(db)
        .updateTable("grove_installs")
        .set({
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
          bootstrap_source_path: bootstrap?.sourcePath ?? null,
          bootstrap_content_digest: bootstrap?.contentDigest ?? null,
          status,
          updated_at_ms: updatedAtMs,
        })
        .where("agent_id", "=", plan.agent.finalId)
        .where("grove_version", "=", options.expectedGrove?.version ?? current.grove.version)
        .where("integrity", "=", options.expectedGrove?.integrity ?? current.grove.integrity),
    );
    if (result.numAffectedRows !== 1n) {
      throw new Error(
        `Grove install record changed for agent ${JSON.stringify(plan.agent.finalId)}.`,
      );
    }
  }, options);
  const record = {
    schemaVersion: ownership.schemaVersion,
    grove: plan.grove,
    manifestSchemaVersion: plan.manifestSchemaVersion,
    planIntegrity: plan.planIntegrity,
    agentId: plan.agent.finalId,
    workspace: plan.agent.workspace,
    agentConfigDigest,
    agentOrigin: current.agentOrigin,
    agentOwnedPaths: ownedAgentPaths,
    ...(bootstrap ? { bootstrap } : {}),
    status,
    addedAtMs: current.addedAtMs,
    updatedAtMs,
  };
  cacheGroveInstallSchemaVersion(
    plan.agent.finalId,
    record.schemaVersion,
    record.agentConfigDigest,
    options,
  );
  return record;
}

export function persistClawPackageRef(
  plan: GroveAddPlan,
  pkg: ResolvedClawPackage,
  options: BranchStateDatabaseOptions & {
    nowMs?: number;
    status?: ClawPackageRefStatus;
    relationship?: ClawPackageRelationship;
    origin?: ClawPackageOrigin;
    independentOwner?: boolean;
  } = {},
): PersistedClawPackageRef {
  const nowMs = options.nowMs ?? Date.now();
  let record: PersistedClawPackageRef = {
    schemaVersion: GROVE_PACKAGE_REF_SCHEMA_VERSION,
    agentId: plan.agent.finalId,
    groveName: plan.grove.name,
    kind: pkg.kind,
    source: pkg.source,
    ref: pkg.ref,
    version: pkg.version,
    integrity: pkg.integrity,
    status: options.status ?? "complete",
    relationship: options.relationship ?? (pkg.kind === "skill" ? "managed" : "referenced"),
    origin: options.origin ?? "grove-introduced",
    independentOwner: options.independentOwner ?? false,
    ...(pkg.extension ? { extension: pkg.extension } : {}),
    installedAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  runBranchStateWriteTransaction(({ db }) => {
    const existing = db /* sqlite-allow-raw: exact owned package-ref replay lookup. */
      .prepare(
        `SELECT schema_version, agent_id, grove_name, package_kind, package_source,
                package_ref, package_version, package_integrity, package_status, relationship, origin,
                independent_owner, extension_id, extension_format, extension_detected_format,
                extension_mapped_json, extension_unavailable_json, extension_adapter_identity,
                installed_at_ms, updated_at_ms
           FROM grove_package_refs
          WHERE agent_id = @agent_id
            AND package_kind = @package_kind
            AND package_source = @package_source
            AND package_ref = @package_ref
            AND package_version = @package_version`,
      )
      .get({
        agent_id: record.agentId,
        package_kind: record.kind,
        package_source: record.source,
        package_ref: record.ref,
        package_version: record.version,
      }) as PackageRefRow | undefined;
    if (existing) {
      const previous = rowToPackageRef(existing);
      if (previous.integrity !== record.integrity) {
        throw new Error(
          `Grove package reference ${record.kind}:${record.ref}@${record.version} changed integrity from ${previous.integrity} to ${record.integrity}.`,
        );
      }
      record = {
        ...record,
        relationship: previous.relationship,
        origin: previous.origin === "grove-introduced" ? "grove-introduced" : record.origin,
        independentOwner: previous.independentOwner || record.independentOwner,
        installedAtMs: previous.installedAtMs,
      };
      executeSqliteQuerySync(
        db,
        getNodeSqliteKysely<GroveProvenanceDatabase>(db)
          .updateTable("grove_package_refs")
          .set({
            schema_version: record.schemaVersion,
            grove_name: record.groveName,
            package_status: record.status,
            relationship: record.relationship,
            origin: record.origin,
            independent_owner: record.independentOwner ? 1 : 0,
            ...toPackageRefExtensionSqlParams(record.extension),
            updated_at_ms: record.updatedAtMs,
          })
          .where("agent_id", "=", record.agentId)
          .where("package_kind", "=", record.kind)
          .where("package_source", "=", record.source)
          .where("package_ref", "=", record.ref)
          .where("package_version", "=", record.version)
          .where("package_integrity", "=", record.integrity),
      );
      return;
    }
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<GroveProvenanceDatabase>(db)
        .insertInto("grove_package_refs")
        .values({
          agent_id: record.agentId,
          package_kind: record.kind,
          package_source: record.source,
          package_ref: record.ref,
          package_version: record.version,
          package_integrity: record.integrity,
          schema_version: record.schemaVersion,
          grove_name: record.groveName,
          package_status: record.status,
          relationship: record.relationship,
          origin: record.origin,
          independent_owner: record.independentOwner ? 1 : 0,
          ...toPackageRefExtensionSqlParams(record.extension),
          installed_at_ms: record.installedAtMs,
          updated_at_ms: record.updatedAtMs,
        }),
    );
  }, options);
  return record;
}

export function updateClawPackageRefStatus(
  ref: PersistedClawPackageRef,
  status: ClawPackageRefStatus,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): PersistedClawPackageRef {
  const nowMs = options.nowMs ?? Date.now();
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<GroveProvenanceDatabase>(db)
        .updateTable("grove_package_refs")
        .set({ package_status: status, updated_at_ms: nowMs })
        .where("agent_id", "=", ref.agentId)
        .where("package_kind", "=", ref.kind)
        .where("package_source", "=", ref.source)
        .where("package_ref", "=", ref.ref)
        .where("package_version", "=", ref.version)
        .where("package_integrity", "=", ref.integrity),
    );
  }, options);
  return { ...ref, status, updatedAtMs: nowMs };
}

export function readClawPackageRefs(
  options: BranchStateDatabaseOptions & {
    agentId?: string;
    kind?: ClawPackage["kind"];
    source?: ClawPackage["source"];
    ref?: string;
    version?: string;
    integrity?: string;
    status?: ClawPackageRefStatus;
  } = {},
): PersistedClawPackageRef[] {
  const database = openBranchStateDatabase(options);
  if (
    options.readOnly &&
    !database.db /* sqlite-allow-raw: read-only Grove package-ref table-existence probe. */
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'grove_package_refs'")
      .get()
  ) {
    return [];
  }
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
  const extensionColumns = legacySafeColumnProjection(database.db, "grove_package_refs", [
    "extension_id",
    "extension_format",
    "extension_detected_format",
    "extension_mapped_json",
    "extension_unavailable_json",
    "extension_adapter_identity",
  ]);
  const rows =
    database.db /* sqlite-allow-raw: read-only Grove package reference lookup with closed column filters. */
      .prepare(
        `SELECT schema_version, agent_id, grove_name, package_kind, package_source,
              package_ref, package_version, package_integrity, package_status, relationship, origin,
              independent_owner, ${extensionColumns},
              installed_at_ms,
              updated_at_ms
         FROM grove_package_refs${where}
        ORDER BY agent_id, package_kind, package_ref`,
      )
      .all(params) as PackageRefRow[];
  return rows.map(rowToPackageRef);
}

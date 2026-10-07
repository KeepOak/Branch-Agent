// Persists the root ownership record for one Grove-created agent and workspace.

import { stableStringify } from "@branch/normalization-core";
import {
  assertAgentDeletionAllowsMutation,
  type AgentDeletionOperation,
} from "../agents/agent-lifecycle-registry.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "../state/branch-state-db.generated.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
  type BranchStateDatabase,
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
import { updateClawPackageRefStatusInDatabase } from "./package-status.kernel.js";
import {
  persistGroveMigrationOwnershipWithInstallRecordReader,
  releaseAdoptedGroveInstallRecordWithInstallRecordReader,
} from "./provenance-adopted.js";
import { encodeGroveAgentOwnership, type GroveAgentOrigin } from "./provenance-agent-origin.js";
import {
  readGroveInstallRecordFromDatabase,
  readGroveInstallRecordsInDatabase,
  readClawPackageRefsInDatabase,
  type ClawPackageRefQuery,
} from "./provenance-read.kernel.js";
import {
  cacheGroveInstallSchemaVersion,
  deleteCachedGroveInstallSchemaVersion,
} from "./provenance-runtime-read.js";
import * as installRecordSchema from "./provenance-schema-version.js";
import type { GroveInstallStatus, PersistedGroveInstall } from "./provenance-types.js";
import type { GroveAddPlan, ResolvedClawPackage } from "./types.js";
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
  return readGroveInstallRecordFromDatabase(openBranchStateDatabase(options).db, agentId);
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
  const persistedRecord = runBranchStateWriteTransaction((database) => {
    assertAgentDeletionAllowsMutation(database, plan.agent.finalId);
    const { db } = database;
    const record = readGroveInstallRecordFromDatabase(db, plan.agent.finalId);
    if (record) {
      const expectedPlan = options.expectedExistingPlan ?? plan;
      if (record.status !== "complete" && groveInstallRecordMatchesPlan(record, expectedPlan)) {
        if (record.schemaVersion !== installRecordSchema.GROVE_INSTALL_RECORD_SCHEMA_VERSION) {
          if (options.deferLegacyPlanUpgrade) {
            return record;
          }
          return upgradeGroveInstallSchema(
            database,
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
    deletionOperation?: AgentDeletionOperation;
  } = {},
): void {
  runBranchStateWriteTransaction((database) => {
    assertAgentDeletionAllowsMutation(database, agentId, options.deletionOperation);
    const { db } = database;
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
    options.deletionOperation?.handoffToRetry(database);
  }, options);
}

export function deleteGroveInstallRecord(
  agentId: string,
  options: BranchStateDatabaseOptions & { expectedStatuses?: GroveInstallStatus[] } = {},
): void {
  runBranchStateWriteTransaction((database) => {
    assertAgentDeletionAllowsMutation(database, agentId);
    const { db } = database;
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
  return readGroveInstallRecordsInDatabase(openBranchStateDatabase(options).db);
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
  const updatedAtMs = options.nowMs ?? Date.now();
  const status = options.status ?? "complete";
  const agentConfigDigest = options.agentConfigDigest ?? digestGroveValue(plan.agent.config);
  const ownedAgentPaths = plan.actions
    .filter((action) => action.kind === "agent")
    .map((action) => action.target);
  const record = runBranchStateWriteTransaction((database) => {
    assertAgentDeletionAllowsMutation(database, plan.agent.finalId);
    const { db } = database;
    const current = readGroveInstallRecordFromDatabase(db, plan.agent.finalId);
    if (!current) {
      throw new Error(
        `No Grove install record exists for agent ${JSON.stringify(plan.agent.finalId)}.`,
      );
    }
    const bootstrap = bootstrapProvenance(plan) ?? current.bootstrap;
    const ownership = encodeGroveAgentOwnership(ownedAgentPaths, current.agentOrigin);
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
    return {
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
  }, options);
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
  return runBranchStateWriteTransaction(
    ({ db }) => updateClawPackageRefStatusInDatabase(db, ref, status, options.nowMs ?? Date.now()),
    options,
  );
}

export function readClawPackageRefs(
  options: BranchStateDatabaseOptions & ClawPackageRefQuery = {},
): PersistedClawPackageRef[] {
  return readClawPackageRefsInDatabase(openBranchStateDatabase(options).db, options);
}

function upgradeGroveInstallSchema<
  TRecord extends {
    schemaVersion: installRecordSchema.GroveInstallRecordSchemaVersion;
    planIntegrity: string;
    agentConfigDigest: string;
  },
>(
  database: BranchStateDatabase,
  agentId: string,
  record: TRecord,
  expectedRecord: TRecord | undefined,
  replacement?: Pick<TRecord, "planIntegrity" | "agentConfigDigest">,
): Omit<TRecord, "schemaVersion"> & {
  schemaVersion: typeof installRecordSchema.GROVE_INSTALL_RECORD_SCHEMA_VERSION;
} {
  assertAgentDeletionAllowsMutation(database, agentId);
  if (!expectedRecord || stableStringify(record) !== stableStringify(expectedRecord)) {
    throw new Error(
      `Legacy Grove install record for agent ${JSON.stringify(agentId)} is not an exact resumable attempt.`,
    );
  }
  database.db /* sqlite-allow-raw: exact legacy retry atomically replaces the consent-bound plan identity. */
    .prepare(
      `UPDATE grove_installs
          SET schema_version = ?, plan_integrity = ?, agent_config_digest = ?
        WHERE agent_id = ?`,
    )
    .run(
      installRecordSchema.GROVE_INSTALL_RECORD_SCHEMA_VERSION,
      replacement?.planIntegrity ?? record.planIntegrity,
      replacement?.agentConfigDigest ?? record.agentConfigDigest,
      agentId,
    );
  return {
    ...record,
    ...replacement,
    schemaVersion: installRecordSchema.GROVE_INSTALL_RECORD_SCHEMA_VERSION,
  };
}

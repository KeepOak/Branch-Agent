import type { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { withSkillFoundationWrite } from "./foundation-write.js";
import {
  validatePhysicalLifecycleManifest,
  physicalLifecycleManifestSha256,
} from "./lifecycle-physical-model.js";
import type {
  PhysicalLifecycleManifest,
  PhysicalLifecycleExecution,
} from "./lifecycle-physical-model.js";
import { hashSkillProposalRevision } from "./revision-hash.js";
import {
  readSkillLifecyclePlansInDatabase,
  readOwnedSkillFilesInDatabase,
  activateRestoredSkillLifecyclePlanInDatabase,
} from "./store-sqlite-lifecycle.js";
import type { SkillProposalRecord } from "./types.js";
import { requireSkillFoundationAgentId } from "./undo-identity.js";
export const SKILL_LIFECYCLE_PHYSICAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skill_gardener_physical_executions (
 owner_agent_id TEXT NOT NULL,run_id TEXT NOT NULL,execution_json TEXT NOT NULL,execution_sha256 TEXT NOT NULL,
 PRIMARY KEY(owner_agent_id,run_id)
) STRICT;`;
export function readOwnedSkillProposalForFileInDatabase(
  db: DatabaseSync,
  params: { agentId: string; skillFile: string },
): SkillProposalRecord | null {
  requireSkillFoundationAgentId(params.agentId);
  if (!readOwnedSkillFilesInDatabase(db, params.agentId).includes(params.skillFile)) return null;
  // sqlite-allow-raw -- Original applied owner provenance, never an inventory-label ownership claim.
  const rows = db
    .prepare(`SELECT p.record_json FROM skill_workshop_proposals p WHERE p.owner_agent_id=? AND p.status='applied'
    AND NOT EXISTS(SELECT 1 FROM skill_workshop_undo_executions e WHERE e.proposal_id=p.proposal_id AND json_extract(e.execution_json,'$.phase')='restored') ORDER BY p.applied_at DESC`)
    .all(params.agentId) as Array<{ record_json: string }>;
  return (
    rows
      .map((row) => JSON.parse(row.record_json) as SkillProposalRecord)
      .find(
        (record) =>
          record.target.source === "branch-workshop" &&
          record.target.skillFile === params.skillFile,
      ) ?? null
  );
}
function assertManifestProposal(db: DatabaseSync, manifest: PhysicalLifecycleManifest) {
  const record = readOwnedSkillProposalForFileInDatabase(db, {
    agentId: manifest.agentId,
    skillFile: manifest.skillFile,
  });
  if (
    !record ||
    record.id !== manifest.proposalId ||
    hashSkillProposalRevision(record) !== manifest.proposalRevisionSha256
  )
    throw Error("Physical lifecycle proposal ownership or revision changed.");
}
function assertArchivePlan(db: DatabaseSync, manifest: PhysicalLifecycleManifest) {
  assertManifestProposal(db, manifest);
  const plan = readSkillLifecyclePlansInDatabase(db, manifest.agentId).find(
    (plan) => plan.skillFile === manifest.skillFile,
  );
  if (
    !plan ||
    plan.revision !== manifest.expectedRevision ||
    plan.plannedState !== "archived" ||
    plan.pinned
  )
    throw Error("Physical archive requires an exact unpinned archive plan.");
}
export function readPhysicalLifecycleExecutionInDatabase(
  db: DatabaseSync,
  params: { agentId: string; runId: string },
): PhysicalLifecycleExecution | null {
  requireSkillFoundationAgentId(params.agentId);
  // sqlite-allow-raw -- Owner-scoped durable move/recovery custody.
  const row = db
    .prepare(
      "SELECT execution_json,execution_sha256 FROM skill_gardener_physical_executions WHERE owner_agent_id=? AND run_id=?",
    )
    .get(params.agentId, params.runId) as
    | { execution_json: string; execution_sha256: string }
    | undefined;
  if (!row) return null;
  if (sha256Hex(row.execution_json) !== row.execution_sha256)
    throw Error("Physical lifecycle execution is corrupt.");
  const execution = JSON.parse(row.execution_json) as PhysicalLifecycleExecution;
  const manifest = validatePhysicalLifecycleManifest(execution.manifest);
  if (
    Object.keys(execution).some(
      (key) =>
        !["manifest", "manifestSha256", "phase", "restoreId", "restoreRevision"].includes(key),
    ) ||
    manifest.agentId !== params.agentId ||
    manifest.runId !== params.runId ||
    physicalLifecycleManifestSha256(manifest) !== execution.manifestSha256 ||
    !["prepared", "archived", "restore-prepared", "restored"].includes(execution.phase) ||
    (["restore-prepared", "restored"].includes(execution.phase) &&
      (typeof execution.restoreId !== "string" ||
        !execution.restoreId ||
        execution.restoreId !== execution.restoreId.trim() ||
        !Number.isSafeInteger(execution.restoreRevision) ||
        execution.restoreRevision! < 1)) ||
    (["prepared", "archived"].includes(execution.phase) &&
      (execution.restoreId !== undefined || execution.restoreRevision !== undefined))
  )
    throw Error("Physical lifecycle execution identity changed.");
  assertManifestProposal(db, manifest);
  return execution;
}
function writeExecution(db: DatabaseSync, execution: PhysicalLifecycleExecution) {
  const json = JSON.stringify(execution);
  // sqlite-allow-raw -- Atomic durable phase change in the existing admitted Workshop transaction.
  db.prepare(`INSERT INTO skill_gardener_physical_executions VALUES (?,?,?,?)
    ON CONFLICT(owner_agent_id,run_id) DO UPDATE SET execution_json=excluded.execution_json,execution_sha256=excluded.execution_sha256`).run(
    execution.manifest.agentId,
    execution.manifest.runId,
    json,
    sha256Hex(json),
  );
}
export function preparePhysicalLifecycleArchiveInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    manifest: PhysicalLifecycleManifest;
    cronReferencesComplete: boolean;
    referencedByCron: boolean;
  },
  assertCurrent: () => void,
) {
  const request = structuredClone(params);
  const manifest = validatePhysicalLifecycleManifest(request.manifest);
  if (
    request.agentId !== manifest.agentId ||
    request.cronReferencesComplete !== true ||
    request.referencedByCron !== false
  )
    throw Error("Physical archive requires exact owner and complete unprotected cron facts.");
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const prior = readPhysicalLifecycleExecutionInDatabase(db, {
      agentId: request.agentId,
      runId: manifest.runId,
    });
    if (prior) {
      if (prior.manifestSha256 !== physicalLifecycleManifestSha256(manifest))
        throw Error("Physical lifecycle run conflict.");
      return prior;
    }
    assertArchivePlan(db, manifest);
    const execution: PhysicalLifecycleExecution = {
      manifest,
      manifestSha256: physicalLifecycleManifestSha256(manifest),
      phase: "prepared",
    };
    writeExecution(db, execution);
    return execution;
  });
}
export function completePhysicalLifecycleArchiveInDatabase(
  db: DatabaseSync,
  params: { agentId: string; runId: string; observedTreeSha256: string; sourceAbsent: boolean },
  assertCurrent: () => void,
) {
  const request = structuredClone(params);
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const execution = readPhysicalLifecycleExecutionInDatabase(db, request);
    if (
      !execution ||
      !["prepared", "archived"].includes(execution.phase) ||
      request.sourceAbsent !== true ||
      request.observedTreeSha256 !== execution.manifest.treeSha256
    )
      throw Error("Archive move has not established its exact retained tree.");
    assertArchivePlan(db, execution.manifest);
    if (execution.phase === "archived") return execution;
    const archived: PhysicalLifecycleExecution = { ...execution, phase: "archived" };
    writeExecution(db, archived);
    return archived;
  });
}
export function preparePhysicalLifecycleRestoreInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    runId: string;
    restoreId: string;
    expectedRevision: number;
    restoreInventoryComplete: boolean;
    nameCollision: boolean;
  },
  assertCurrent: () => void,
) {
  const request = structuredClone(params);
  if (
    !request.restoreId ||
    request.restoreId !== request.restoreId.trim() ||
    request.restoreInventoryComplete !== true ||
    request.nameCollision !== false
  )
    throw Error("Restore requires an explicit id and complete collision-free inventory.");
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const execution = readPhysicalLifecycleExecutionInDatabase(db, request);
    if (!execution || execution.phase === "prepared")
      throw Error("Only a committed owned archive can be restored.");
    if (execution.restoreId) {
      if (
        execution.restoreId !== request.restoreId ||
        execution.restoreRevision !== request.expectedRevision
      )
        throw Error("Restore execution identity conflict.");
      return execution;
    }
    const plan = readSkillLifecyclePlansInDatabase(db, request.agentId).find(
      (plan) => plan.skillFile === execution.manifest.skillFile,
    );
    if (!plan || plan.revision !== request.expectedRevision || plan.plannedState !== "archived")
      throw Error("Restore plan changed.");
    const restoring: PhysicalLifecycleExecution = {
      ...execution,
      phase: "restore-prepared",
      restoreId: request.restoreId,
      restoreRevision: request.expectedRevision,
    };
    writeExecution(db, restoring);
    return restoring;
  });
}
export function completePhysicalLifecycleRestoreInDatabase(
  db: DatabaseSync,
  params: { agentId: string; runId: string; observedTreeSha256: string; archiveAbsent: boolean },
  assertCurrent: () => void,
) {
  const request = structuredClone(params);
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const execution = readPhysicalLifecycleExecutionInDatabase(db, request);
    if (
      !execution ||
      !["restore-prepared", "restored"].includes(execution.phase) ||
      request.archiveAbsent !== true ||
      request.observedTreeSha256 !== execution.manifest.treeSha256
    )
      throw Error("Restore move has not established its exact original tree.");
    if (execution.phase === "restored") return execution;
    activateRestoredSkillLifecyclePlanInDatabase(db, {
      agentId: request.agentId,
      skillFile: execution.manifest.skillFile,
      expectedRevision: execution.restoreRevision!,
    });
    const restored: PhysicalLifecycleExecution = { ...execution, phase: "restored" };
    writeExecution(db, restored);
    return restored;
  });
}

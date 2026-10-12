import path from "node:path";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { hashSkillProposalRevision } from "./revision-hash.js";
import type { SkillProposalRecord, SkillProposalRollback } from "./types.js";

export type AppliedSkillUndoIdentity = {
  schema: "branch.skill-proposal-undo.v1";
  proposalId: string;
  agentId: string;
  targetSkillFile: string;
  revisionSha256: string;
  appliedRecordSha256: string;
  rollbackSha256: string;
  targetTreeSha256: string;
  appliedAt: string;
};
const HASH = /^[a-f0-9]{64}$/u;
export function requireSkillFoundationAgentId(agentId: string): void {
  if (typeof agentId !== "string" || !agentId.trim() || agentId !== agentId.trim()) {
    throw new Error("An exact active agent id is required.");
  }
}
export function skillRollbackIdentityHash(rollback: SkillProposalRollback): string {
  return sha256Hex(
    JSON.stringify({
      schema: rollback.schema,
      proposalId: rollback.proposalId,
      writtenAt: rollback.writtenAt,
      targetSkillFile: rollback.targetSkillFile,
      action: rollback.action,
      previousContentHash: rollback.previousContentHash,
      previousContent: rollback.previousContent,
      supportFiles: (rollback.supportFiles ?? [])
        .map((file) => ({
          path: file.path,
          existed: file.existed,
          previousContentHash: file.previousContentHash,
          previousContent: file.previousContent,
        }))
        .toSorted((a, b) => a.path.localeCompare(b.path)),
    }),
  );
}
export function validateAppliedSkillUndoIdentity(raw: unknown): AppliedSkillUndoIdentity {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid applied skill undo identity.");
  }
  const value = raw as AppliedSkillUndoIdentity;
  requireSkillFoundationAgentId(value.agentId);
  const keys = [
    "schema",
    "proposalId",
    "agentId",
    "targetSkillFile",
    "revisionSha256",
    "appliedRecordSha256",
    "rollbackSha256",
    "targetTreeSha256",
    "appliedAt",
  ];
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.schema !== "branch.skill-proposal-undo.v1" ||
    typeof value.proposalId !== "string" ||
    !value.proposalId ||
    typeof value.targetSkillFile !== "string" ||
    !path.isAbsolute(value.targetSkillFile) ||
    typeof value.appliedAt !== "string" ||
    !Number.isFinite(Date.parse(value.appliedAt)) ||
    [
      value.revisionSha256,
      value.appliedRecordSha256,
      value.rollbackSha256,
      value.targetTreeSha256,
    ].some((hash) => typeof hash !== "string" || !HASH.test(hash))
  ) {
    throw new Error("Invalid applied skill undo identity.");
  }
  return value;
}
export function createAppliedSkillUndoIdentity(params: {
  agentId: string;
  record: SkillProposalRecord;
  rollback: SkillProposalRollback;
  revisionSha256: string;
  targetTreeSha256: string;
}): AppliedSkillUndoIdentity {
  const { record, rollback } = params;
  if (
    record.status !== "applied" ||
    !record.appliedAt ||
    rollback.proposalId !== record.id ||
    rollback.targetSkillFile !== record.target.skillFile ||
    rollback.action !== record.kind ||
    params.revisionSha256 !== hashSkillProposalRevision(record) ||
    (rollback.action === "update" &&
      (typeof rollback.previousContent !== "string" ||
        sha256Hex(rollback.previousContent) !== rollback.previousContentHash))
  ) {
    throw new Error("Applied proposal and retained rollback do not match.");
  }
  for (const file of rollback.supportFiles ?? []) {
    if (
      file.existed &&
      (typeof file.previousContent !== "string" ||
        sha256Hex(file.previousContent) !== file.previousContentHash)
    ) {
      throw new Error("Retained skill support-file preimage is invalid.");
    }
  }
  return validateAppliedSkillUndoIdentity({
    schema: "branch.skill-proposal-undo.v1",
    proposalId: record.id,
    agentId: params.agentId,
    targetSkillFile: record.target.skillFile,
    revisionSha256: params.revisionSha256,
    appliedRecordSha256: sha256Hex(JSON.stringify(record)),
    rollbackSha256: skillRollbackIdentityHash(rollback),
    targetTreeSha256: params.targetTreeSha256,
    appliedAt: record.appliedAt,
  });
}
/** A caller must read the live tree under its current target lease before this check. */
export function assertAppliedSkillUndoCurrent(
  receipt: AppliedSkillUndoIdentity,
  current: {
    agentId: string;
    proposalId: string;
    revisionSha256: string;
    targetTreeSha256: string;
    assertCurrent: () => void;
  },
): void {
  current.assertCurrent();
  validateAppliedSkillUndoIdentity(receipt);
  if (
    receipt.agentId !== current.agentId ||
    receipt.proposalId !== current.proposalId ||
    receipt.revisionSha256 !== current.revisionSha256 ||
    receipt.targetTreeSha256 !== current.targetTreeSha256
  ) {
    throw new Error("Applied skill undo identity or current target changed.");
  }
  current.assertCurrent();
}

export type PreparedSkillUndoIdentity = {
  schema: "branch.skill-proposal-undo-intent.v1";
  proposalId: string;
  agentId: string;
  targetSkillFile: string;
  revisionSha256: string;
  rollbackSha256: string;
  beforeTreeSha256: string;
  expectedTreeSha256: string;
  preparedAt: string;
};
export function validatePreparedSkillUndoIdentity(raw: unknown): PreparedSkillUndoIdentity {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid prepared undo identity.");
  const value = raw as PreparedSkillUndoIdentity;
  requireSkillFoundationAgentId(value.agentId);
  const keys = [
    "schema",
    "proposalId",
    "agentId",
    "targetSkillFile",
    "revisionSha256",
    "rollbackSha256",
    "beforeTreeSha256",
    "expectedTreeSha256",
    "preparedAt",
  ];
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.schema !== "branch.skill-proposal-undo-intent.v1" ||
    typeof value.proposalId !== "string" ||
    !value.proposalId ||
    typeof value.targetSkillFile !== "string" ||
    !path.isAbsolute(value.targetSkillFile) ||
    typeof value.preparedAt !== "string" ||
    !Number.isFinite(Date.parse(value.preparedAt)) ||
    [
      value.revisionSha256,
      value.rollbackSha256,
      value.beforeTreeSha256,
      value.expectedTreeSha256,
    ].some((hash) => typeof hash !== "string" || !HASH.test(hash))
  )
    throw new Error("Invalid prepared undo identity.");
  return value;
}
export function createPreparedSkillUndoIdentity(params: {
  agentId: string;
  record: SkillProposalRecord;
  rollback: SkillProposalRollback;
  beforeTreeSha256: string;
  expectedTreeSha256: string;
}): PreparedSkillUndoIdentity {
  if (
    params.record.status !== "pending" ||
    params.rollback.proposalId !== params.record.id ||
    params.rollback.targetSkillFile !== params.record.target.skillFile ||
    params.rollback.action !== params.record.kind
  ) {
    throw new Error("Prepared undo identity must bind the exact pending proposal.");
  }
  return validatePreparedSkillUndoIdentity({
    schema: "branch.skill-proposal-undo-intent.v1",
    agentId: params.agentId,
    proposalId: params.record.id,
    targetSkillFile: params.record.target.skillFile,
    revisionSha256: hashSkillProposalRevision(params.record),
    rollbackSha256: skillRollbackIdentityHash(params.rollback),
    beforeTreeSha256: params.beforeTreeSha256,
    expectedTreeSha256: params.expectedTreeSha256,
    preparedAt: params.rollback.writtenAt,
  });
}

import type { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { withSkillFoundationWrite } from "./foundation-write.js";
import { hashSkillProposalRevision } from "./revision-hash.js";
import type { SkillProposalRecord } from "./types.js";
import type { SkillProposalRollback } from "./types.js";
import {
  requireSkillFoundationAgentId,
  skillRollbackIdentityHash,
  validateAppliedSkillUndoIdentity,
  type AppliedSkillUndoIdentity,
  validatePreparedSkillUndoIdentity,
  type PreparedSkillUndoIdentity,
} from "./undo-identity.js";

export const SKILL_UNDO_RECEIPTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skill_workshop_undo_intents (
  proposal_id TEXT NOT NULL PRIMARY KEY,
  owner_agent_id TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  intent_sha256 TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES skill_workshop_proposal_rollbacks(proposal_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS skill_workshop_undo_receipts (
  proposal_id TEXT NOT NULL PRIMARY KEY,
  owner_agent_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES skill_workshop_proposals(proposal_id) ON DELETE CASCADE
) STRICT;
`;
type StoredBeforeImage = {
  owner_agent_id: string | null;
  record_json: string;
  status: string;
  written_at: string;
  target_skill_file: string;
  action: "create" | "update";
  previous_content_hash: string | null;
  previous_content: string | null;
  support_files_json: string | null;
};
function readBeforeImage(db: DatabaseSync, proposalId: string): StoredBeforeImage | undefined {
  // sqlite-allow-raw -- Receipt identity joins the existing owner/proposal/preimage stores.
  return db
    .prepare(`SELECT p.owner_agent_id, p.record_json, p.status, r.*
    FROM skill_workshop_proposals p JOIN skill_workshop_proposal_rollbacks r
      ON r.proposal_id=p.proposal_id WHERE p.proposal_id=?`)
    .get(proposalId) as StoredBeforeImage | undefined;
}
function verifyBeforeImage(receipt: AppliedSkillUndoIdentity, row: StoredBeforeImage): void {
  const rollback: SkillProposalRollback = {
    schema: "branch.skill-workshop.rollback.v1",
    proposalId: receipt.proposalId,
    writtenAt: row.written_at,
    targetSkillFile: row.target_skill_file,
    action: row.action,
    ...(row.previous_content_hash !== null
      ? { previousContentHash: row.previous_content_hash }
      : {}),
    ...(row.previous_content !== null ? { previousContent: row.previous_content } : {}),
    ...(row.support_files_json !== null
      ? { supportFiles: JSON.parse(row.support_files_json) }
      : {}),
  };
  const applied = JSON.parse(row.record_json) as SkillProposalRecord;
  if (
    applied.status !== "applied" ||
    applied.id !== receipt.proposalId ||
    applied.appliedAt !== receipt.appliedAt ||
    hashSkillProposalRevision(applied) !== receipt.revisionSha256 ||
    row.owner_agent_id !== receipt.agentId ||
    row.status !== "applied" ||
    sha256Hex(row.record_json) !== receipt.appliedRecordSha256 ||
    row.target_skill_file !== receipt.targetSkillFile ||
    skillRollbackIdentityHash(rollback) !== receipt.rollbackSha256
  ) {
    throw new Error("Applied skill undo receipt lost its owner, revision or preimage identity.");
  }
}
export function writePreparedSkillUndoIntentInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    intent: PreparedSkillUndoIdentity;
  },
  assertCurrent: () => void,
): void {
  const agentId = params.agentId;
  requireSkillFoundationAgentId(agentId);
  const intent = validatePreparedSkillUndoIdentity(structuredClone(params.intent));
  if (intent.agentId !== agentId) throw new Error("Prepared undo owner differs from active agent.");
  withSkillFoundationWrite(db, assertCurrent, () => {
    const before = readBeforeImage(db, intent.proposalId);
    if (!before || before.status !== "pending")
      throw new Error("Prepared undo needs a pending proposal and durable preimage.");
    verifyPreparedBeforeImage(intent, before);
    const json = JSON.stringify(intent);
    // sqlite-allow-raw -- Immutable journal retry, never silently rebind a pre-write snapshot.
    const prior = db
      .prepare("SELECT intent_json FROM skill_workshop_undo_intents WHERE proposal_id=?")
      .get(intent.proposalId) as { intent_json: string } | undefined;
    if (prior) {
      if (prior.intent_json !== json) throw new Error("Prepared undo intent conflict.");
      return;
    }
    // sqlite-allow-raw -- Published inside the existing rollback-journal write transaction.
    db.prepare("INSERT INTO skill_workshop_undo_intents VALUES (?,?,?,?)").run(
      intent.proposalId,
      agentId,
      json,
      sha256Hex(json),
    );
  });
}
function verifyPreparedBeforeImage(
  intent: PreparedSkillUndoIdentity,
  row: StoredBeforeImage,
): void {
  const record = JSON.parse(row.record_json) as SkillProposalRecord;
  const rollback: SkillProposalRollback = {
    schema: "branch.skill-workshop.rollback.v1",
    proposalId: intent.proposalId,
    writtenAt: row.written_at,
    targetSkillFile: row.target_skill_file,
    action: row.action,
    ...(row.previous_content_hash !== null
      ? { previousContentHash: row.previous_content_hash }
      : {}),
    ...(row.previous_content !== null ? { previousContent: row.previous_content } : {}),
    ...(row.support_files_json !== null
      ? { supportFiles: JSON.parse(row.support_files_json) }
      : {}),
  };
  if (
    row.owner_agent_id !== intent.agentId ||
    !["pending", "applied"].includes(row.status) ||
    record.id !== intent.proposalId ||
    record.target.skillFile !== intent.targetSkillFile ||
    row.target_skill_file !== intent.targetSkillFile ||
    row.written_at !== intent.preparedAt ||
    hashSkillProposalRevision(record) !== intent.revisionSha256 ||
    skillRollbackIdentityHash(rollback) !== intent.rollbackSha256
  ) {
    throw new Error("Prepared undo intent lost its owner, revision or preimage identity.");
  }
}
export function readPreparedSkillUndoIntentInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    proposalId: string;
  },
): PreparedSkillUndoIdentity | null {
  requireSkillFoundationAgentId(params.agentId);
  // sqlite-allow-raw -- Owner-scoped crash-recovery custody, never another agent's journal.
  const row = db
    .prepare(`SELECT intent_json,intent_sha256 FROM skill_workshop_undo_intents
    WHERE proposal_id=? AND owner_agent_id=?`)
    .get(params.proposalId, params.agentId) as
    | { intent_json: string; intent_sha256: string }
    | undefined;
  if (!row) return null;
  if (sha256Hex(row.intent_json) !== row.intent_sha256)
    throw new Error("Prepared undo intent is corrupt.");
  const intent = validatePreparedSkillUndoIdentity(JSON.parse(row.intent_json));
  if (intent.agentId !== params.agentId || intent.proposalId !== params.proposalId)
    throw new Error("Prepared undo identity changed.");
  const before = readBeforeImage(db, intent.proposalId);
  if (!before) throw new Error("Prepared undo preimage is unavailable.");
  verifyPreparedBeforeImage(intent, before);
  return intent;
}
function verifyReceiptIntent(db: DatabaseSync, receipt: AppliedSkillUndoIdentity): void {
  const intent = readPreparedSkillUndoIntentInDatabase(db, {
    agentId: receipt.agentId,
    proposalId: receipt.proposalId,
  });
  if (
    !intent ||
    intent.revisionSha256 !== receipt.revisionSha256 ||
    intent.rollbackSha256 !== receipt.rollbackSha256 ||
    intent.expectedTreeSha256 !== receipt.targetTreeSha256
  )
    throw new Error("Applied undo receipt does not match its durable pre-write intent.");
}
export function writeAppliedSkillUndoReceiptInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    receipt: AppliedSkillUndoIdentity;
  },
  assertCurrent: () => void,
): void {
  const agentId = params.agentId;
  requireSkillFoundationAgentId(agentId);
  const receipt = validateAppliedSkillUndoIdentity(structuredClone(params.receipt));
  if (receipt.agentId !== agentId)
    throw new Error("Undo receipt owner does not match active agent.");
  withSkillFoundationWrite(db, assertCurrent, () => {
    const before = readBeforeImage(db, receipt.proposalId);
    if (!before) throw new Error("Applied proposal has no retained rollback preimage.");
    verifyBeforeImage(receipt, before);
    verifyReceiptIntent(db, receipt);
    const json = JSON.stringify(receipt);
    // sqlite-allow-raw -- Immutable exact receipt retries, never overwrite another after-image.
    const existing = db
      .prepare("SELECT receipt_json FROM skill_workshop_undo_receipts WHERE proposal_id=?")
      .get(receipt.proposalId) as { receipt_json: string } | undefined;
    if (existing) {
      if (existing.receipt_json !== json) throw new Error("Applied skill undo receipt conflict.");
      return;
    }
    // sqlite-allow-raw -- Parameterized receipt metadata in the existing Workshop database.
    db.prepare("INSERT INTO skill_workshop_undo_receipts VALUES (?,?,?,?)").run(
      receipt.proposalId,
      agentId,
      json,
      sha256Hex(json),
    );
  });
}
export function readAppliedSkillUndoReceiptInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    proposalId: string;
  },
): AppliedSkillUndoIdentity | null {
  requireSkillFoundationAgentId(params.agentId);
  // sqlite-allow-raw -- Never reveal another agent's receipt or preimage existence.
  const row = db
    .prepare(`SELECT receipt_json, receipt_sha256 FROM skill_workshop_undo_receipts
    WHERE proposal_id=? AND owner_agent_id=?`)
    .get(params.proposalId, params.agentId) as
    | { receipt_json: string; receipt_sha256: string }
    | undefined;
  if (!row) return null;
  if (sha256Hex(row.receipt_json) !== row.receipt_sha256)
    throw new Error("Applied undo receipt is corrupt.");
  const receipt = validateAppliedSkillUndoIdentity(JSON.parse(row.receipt_json));
  if (receipt.agentId !== params.agentId || receipt.proposalId !== params.proposalId) {
    throw new Error("Applied undo receipt identity changed.");
  }
  const before = readBeforeImage(db, params.proposalId);
  if (!before) throw new Error("Applied undo receipt preimage is unavailable.");
  verifyBeforeImage(receipt, before);
  verifyReceiptIntent(db, receipt);
  return receipt;
}

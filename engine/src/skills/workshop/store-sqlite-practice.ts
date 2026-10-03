import type { DatabaseSync } from "node:sqlite";
import { withSkillFoundationWrite } from "./foundation-write.js";
import {
  validateSkillPracticeEvidence,
  skillPracticeEvidenceSha256,
  type SkillPracticeEvidence,
} from "./practice-evidence.js";
import { hashSkillProposalRevision } from "./revision-hash.js";
import type { SkillProposalRecord } from "./types.js";
import { requireSkillFoundationAgentId } from "./undo-identity.js";

export const SKILL_PRACTICE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skill_workshop_practice_evidence (
  owner_agent_id TEXT NOT NULL, evidence_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
  revision_sha256 TEXT NOT NULL, evidence_json TEXT NOT NULL, evidence_sha256 TEXT NOT NULL,
  PRIMARY KEY (owner_agent_id, evidence_id),
  FOREIGN KEY (proposal_id) REFERENCES skill_workshop_proposals(proposal_id) ON DELETE CASCADE
) STRICT;
`;
function assertOwnedPracticeRevision(db: DatabaseSync, evidence: SkillPracticeEvidence): void {
  // sqlite-allow-raw -- Exact persisted proposal owner/revision binds this experiment evidence.
  const row = db
    .prepare(`SELECT record_json FROM skill_workshop_proposals
    WHERE proposal_id=? AND owner_agent_id=?`)
    .get(evidence.proposalId, evidence.agentId) as { record_json: string } | undefined;
  if (!row) throw new Error("Practice proposal is not owned by this active agent.");
  const record = JSON.parse(row.record_json) as SkillProposalRecord;
  if (
    record.id !== evidence.proposalId ||
    hashSkillProposalRevision(record) !== evidence.revisionSha256
  ) {
    throw new Error("Practice proposal revision changed.");
  }
}
export function writeSkillPracticeEvidenceInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    evidence: SkillPracticeEvidence;
  },
  assertCurrent: () => void,
): void {
  const agentId = params.agentId;
  requireSkillFoundationAgentId(agentId);
  const evidence = validateSkillPracticeEvidence(structuredClone(params.evidence));
  if (evidence.agentId !== agentId)
    throw new Error("Practice evidence owner differs from active agent.");
  withSkillFoundationWrite(db, assertCurrent, () => {
    assertOwnedPracticeRevision(db, evidence);
    const json = JSON.stringify(evidence);
    // sqlite-allow-raw -- Immutable retry; evidence id never rebinds another experiment.
    const prior = db
      .prepare(`SELECT evidence_json FROM skill_workshop_practice_evidence
      WHERE owner_agent_id=? AND evidence_id=?`)
      .get(agentId, evidence.evidenceId) as { evidence_json: string } | undefined;
    if (prior) {
      if (prior.evidence_json !== json) throw new Error("Practice evidence identity conflict.");
      return;
    }
    // sqlite-allow-raw -- Parameterized references, no fabricated grades or adoption outcome.
    db.prepare("INSERT INTO skill_workshop_practice_evidence VALUES (?,?,?,?,?,?)").run(
      agentId,
      evidence.evidenceId,
      evidence.proposalId,
      evidence.revisionSha256,
      json,
      skillPracticeEvidenceSha256(evidence),
    );
  });
}
export function readSkillPracticeEvidenceInDatabase(
  db: DatabaseSync,
  params: {
    agentId: string;
    evidenceId: string;
  },
): { status: "recorded-unverified"; evidence: SkillPracticeEvidence } | null {
  requireSkillFoundationAgentId(params.agentId);
  // sqlite-allow-raw -- Scoped reference read does not disclose another agent's proof tasks.
  const row = db
    .prepare(`SELECT proposal_id, revision_sha256, evidence_json, evidence_sha256
    FROM skill_workshop_practice_evidence WHERE owner_agent_id=? AND evidence_id=?`)
    .get(params.agentId, params.evidenceId) as
    | {
        proposal_id: string;
        revision_sha256: string;
        evidence_json: string;
        evidence_sha256: string;
      }
    | undefined;
  if (!row) return null;
  const evidence = validateSkillPracticeEvidence(JSON.parse(row.evidence_json));
  if (
    evidence.agentId !== params.agentId ||
    evidence.evidenceId !== params.evidenceId ||
    evidence.proposalId !== row.proposal_id ||
    evidence.revisionSha256 !== row.revision_sha256 ||
    skillPracticeEvidenceSha256(evidence) !== row.evidence_sha256
  )
    throw new Error("Stored practice evidence is corrupt.");
  assertOwnedPracticeRevision(db, evidence);
  return { status: "recorded-unverified", evidence };
}

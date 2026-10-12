import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { requireSkillFoundationAgentId } from "./undo-identity.js";

/** References from a trusted experiment producer, not a claim that grading was verified. */
export type SkillPracticeEvidence = {
  schema: "branch.skill-practice-evidence.v1";
  evidenceId: string;
  agentId: string;
  proposalId: string;
  revisionSha256: string;
  baselineTreeSha256: string;
  draftedTaskIds: string[];
  proofs: Array<{
    taskId: string;
    environment: "ready" | "failed" | "unknown";
    baselineRunId: string;
    candidateRunId: string;
    judgeRunIds: string[];
    artifactSha256: string;
  }>;
};
const HASH = /^[a-f0-9]{64}$/u;
const isHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value === value.trim();
export function validateSkillPracticeEvidence(raw: unknown): SkillPracticeEvidence {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid practice evidence.");
  const value = raw as SkillPracticeEvidence;
  requireSkillFoundationAgentId(value.agentId);
  const keys = [
    "schema",
    "evidenceId",
    "agentId",
    "proposalId",
    "revisionSha256",
    "baselineTreeSha256",
    "draftedTaskIds",
    "proofs",
  ];
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.schema !== "branch.skill-practice-evidence.v1" ||
    !identity(value.evidenceId) ||
    !identity(value.proposalId) ||
    !isHash(value.revisionSha256) ||
    !isHash(value.baselineTreeSha256) ||
    !Array.isArray(value.draftedTaskIds) ||
    value.draftedTaskIds.some((id) => !identity(id)) ||
    new Set(value.draftedTaskIds).size !== value.draftedTaskIds.length ||
    !Array.isArray(value.proofs)
  ) {
    throw new Error("Invalid practice evidence identity.");
  }
  const tasks = new Set<string>();
  const ready: SkillPracticeEvidence["proofs"] = [];
  const proofKeys = [
    "taskId",
    "environment",
    "baselineRunId",
    "candidateRunId",
    "judgeRunIds",
    "artifactSha256",
  ];
  for (const proof of value.proofs) {
    if (
      !proof ||
      typeof proof !== "object" ||
      Object.keys(proof).some((key) => !proofKeys.includes(key)) ||
      !identity(proof.taskId) ||
      tasks.has(proof.taskId) ||
      !["ready", "failed", "unknown"].includes(proof.environment) ||
      !identity(proof.baselineRunId) ||
      !identity(proof.candidateRunId) ||
      proof.baselineRunId === proof.candidateRunId ||
      !isHash(proof.artifactSha256) ||
      !Array.isArray(proof.judgeRunIds) ||
      proof.judgeRunIds.some((id) => !identity(id)) ||
      new Set(proof.judgeRunIds).size !== proof.judgeRunIds.length ||
      proof.judgeRunIds.some((id) => id === proof.baselineRunId || id === proof.candidateRunId)
    ) {
      throw new Error("Invalid or duplicate practice task/run identity.");
    }
    tasks.add(proof.taskId);
    if (proof.environment === "ready") {
      if (proof.judgeRunIds.length !== 3)
        throw new Error("Ready proof tasks require three distinct grader run references.");
      ready.push(proof);
    }
  }
  if (ready.length < 2 || !ready.some((proof) => !value.draftedTaskIds.includes(proof.taskId))) {
    throw new Error("Practice needs at least two ready proof tasks and one held-out task.");
  }
  return value;
}
export function skillPracticeEvidenceSha256(evidence: SkillPracticeEvidence): string {
  return sha256Hex(JSON.stringify(validateSkillPracticeEvidence(evidence)));
}

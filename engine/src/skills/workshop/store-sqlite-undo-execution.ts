import type { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "@branch/normalization-core/node-crypto";
import { withSkillFoundationWrite } from "./foundation-write.js";
import {
  readAppliedSkillUndoReceiptInDatabase,
  readPreparedSkillUndoIntentInDatabase,
} from "./store-sqlite-undo.js";
import { requireSkillFoundationAgentId } from "./undo-identity.js";

export type SkillUndoExecution = {
  schema: "branch.skill-undo-execution.v1";
  agentId: string;
  proposalId: string;
  receiptSha256: string;
  beforeTreeSha256: string;
  afterTreeSha256: string;
  phase: "prepared" | "restored";
};
export const SKILL_UNDO_EXECUTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS skill_workshop_undo_executions (
  proposal_id TEXT PRIMARY KEY, owner_agent_id TEXT NOT NULL,
  execution_json TEXT NOT NULL, execution_sha256 TEXT NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES skill_workshop_undo_receipts(proposal_id) ON DELETE CASCADE
) STRICT;
`;
function custody(
  db: DatabaseSync,
  agentId: string,
  proposalId: string,
): Omit<SkillUndoExecution, "phase"> {
  requireSkillFoundationAgentId(agentId);
  const receipt = readAppliedSkillUndoReceiptInDatabase(db, { agentId, proposalId });
  const intent = readPreparedSkillUndoIntentInDatabase(db, { agentId, proposalId });
  if (!receipt || !intent)
    throw new Error("Undo requires an owned applied receipt and original prepared intent.");
  return {
    schema: "branch.skill-undo-execution.v1",
    agentId,
    proposalId,
    receiptSha256: sha256Hex(JSON.stringify(receipt)),
    beforeTreeSha256: intent.beforeTreeSha256,
    afterTreeSha256: receipt.targetTreeSha256,
  };
}
export function readSkillUndoExecutionInDatabase(
  db: DatabaseSync,
  params: { agentId: string; proposalId: string },
): SkillUndoExecution | null {
  requireSkillFoundationAgentId(params.agentId);
  // sqlite-allow-raw -- Exact owner namespace and immutable execution custody.
  const row = db
    .prepare(
      "SELECT execution_json,execution_sha256 FROM skill_workshop_undo_executions WHERE proposal_id=? AND owner_agent_id=?",
    )
    .get(params.proposalId, params.agentId) as
    | { execution_json: string; execution_sha256: string }
    | undefined;
  if (!row) return null;
  if (sha256Hex(row.execution_json) !== row.execution_sha256)
    throw new Error("Undo execution is corrupt.");
  const value = JSON.parse(row.execution_json) as SkillUndoExecution;
  if (
    !["prepared", "restored"].includes(value.phase) ||
    JSON.stringify({ ...value, phase: undefined }) !==
      JSON.stringify(custody(db, params.agentId, params.proposalId))
  )
    throw new Error("Undo execution identity changed.");
  return value;
}
export function prepareSkillUndoExecutionInDatabase(
  db: DatabaseSync,
  params: { agentId: string; proposalId: string; observedTreeSha256: string },
  assertCurrent: () => void,
): SkillUndoExecution {
  const request = structuredClone(params);
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const expected = custody(db, request.agentId, request.proposalId);
    const prior = readSkillUndoExecutionInDatabase(db, request);
    if (prior) return prior;
    if (request.observedTreeSha256 !== expected.afterTreeSha256)
      throw new Error("Undo target changed before preparation.");
    const execution: SkillUndoExecution = { ...expected, phase: "prepared" };
    const json = JSON.stringify(execution);
    // sqlite-allow-raw -- Durable pre-write undo intent within the original worker transaction.
    db.prepare("INSERT INTO skill_workshop_undo_executions VALUES (?,?,?,?)").run(
      request.proposalId,
      request.agentId,
      json,
      sha256Hex(json),
    );
    return execution;
  });
}
export function completeSkillUndoExecutionInDatabase(
  db: DatabaseSync,
  params: { agentId: string; proposalId: string; observedTreeSha256: string },
  assertCurrent: () => void,
): SkillUndoExecution {
  const request = structuredClone(params);
  return withSkillFoundationWrite(db, assertCurrent, () => {
    const execution = readSkillUndoExecutionInDatabase(db, request);
    if (!execution || request.observedTreeSha256 !== execution.beforeTreeSha256)
      throw new Error("Undo restoration has not established its original whole-tree identity.");
    if (execution.phase === "restored") return execution;
    const restored: SkillUndoExecution = { ...execution, phase: "restored" };
    const json = JSON.stringify(restored);
    // sqlite-allow-raw -- Monotonic phase transition, retaining original proposal/journal/receipt history.
    db.prepare(
      "UPDATE skill_workshop_undo_executions SET execution_json=?,execution_sha256=? WHERE proposal_id=? AND owner_agent_id=?",
    ).run(json, sha256Hex(json), request.proposalId, request.agentId);
    return restored;
  });
}

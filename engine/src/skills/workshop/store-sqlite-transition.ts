import type { DatabaseSync } from "node:sqlite";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import {
  appendSkillProposalEvent,
  readStoredSkillProposalEventInDatabase,
  type NewSkillProposalEvent,
} from "./store-sqlite-event.js";
import { readStoredProposalInDatabase, updateProposal } from "./store-sqlite-record.js";
import type { SkillWorkshopDatabase } from "./store-sqlite-schema.js";
import { writeAppliedSkillUndoReceiptInDatabase } from "./store-sqlite-undo.js";
import type { SkillProposalEvent, SkillProposalRecord } from "./types.js";
import type { AppliedSkillUndoIdentity } from "./undo-identity.js";

export type PendingSkillProposalTransitionCommit =
  | { state: "committed"; event: SkillProposalEvent }
  | { state: "conflict"; current?: SkillProposalRecord };

export type CommitPendingSkillProposalTransitionInput = {
  expected: SkillProposalRecord;
  record: SkillProposalRecord;
  event: NewSkillProposalEvent;
  invalidateRollback?: boolean;
  undoReceipt?: AppliedSkillUndoIdentity;
};

export type ReadCommittedSkillProposalTransitionInput = {
  record: SkillProposalRecord;
  event: NewSkillProposalEvent;
};

export function commitPendingSkillProposalTransitionInDatabase(
  db: DatabaseSync,
  params: CommitPendingSkillProposalTransitionInput,
  assertReceiptAuthority?: () => void,
): PendingSkillProposalTransitionCommit {
  const kysely = getNodeSqliteKysely<SkillWorkshopDatabase>(db);
  const current = readStoredProposalInDatabase(db, params.expected.id);
  if (
    !current ||
    current.record.status !== "pending" ||
    current.row.record_json !== JSON.stringify(params.expected)
  ) {
    return {
      state: "conflict" as const,
      ...(current ? { current: current.record } : {}),
    };
  }
  if (params.invalidateRollback) {
    executeSqliteQuerySync(
      db,
      kysely
        .deleteFrom("skill_workshop_proposal_rollbacks")
        .where("proposal_id", "=", params.expected.id),
    );
  }
  if (
    params.undoReceipt &&
    (params.expected.id !== params.record.id ||
      params.undoReceipt.proposalId !== params.expected.id ||
      params.record.target.skillFile !== params.expected.target.skillFile ||
      params.undoReceipt.targetSkillFile !== params.expected.target.skillFile ||
      params.undoReceipt.agentId !== current.row.owner_agent_id)
  ) {
    throw new Error("Undo receipt must bind the exact pending owner and target.");
  }
  if (params.undoReceipt && (!assertReceiptAuthority || params.record.status !== "applied")) {
    throw new Error(
      "Applied undo receipt requires an applied transition and fresh worker authority.",
    );
  }
  updateProposal(db, current.row, params.record);
  if (params.undoReceipt) {
    writeAppliedSkillUndoReceiptInDatabase(
      db,
      {
        agentId: params.undoReceipt.agentId,
        receipt: params.undoReceipt,
      },
      assertReceiptAuthority!,
    );
  }
  return {
    state: "committed" as const,
    event: appendSkillProposalEvent(db, params.event),
  };
}

export function readCommittedSkillProposalTransitionInDatabase(
  db: DatabaseSync,
  params: ReadCommittedSkillProposalTransitionInput,
): Extract<PendingSkillProposalTransitionCommit, { state: "committed" }> | null {
  const stored = readStoredProposalInDatabase(db, params.record.id);
  if (!stored || stored.row.record_json !== JSON.stringify(params.record)) {
    return null;
  }
  const event = readStoredSkillProposalEventInDatabase(db, params.event.eventId);
  if (
    !event ||
    event.proposalId !== params.event.proposalId ||
    event.proposedVersion !== params.event.proposedVersion ||
    event.revisionHash !== params.event.revisionHash ||
    event.type !== params.event.type
  ) {
    return null;
  }
  return { state: "committed", event };
}

import type { DatabaseSync } from "node:sqlite";
import { requestSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import type { BranchStateDatabase } from "../../state/branch-state-db-contract.js";
import { runBranchStateWriteTransaction } from "../../state/branch-state-db.js";
import { assertBranchStateLeasesWorkerOwnedInTransaction } from "../../state/branch-state-lease-worker.js";
import type { BranchStateLeaseIdentity } from "../../state/branch-state-lease.types.js";
import type {
  WorkerOperationContext,
  WorkerOperationHandlers,
} from "../../state/worker-operation-registry.js";
import {
  listSkillCollectionReviewOutcomesInDatabase,
  readSkillCollectionBackupDropsInDatabase,
  recordSkillExperienceReviewOutcomeInDatabase,
} from "./collection-review.kernel.js";
import { assertSkillFoundationTransactionCurrent } from "./foundation-worker-guard.js";
import { readSkillGardenerStateInDatabase, recordSkillUsageInDatabase } from "./gardener.kernel.js";
import { readLifecyclePersistedProtectionInDatabase } from "./lifecycle-protection-state.js";
import { hashSkillProposalContent } from "./proposal-hash.js";
import { recordSkillProposalEvaluationInDatabase } from "./store-evaluation.kernel.js";
import {
  createSkillProposalInDatabase,
  importLegacySkillProposalInDatabase,
  listStoredSkillProposalsInDatabase,
  updateSkillProposalRecordInDatabase,
} from "./store-proposal.kernel.js";
import { listStoredSkillProposalEventsInDatabase } from "./store-sqlite-event.js";
import {
  readPhysicalLifecycleExecutionInDatabase,
  preparePhysicalLifecycleArchiveInDatabase,
  completePhysicalLifecycleArchiveInDatabase,
  preparePhysicalLifecycleRestoreInDatabase,
  completePhysicalLifecycleRestoreInDatabase,
  readOwnedSkillProposalForFileInDatabase,
} from "./store-sqlite-lifecycle-physical.js";
import { readOwnedSkillFilesInDatabase } from "./store-sqlite-lifecycle.js";
import {
  readSkillLifecycleRevisionInDatabase,
  setSkillLifecyclePinInDatabase,
  restoreSkillLifecyclePlanRunInDatabase,
} from "./store-sqlite-lifecycle.js";
import {
  planSkillLifecycleInDatabase,
  readSkillLifecyclePlansInDatabase,
} from "./store-sqlite-lifecycle.js";
import {
  readSkillPracticeEvidenceInDatabase,
  writeSkillPracticeEvidenceInDatabase,
} from "./store-sqlite-practice.js";
import { readStoredProposalInDatabase } from "./store-sqlite-record.js";
import {
  clearSkillProposalRollbackInDatabase,
  readSkillProposalRollbackInDatabase,
  writeSkillProposalRollbackInDatabase,
} from "./store-sqlite-rollback.js";
import { ensureSkillWorkshopSchemaInDatabase } from "./store-sqlite-schema.js";
import {
  commitPendingSkillProposalTransitionInDatabase,
  readCommittedSkillProposalTransitionInDatabase,
} from "./store-sqlite-transition.js";
import {
  readSkillUndoExecutionInDatabase,
  prepareSkillUndoExecutionInDatabase,
  completeSkillUndoExecutionInDatabase,
} from "./store-sqlite-undo-execution.js";
import {
  readAppliedSkillUndoReceiptInDatabase,
  readPreparedSkillUndoIntentInDatabase,
} from "./store-sqlite-undo.js";

type WorkshopInput<Value> = {
  value: Value;
  agentId?: string;
  leaseIdentities?: readonly BranchStateLeaseIdentity[];
};

function assertWrite(
  db: DatabaseSync,
  input: WorkshopInput<unknown>,
  stage: "transaction" | "commit",
) {
  if (input.leaseIdentities) {
    assertBranchStateLeasesWorkerOwnedInTransaction(db, input.leaseIdentities, stage);
  } else {
    requestSqliteWorkerOperationAdmission({ stage, facts: undefined });
  }
}

function write<T>(
  input: WorkshopInput<unknown>,
  { open, stateOptions }: WorkerOperationContext,
  operationLabel: string,
  operation: (database: BranchStateDatabase) => T,
  proposalId?: string,
): T {
  const database = open();
  return runBranchStateWriteTransaction(
    ({ db }) => {
      assertWrite(db, input, "transaction");
      if (input.leaseIdentities) {
        const stored = proposalId ? readStoredProposalInDatabase(db, proposalId) : null;
        const { agentId } = input;
        for (const identity of input.leaseIdentities) {
          if (
            !agentId ||
            (identity.scope === "skill-collection"
              ? identity.key !== agentId
              : identity.scope !== "skill-workshop-target" ||
                !stored ||
                identity.key !==
                  `${agentId}:${hashSkillProposalContent(stored.record.target.skillFile)}`) ||
            (stored !== null &&
              stored.row.owner_agent_id !== null &&
              stored.row.owner_agent_id !== agentId)
          ) {
            throw new Error("Skill Workshop lease does not match its proposal target.");
          }
        }
      }
      const result = operation(database);
      assertWrite(db, input, "commit");
      return result;
    },
    { database, ...stateOptions() },
    { operationLabel },
  );
}

function writePhysical<T>(
  input: WorkshopInput<{ runId: string }>,
  context: WorkerOperationContext,
  label: string,
  operation: (database: BranchStateDatabase) => T,
): T {
  const execution = readPhysicalLifecycleExecutionInDatabase(context.open().db, {
    agentId: input.agentId ?? "",
    runId: input.value.runId,
  });
  if (!execution) throw new Error("Owned physical lifecycle execution is unavailable.");
  return write(input, context, label, operation, execution.manifest.proposalId);
}

export const skillGardenerOperations = {
  "skills.gardener.read": (input: { skillFiles: readonly string[] }, { open }) =>
    readSkillGardenerStateInDatabase(open(), input.skillFiles),
  "skills.usage.record": (
    input: Parameters<typeof recordSkillUsageInDatabase>[1],
    { open, stateOptions },
  ) =>
    runBranchStateWriteTransaction((current) => recordSkillUsageInDatabase(current, input), {
      database: open(),
      ...stateOptions(),
    }),
} satisfies WorkerOperationHandlers;

export const skillWorkshopOperations = {
  "workshop.events.list": (
    input: Parameters<typeof listStoredSkillProposalEventsInDatabase>[1],
    { open, stateOptions },
  ) => {
    const database = open();
    ensureSkillWorkshopSchemaInDatabase(database, { database, ...stateOptions() });
    return listStoredSkillProposalEventsInDatabase(database.db, input);
  },
  "workshop.schema.ensure": (input: WorkshopInput<undefined>, { open, stateOptions }) => {
    const database = open();
    return ensureSkillWorkshopSchemaInDatabase(
      database,
      { database, ...stateOptions() },
      (db, stage) => assertWrite(db, input, stage),
    );
  },
  "workshop.proposal.read": (
    input: WorkshopInput<Parameters<typeof readStoredProposalInDatabase>[1]>,
    { open },
  ) => readStoredProposalInDatabase(open().db, input.value),
  "workshop.proposals.list": (
    input: WorkshopInput<Parameters<typeof listStoredSkillProposalsInDatabase>[1]>,
    { open },
  ) => listStoredSkillProposalsInDatabase(open().db, input.value),
  "workshop.proposal.create": (
    input: WorkshopInput<Parameters<typeof createSkillProposalInDatabase>[1]>,
    context,
  ) =>
    write(input, context, "skill-workshop.proposal.create", (database) =>
      createSkillProposalInDatabase(database.db, input.value),
    ),
  "workshop.proposal.update": (
    input: WorkshopInput<Parameters<typeof updateSkillProposalRecordInDatabase>[1]>,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.proposal.update",
      (database) => updateSkillProposalRecordInDatabase(database.db, input.value),
      input.value.record.id,
    ),
  "workshop.proposal.import": (
    input: WorkshopInput<Parameters<typeof importLegacySkillProposalInDatabase>[1]>,
    context,
  ) =>
    write(input, context, "doctor.skill-workshop.import", (database) =>
      importLegacySkillProposalInDatabase(database.db, input.value),
    ),
  "workshop.proposal.evaluate": (
    input: WorkshopInput<Parameters<typeof recordSkillProposalEvaluationInDatabase>[1]>,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.proposal.evaluate",
      (database) => recordSkillProposalEvaluationInDatabase(database.db, input.value),
      input.value.proposalId,
    ),
  "workshop.transition.commit": (
    input: WorkshopInput<
      Parameters<typeof commitPendingSkillProposalTransitionInDatabase>[1] & {
        operationLabel: string;
      }
    >,
    context,
  ) =>
    write(
      input,
      context,
      input.value.operationLabel,
      (database) => {
        if (input.value.undoReceipt && input.value.undoReceipt.agentId !== input.agentId) {
          throw new Error("Undo receipt owner does not match captured worker agent.");
        }
        return commitPendingSkillProposalTransitionInDatabase(database.db, input.value, () =>
          assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
        );
      },
      input.value.expected.id,
    ),
  "workshop.transition.committed": (
    input: WorkshopInput<Parameters<typeof readCommittedSkillProposalTransitionInDatabase>[1]>,
    { open },
  ) => readCommittedSkillProposalTransitionInDatabase(open().db, input.value),
  "workshop.practice.read": (input: WorkshopInput<{ evidenceId: string }>, { open }) =>
    readSkillPracticeEvidenceInDatabase(open().db, {
      agentId: input.agentId ?? "",
      evidenceId: input.value.evidenceId,
    }),
  "workshop.practice.write": (
    input: WorkshopInput<
      Omit<Parameters<typeof writeSkillPracticeEvidenceInDatabase>[1], "agentId">
    >,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.practice.write",
      (database) =>
        writeSkillPracticeEvidenceInDatabase(
          database.db,
          { ...input.value, agentId: input.agentId ?? "" },
          () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
        ),
      input.value.evidence.proposalId,
    ),
  "workshop.undo.execution.read": (input: WorkshopInput<{ proposalId: string }>, { open }) =>
    readSkillUndoExecutionInDatabase(open().db, {
      agentId: input.agentId ?? "",
      proposalId: input.value.proposalId,
    }),
  "workshop.undo.execution.prepare": (
    input: WorkshopInput<{ proposalId: string; observedTreeSha256: string }>,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.undo.prepare",
      (database) =>
        prepareSkillUndoExecutionInDatabase(
          database.db,
          { ...input.value, agentId: input.agentId ?? "" },
          () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
        ),
      input.value.proposalId,
    ),
  "workshop.undo.execution.complete": (
    input: WorkshopInput<{ proposalId: string; observedTreeSha256: string }>,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.undo.complete",
      (database) =>
        completeSkillUndoExecutionInDatabase(
          database.db,
          { ...input.value, agentId: input.agentId ?? "" },
          () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
        ),
      input.value.proposalId,
    ),
  "workshop.undo.intent.read": (input: WorkshopInput<{ proposalId: string }>, { open }) =>
    readPreparedSkillUndoIntentInDatabase(open().db, {
      agentId: input.agentId ?? "",
      proposalId: input.value.proposalId,
    }),
  "workshop.undo.receipt.read": (input: WorkshopInput<{ proposalId: string }>, { open }) =>
    readAppliedSkillUndoReceiptInDatabase(open().db, {
      agentId: input.agentId ?? "",
      proposalId: input.value.proposalId,
    }),
  "workshop.lifecycle.protection.read": (input: WorkshopInput<undefined>, { open }) => {
    if (!input.agentId) throw Error("Protection requires a scoped Workshop owner.");
    return readLifecyclePersistedProtectionInDatabase(open().db);
  },
  "workshop.lifecycle.owned-files": (input: WorkshopInput<undefined>, { open }) =>
    readOwnedSkillFilesInDatabase(open().db, input.agentId ?? ""),
  "workshop.lifecycle.owned-proposal": (input: WorkshopInput<{ skillFile: string }>, { open }) =>
    readOwnedSkillProposalForFileInDatabase(open().db, {
      ...input.value,
      agentId: input.agentId ?? "",
    }),
  "workshop.lifecycle.physical.read": (input: WorkshopInput<{ runId: string }>, { open }) =>
    readPhysicalLifecycleExecutionInDatabase(open().db, {
      ...input.value,
      agentId: input.agentId ?? "",
    }),
  "workshop.lifecycle.physical.prepare": (
    input: WorkshopInput<
      Omit<Parameters<typeof preparePhysicalLifecycleArchiveInDatabase>[1], "agentId">
    >,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.lifecycle.physical.prepare",
      (database) =>
        preparePhysicalLifecycleArchiveInDatabase(
          database.db,
          { ...input.value, agentId: input.agentId ?? "" },
          () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
        ),
      input.value.manifest.proposalId,
    ),
  "workshop.lifecycle.physical.archive": (
    input: WorkshopInput<
      Omit<Parameters<typeof completePhysicalLifecycleArchiveInDatabase>[1], "agentId">
    >,
    context,
  ) =>
    writePhysical(input, context, "skill-workshop.lifecycle.physical.archive", (database) =>
      completePhysicalLifecycleArchiveInDatabase(
        database.db,
        { ...input.value, agentId: input.agentId ?? "" },
        () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
      ),
    ),
  "workshop.lifecycle.physical.restore-prepare": (
    input: WorkshopInput<
      Omit<Parameters<typeof preparePhysicalLifecycleRestoreInDatabase>[1], "agentId">
    >,
    context,
  ) =>
    writePhysical(input, context, "skill-workshop.lifecycle.physical.restore-prepare", (database) =>
      preparePhysicalLifecycleRestoreInDatabase(
        database.db,
        { ...input.value, agentId: input.agentId ?? "" },
        () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
      ),
    ),
  "workshop.lifecycle.physical.restore": (
    input: WorkshopInput<
      Omit<Parameters<typeof completePhysicalLifecycleRestoreInDatabase>[1], "agentId">
    >,
    context,
  ) =>
    writePhysical(input, context, "skill-workshop.lifecycle.physical.restore", (database) =>
      completePhysicalLifecycleRestoreInDatabase(
        database.db,
        { ...input.value, agentId: input.agentId ?? "" },
        () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
      ),
    ),
  "workshop.lifecycle.revision": (input: WorkshopInput<{ skillFile: string }>, { open }) =>
    readSkillLifecycleRevisionInDatabase(open().db, {
      ...input.value,
      agentId: input.agentId ?? "",
    }),
  "workshop.lifecycle.pin": (
    input: WorkshopInput<Omit<Parameters<typeof setSkillLifecyclePinInDatabase>[1], "agentId">>,
    context,
  ) =>
    write(input, context, "skill-workshop.lifecycle.pin", (database) =>
      setSkillLifecyclePinInDatabase(
        database.db,
        { ...input.value, agentId: input.agentId ?? "" },
        () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
      ),
    ),
  "workshop.lifecycle.restore-plan": (
    input: WorkshopInput<
      Omit<Parameters<typeof restoreSkillLifecyclePlanRunInDatabase>[1], "agentId">
    >,
    context,
  ) =>
    write(input, context, "skill-workshop.lifecycle.restore-plan", (database) =>
      restoreSkillLifecyclePlanRunInDatabase(
        database.db,
        { ...input.value, agentId: input.agentId ?? "" },
        () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
      ),
    ),
  "workshop.lifecycle.read": (input: WorkshopInput<undefined>, { open }) =>
    readSkillLifecyclePlansInDatabase(open().db, input.agentId ?? ""),
  "workshop.lifecycle.plan": (
    input: WorkshopInput<Omit<Parameters<typeof planSkillLifecycleInDatabase>[1], "agentId">>,
    context,
  ) =>
    write(input, context, "skill-workshop.lifecycle.plan", (database) =>
      planSkillLifecycleInDatabase(
        database.db,
        { ...input.value, agentId: input.agentId ?? "" },
        () => assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
      ),
    ),
  "workshop.rollback.read": (
    input: WorkshopInput<Parameters<typeof readSkillProposalRollbackInDatabase>[1]>,
    { open },
  ) => readSkillProposalRollbackInDatabase(open().db, input.value),
  "workshop.rollback.write": (
    input: WorkshopInput<Parameters<typeof writeSkillProposalRollbackInDatabase>[1]>,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.rollback.write",
      (database) => {
        if (
          input.value.undoIntent &&
          (input.value.undoIntent.agentId !== input.agentId ||
            input.value.undoIntent.proposalId !== input.value.proposalId)
        ) {
          throw new Error("Prepared undo intent does not match captured worker owner/proposal.");
        }
        return writeSkillProposalRollbackInDatabase(database.db, input.value, () =>
          assertSkillFoundationTransactionCurrent(database.db, input.leaseIdentities),
        );
      },
      input.value.proposalId,
    ),
  "workshop.rollback.clear": (
    input: WorkshopInput<Parameters<typeof clearSkillProposalRollbackInDatabase>[1]>,
    context,
  ) =>
    write(
      input,
      context,
      "skill-workshop.rollback.clear",
      (database) => clearSkillProposalRollbackInDatabase(database.db, input.value),
      input.value.proposalId,
    ),
  "workshop.collection.list": (
    input: WorkshopInput<Parameters<typeof listSkillCollectionReviewOutcomesInDatabase>[1]>,
    { open },
  ) => listSkillCollectionReviewOutcomesInDatabase(open().db, input.value),
  "workshop.collection.drops": (
    input: WorkshopInput<Parameters<typeof readSkillCollectionBackupDropsInDatabase>[1]>,
    { open },
  ) => readSkillCollectionBackupDropsInDatabase(open().db, input.value),
  "workshop.experience.record": (
    input: WorkshopInput<Parameters<typeof recordSkillExperienceReviewOutcomeInDatabase>[1]>,
    context,
  ) =>
    write(input, context, "skill-workshop.experience.record", (database) =>
      recordSkillExperienceReviewOutcomeInDatabase(database, input.value),
    ),
} satisfies WorkerOperationHandlers;

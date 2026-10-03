import type { BranchConfig } from "../../config/types.branch.js";
import { bumpSkillsSnapshotVersion } from "../runtime/refresh-state.js";
import { resolveWorkshopSkillsDir } from "./skills-root.js";
import { captureSkillWorkshopStoreOptions, readStoredProposal } from "./store-client.js";
import { readSkillProposalRollback } from "./store-rollback.js";
import {
  readAppliedSkillUndoReceipt,
  readPreparedSkillUndoIntent,
  prepareSkillUndoExecution,
  completeSkillUndoExecution,
} from "./store-seasons-foundations.js";
import { readSkillProposalBundle } from "./store.js";
import { withSkillProposalCommitLock } from "./target-lock.js";
import { executeAppliedSkillUndo } from "./undo-execution.js";
import { requireSkillFoundationAgentId } from "./undo-identity.js";

/** Internal authorized service, deliberately not an unauthenticated Gateway method. */
export async function undoAppliedSkillProposal(request: {
  config: BranchConfig;
  agentId: string;
  proposalId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const params = structuredClone(request);
  requireSkillFoundationAgentId(params.agentId);
  const store = captureSkillWorkshopStoreOptions(params);
  const initial = await readStoredProposal(params.proposalId, store);
  if (
    !initial ||
    initial.row.owner_agent_id !== params.agentId ||
    initial.record.status !== "applied"
  )
    throw new Error("Owned applied skill proposal is unavailable.");
  return withSkillProposalCommitLock(
    initial.record,
    async (locked) => {
      const current = await readStoredProposal(params.proposalId, locked);
      if (
        !current ||
        current.row.owner_agent_id !== params.agentId ||
        current.row.record_json !== initial.row.record_json
      )
        throw new Error("Applied proposal changed before Undo.");
      const scoped = { ...locked, agentId: params.agentId };
      const receipt = await readAppliedSkillUndoReceipt(params.proposalId, scoped);
      const intent = await readPreparedSkillUndoIntent(params.proposalId, scoped);
      const rollback = await readSkillProposalRollback(params.proposalId, scoped);
      if (!receipt || !intent || !rollback)
        throw new Error("Undo custody is unavailable for this applied change.");
      const assertCurrent = async () => {
        locked.execution.context.admission.assertCurrent();
        locked.execution.context.maintenanceScope?.assertAdmission();
        for (const lease of locked.execution.leases) await lease.assertOwned();
        locked.execution.context.admission.assertCurrent();
      };
      const bundle = await readSkillProposalBundle(current.record, scoped);
      try {
        return await executeAppliedSkillUndo(
          {
            skillsRoot: resolveWorkshopSkillsDir(params.config, params.agentId, locked.env),
            agentId: params.agentId,
            record: current.record,
            draftContent: bundle.content,
            supportFiles: bundle.supportFiles ?? [],
            rollback,
            receipt,
            intent,
          },
          {
            assertCurrent,
            prepare: (observedTreeSha256) =>
              prepareSkillUndoExecution(
                { proposalId: params.proposalId, observedTreeSha256 },
                scoped,
              ),
            complete: (observedTreeSha256) =>
              completeSkillUndoExecution(
                { proposalId: params.proposalId, observedTreeSha256 },
                scoped,
              ),
          },
        );
      } finally {
        bumpSkillsSnapshotVersion({
          reason: "workshop",
          changedPath: current.record.target.skillFile,
        });
      }
    },
    store,
  );
}

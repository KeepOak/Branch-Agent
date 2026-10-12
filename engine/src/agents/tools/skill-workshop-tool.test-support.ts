import type { BranchConfig } from "../../config/types.branch.js";
import { readSkillProposalRecord as readSkillProposalRecordImpl } from "../../skills/workshop/store.js";

const workshopConfig: BranchConfig = {};

export function readSkillWorkshopTestProposalRecord(
  proposalId: string,
  options: { stateDir?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return readSkillProposalRecordImpl(
    proposalId,
    { config: workshopConfig, ...options },
    {},
    { config: workshopConfig },
  );
}

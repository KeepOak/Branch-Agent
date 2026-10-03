import type { BranchConfig } from "../config/types.branch.js";
import { resolveDecisionModelSetting } from "./decision-model-setting.js";

/**
 * Outer eligibility only, over prepared config and a trusted owning agent ID.
 * Does not establish provider readiness, consumer mode, harness support, or
 * authority. Automatic consumers check this before preparing evidence and again
 * at provider dispatch. Opt-out does not invalidate admitted evaluations; model
 * selection and live authority remain independently checked for awaited results.
 * Explicit decision_evaluate and the shared Decision runtime remain independent.
 */
export function isDecisionAssistanceEligible(config: BranchConfig, agentId: string): boolean {
  return (
    config.agents?.defaults?.experimental?.decisionAssistance === true &&
    resolveDecisionModelSetting(config, agentId) !== undefined
  );
}

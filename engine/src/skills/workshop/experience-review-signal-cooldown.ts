import { openBranchStateDatabase } from "../../state/branch-state-db.js";
import {
  claimExperienceSignalCooldownInDatabase,
  type ClaimExperienceSignalCooldownInput,
} from "./collection-review.kernel.js";

/** Synchronous persisted claim used by the scheduler's repeated-failure gate. */
export function claimExperienceSignalCooldown(input: ClaimExperienceSignalCooldownInput): boolean {
  return claimExperienceSignalCooldownInDatabase(openBranchStateDatabase(), input);
}

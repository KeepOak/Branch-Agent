import {
  openBranchStateDatabase,
  type BranchStateDatabaseOptions,
} from "../../state/branch-state-db.js";
import { readSkillGardenerReviewStatusInDatabase } from "./collection-review.kernel.js";

export function readSkillGardenerReviewStatus(options: BranchStateDatabaseOptions = {}) {
  return readSkillGardenerReviewStatusInDatabase(openBranchStateDatabase(options));
}

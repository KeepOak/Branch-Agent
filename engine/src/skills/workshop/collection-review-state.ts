import path from "node:path";
import type { BranchStateDatabaseOptions } from "../../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../../state/branch-state-worker-context.types.js";
import type { SkillExperienceReviewStatus } from "./collection-review.kernel.js";
import { executeSkillWorkshopOperation } from "./store-client.js";
import type { SkillWorkshopStoreOptions } from "./store-sqlite-schema.js";
export type { SkillExperienceReviewStatus } from "./collection-review.kernel.js";

export async function recordSkillExperienceReviewOutcome(
  agentId: string,
  workspaceDir: string,
  review: SkillExperienceReviewStatus,
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> & {
    context?: BranchStateWorkerContext;
  } = {},
): Promise<void> {
  const input = { agentId, workspaceDir: path.resolve(workspaceDir), review };
  const context = options.context ?? captureBranchStateWorkerContext(options);
  return executeSkillWorkshopOperation("workshop.experience.record", input, {
    env: context.environment,
    execution: { context, leases: [] },
  });
}

export function readSkillCollectionBackupDrops(
  agentId: string,
  backupId: string,
  options: SkillWorkshopStoreOptions = {},
) {
  return executeSkillWorkshopOperation("workshop.collection.drops", { agentId, backupId }, options);
}

export function listSkillCollectionReviewOutcomes(
  agentId: string,
  options: SkillWorkshopStoreOptions = {},
) {
  return executeSkillWorkshopOperation("workshop.collection.list", agentId, options);
}

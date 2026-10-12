import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { assertNoUnmigratedWorkspaceState } from "./workspace-legacy-state.js";
import {
  readWorkspaceStateSnapshot,
  type WorkspaceStateSnapshot,
} from "./workspace-state-store.js";
import type { WorkspaceStateGuard } from "./workspace-state-store.worker-contract.js";

export async function readCanonicalWorkspaceStateSnapshot(
  dir: string,
  options: BranchStateDatabaseOptions = {},
  guard?: WorkspaceStateGuard,
): Promise<WorkspaceStateSnapshot> {
  const snapshot = await readWorkspaceStateSnapshot(dir, {
    ...options,
    assertCurrent: guard?.assertHost,
    recoveryHoldPredicate: guard?.recoveryHoldPredicate,
    beforeLegacyApply: guard?.beforeLegacyApply,
  });
  guard?.assertHost?.();
  assertNoUnmigratedWorkspaceState({
    workspaceDir: dir,
  });
  return snapshot;
}

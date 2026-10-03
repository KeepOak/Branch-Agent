// Install download test utilities provide isolated state and workspace paths.
import {
  createBranchTestState,
  type BranchTestState,
} from "../../test-utils/branch-test-state.js";

/** Creates isolated Branch Agent state for install download tests. */
export async function createInstallDownloadTestState(): Promise<BranchTestState> {
  return await createBranchTestState({
    layout: "state-only",
    prefix: "branch-skills-install-",
  });
}

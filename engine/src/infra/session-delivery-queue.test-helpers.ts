import { closeBranchStateDatabaseByPathAsync } from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import { withTestDir } from "../test-helpers/temp-dir.js";

export async function withSessionDeliveryQueue(
  run: (stateDir: string, queueContext: BranchStateWorkerContext) => Promise<void>,
): Promise<void> {
  await withTestDir({ prefix: "branch-session-delivery-" }, async (stateDir) => {
    const queueContext = captureBranchStateWorkerContext({
      env: { ...process.env, BRANCH_STATE_DIR: stateDir },
    });
    try {
      await run(stateDir, queueContext);
    } finally {
      await closeBranchStateDatabaseByPathAsync(queueContext.admission.databasePath);
    }
  });
}

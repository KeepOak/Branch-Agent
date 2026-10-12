import path from "node:path";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
} from "../state/branch-agent-db.js";
import { drainBranchAgentWriteQueuesForTest } from "../state/branch-agent-write-admission.test-support.js";
import { closeBranchStateDatabaseByPathAsync } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";

export async function closeGatewayTestHomeDatabases(home: string): Promise<void> {
  // External stores can still have queued writes using this home's state.
  await drainBranchAgentWriteQueuesForTest();
  // Release leases before deleting their store, and revoke trust in recreated paths.
  await closeBranchAgentDatabasesAsync(home);
  closeBranchAgentDatabasesForTest(home);
  // External agent stores can retain workers whose leases belong to this home.
  await closeBranchStateDatabaseByPathAsync(
    resolveBranchStateSqlitePath({ BRANCH_STATE_DIR: path.join(home, ".branch") }),
  );
}

import fs from "node:fs";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
} from "../../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../../state/branch-state-db.js";

/** Keep conformance roots until their native database users have settled. */
export async function closeSessionAccessorConformanceFixture(tempDir: string): Promise<void> {
  await closeBranchAgentDatabasesAsync();
  await closeBranchStateDatabaseAsync();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

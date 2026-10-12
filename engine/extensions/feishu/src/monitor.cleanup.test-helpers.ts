import { closeBranchStateDatabaseForTest } from "branch/plugin-sdk/channel-ingress-test-runtime";
import { closeBranchStateDatabaseAsync } from "branch/plugin-sdk/sqlite-runtime-testing";
import { botOpenIds, wsClients } from "./monitor.state.js";

export async function cleanupFeishuMonitorStateForTests(): Promise<void> {
  for (const client of wsClients.values()) {
    try {
      client.close();
    } catch {
      // Best-effort test cleanup.
    }
  }
  wsClients.clear();

  botOpenIds.clear();
  await closeBranchStateDatabaseAsync();
  closeBranchStateDatabaseForTest();
}

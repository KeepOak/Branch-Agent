import { once } from "node:events";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";

const { register } = await import(workerData.sourceLoaderUrl);
register();
const { runWithSqliteMutationWorkerCoordination } =
  await import("./session-accessor.sqlite-worker-coordination.ts");
const { acquireGatewayStateOwner } = await import("../../infra/gateway-state-owner.ts");
const { claimBranchAgentDatabaseLease, releaseBranchAgentDatabaseLease } =
  await import("../../state/branch-agent-db-lease.ts");
const { closeBranchStateDatabase } = await import("../../state/branch-state-db.ts");
const [coordination] = await once(parentPort, "message");
await runWithSqliteMutationWorkerCoordination(
  coordination,
  1,
  { agentId: workerData.operation, path: workerData.agentPath },
  async (options) => {
    if (workerData.operation === "hold") {
      const stateDir = coordination.stateContext.environment.BRANCH_STATE_DIR;
      const owner = acquireGatewayStateOwner({
        databasePath: coordination.databasePath,
        payload: {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          configPath: path.join(stateDir, "branch.json"),
          stateDir,
          role: "gateway",
        },
      });
      try {
        parentPort.postMessage("held", []);
        const release = new Int32Array(workerData.release);
        Atomics.wait(release, 0, 0);
      } finally {
        owner.release();
      }
    } else {
      const lease = claimBranchAgentDatabaseLease(options);
      releaseBranchAgentDatabaseLease(lease, { env: options.env });
      closeBranchStateDatabase();
      parentPort.postMessage("claimed", []);
    }
  },
);
parentPort.close();

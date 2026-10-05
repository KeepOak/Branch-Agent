import type { BranchStateOwnershipWorkerReply } from "./branch-state-ownership-worker.js";
import {
  inspectBranchStateOwnershipInProcess,
  type BranchExternalStateOwnership,
} from "./branch-state-ownership.js";
import { encodeBranchStateWorkerError } from "./branch-state-worker-error.js";

function inspect(databasePath: string | undefined): BranchStateOwnershipWorkerReply {
  try {
    if (!databasePath) {
      throw new Error("Shared-state ownership worker requires a database path");
    }
    const ownership: BranchExternalStateOwnership | null =
      inspectBranchStateOwnershipInProcess(databasePath);
    return { ok: true, ownershipJson: JSON.stringify(ownership) };
  } catch (error) {
    const workerError = encodeBranchStateWorkerError(error, { includeOrdinary: true });
    if (!workerError) {
      throw error;
    }
    return { ok: false, workerError };
  }
}

process.stdout.write(JSON.stringify(inspect(process.argv[2])));

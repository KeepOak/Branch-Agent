import { getSqliteWorkerStateContext } from "../../infra/sqlite-worker-state-context.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabase,
} from "../../state/branch-state-db.js";
import { resolveCronJobConfigRevision } from "../config-revision.js";
import { writeCronJobScratchInDatabase } from "../scratch-write.kernel.js";
import { loadedCronStoreFromRows, loadCronRows } from "./row-codec.js";
import {
  prepareCronRuntimeMutation,
  retainCronRuntimeMutationOutcome,
} from "./runtime-mutation.worker.js";
import type { CronRuntimeWorkerOperations } from "./runtime-worker.types.js";

export function writeCronScratchInWorker(
  database: BranchStateDatabase,
  input: CronRuntimeWorkerOperations["cron.writeScratch"]["input"],
): CronRuntimeWorkerOperations["cron.writeScratch"]["output"] {
  return runBranchStateWriteTransaction(
    ({ db }) => {
      const job = loadedCronStoreFromRows(
        loadCronRows(db, input.storeKey, new Set([input.jobId])),
        input.createdAtMsFallback,
      ).store.jobs[0];
      prepareCronRuntimeMutation("cron.writeScratch", input.nonce, {
        configRevision: job ? resolveCronJobConfigRevision(job) : undefined,
      });
      const outcome = writeCronJobScratchInDatabase(db, input);
      return retainCronRuntimeMutationOutcome("cron.writeScratch", db, input.nonce, outcome);
    },
    { database, path: database.path, env: getSqliteWorkerStateContext().environment },
    { operationLabel: "cron.scratch.write" },
  );
}

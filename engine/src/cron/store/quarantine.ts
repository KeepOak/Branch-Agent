/** Durable malformed-cron recovery records stored in the shared SQLite database. */
import { createSqliteWorkerWriteAdmission } from "../../infra/sqlite-worker-store.js";
import { executeExistingBranchStateRead } from "../../state/branch-state-db-readonly.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import { runBranchStateWorkerOperation } from "../../state/branch-state-worker-store.js";
import type { CronQuarantinedJob, QuarantinedCronConfigJob } from "../types-shared.js";
import { cronStoreKey } from "./key.js";
import { prepareCronQuarantineRegistration } from "./quarantine.kernel.js";

/** Reads quarantined cron rows without creating or migrating a state database. */
export async function loadCronQuarantinedJobs(
  storePath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CronQuarantinedJob[]> {
  const reply = await executeExistingBranchStateRead(
    { env },
    { type: "cron.quarantine", storeKey: cronStoreKey(storePath) },
  );
  if (reply && (!reply.ok || reply.type !== "cron.quarantine")) {
    throw new Error("Unexpected cron quarantine observation result");
  }
  return reply?.entries ?? [];
}

/** Await durable registration before callers archive their legacy recovery source. */
export async function saveCronQuarantinedJobs(params: {
  storePath: string;
  entries: readonly (QuarantinedCronConfigJob | CronQuarantinedJob)[];
  nowMs: number;
}): Promise<void> {
  if (params.entries.length === 0) {
    return;
  }
  const context = captureBranchStateWorkerContext();
  const input = prepareCronQuarantineRegistration(params);
  const assertCurrent = () => {
    context.admission.assertCurrent();
    context.maintenanceScope?.assertAdmission();
  };
  await runBranchStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "cron.registerQuarantine", input }),
    {
      assertCurrent,
      createAdmission: createSqliteWorkerWriteAdmission(assertCurrent, [
        context.admission.databasePath,
      ]),
    },
  );
  assertCurrent();
}

import { executeExistingBranchStateRead } from "../state/branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import type { CronScratchReadCommand, CronScratchSnapshot } from "./scratch-contract.js";
import { cronStoreKey } from "./store/key.js";

/** Keep first-use schema opening and the subsequent read on their existing workers. */
export async function readCronScratchSnapshot(
  storePath: string,
  selector: CronScratchReadCommand["selector"],
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
  admission?: {
    context?: BranchStateWorkerContext;
    assertCurrent?: () => void;
    signal?: AbortSignal;
  },
): Promise<CronScratchSnapshot | undefined> {
  const context = admission?.context ?? captureBranchStateWorkerContext(options);
  const command: CronScratchReadCommand = {
    type: "cron.scratch",
    storeKey: cronStoreKey(storePath),
    selector: { ...selector },
  };
  const callerCurrent = admission?.assertCurrent;
  const signal = admission?.signal;
  const assertCurrent = () => {
    signal?.throwIfAborted();
    context.admission.assertCurrent();
    callerCurrent?.();
    context.admission.assertCurrent();
  };
  assertCurrent();
  // The old mutable getter initialized missing/older state. Native actor readiness
  // owns that opening; the independent reader never creates or migrates a schema.
  await runBranchStateWorkerOperation(context, async () => assertCurrent(), { assertCurrent });
  assertCurrent();
  const reply = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    command,
    { context, current: true, signal },
  );
  assertCurrent();
  if (!reply?.ok || reply.type !== command.type) {
    throw new Error("Cron scratch read did not return its admitted snapshot");
  }
  return reply.snapshot;
}

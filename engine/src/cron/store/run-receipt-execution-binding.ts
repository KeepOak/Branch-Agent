import type { AdmittedRunContext } from "../../agents/admitted-run-context.js";
import {
  executionOwnerBindingFromAdmission,
  type ExecutionOwnerBindingResult,
} from "../../audit/execution-owner-binding.js";
import type { BranchStateDatabaseOptions } from "../../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../../state/branch-state-worker-context.types.js";
import type { CronRunReceiptHandle } from "./run-receipt.types.js";

/** Binds the exact admitted execution without changing the receipt lifecycle. */
export async function bindCronRunReceiptExecution(params: {
  admitted: AdmittedRunContext;
  handle: CronRunReceiptHandle;
  options?: Pick<BranchStateDatabaseOptions, "path" | "env">;
  context?: BranchStateWorkerContext;
  assertCurrent?: () => void;
}): Promise<ExecutionOwnerBindingResult> {
  const binding = executionOwnerBindingFromAdmission(params.admitted);
  if (!binding) {
    return "disabled";
  }
  const context = params.context ?? captureBranchStateWorkerContext(params.options);
  const input = { handle: { ...params.handle }, binding };
  const assertOwnerCurrent = params.assertCurrent;
  const assertCurrent = () => {
    context.admission.assertCurrent();
    assertOwnerCurrent?.();
  };
  const [{ runBranchStateWorkerOperation }, { createSqliteWorkerWriteAdmission }] =
    await Promise.all([
      import("../../state/branch-state-worker-store.js"),
      import("../../infra/sqlite-worker-store.js"),
    ]);
  return runBranchStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "cron.bindReceiptExecution", input }),
    {
      assertCurrent,
      createAdmission: createSqliteWorkerWriteAdmission(assertCurrent, [
        context.admission.databasePath,
      ]),
    },
  );
}

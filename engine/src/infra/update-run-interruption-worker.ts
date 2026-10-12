import {
  executeExistingBranchStateRead,
  withArtifactPreservingStateReads,
} from "../state/branch-state-db-readonly.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import { createSqliteWorkerWriteAdmission } from "./sqlite-worker-store.js";
import type { UpdateRunLedgerOptions } from "./update-run-codec.js";
import type { InterruptedUpdateSettlement } from "./update-run-interruption-contract.js";

export async function readInterruptedUpdateCandidateAsync(
  options: UpdateRunLedgerOptions,
  context?: BranchStateWorkerContext,
) {
  const reply = await withArtifactPreservingStateReads(() =>
    executeExistingBranchStateRead(
      options,
      { type: "updateRuns.interruptedCandidate" },
      { context, preferIndependentWarmRead: true },
    ),
  );
  if (!reply) {
    return undefined;
  }
  if (!reply.ok || reply.type !== "updateRuns.interruptedCandidate") {
    throw new Error("Unexpected interrupted update lookup result");
  }
  return reply.run;
}

export function persistInterruptedUpdateObservationAsync(
  context: BranchStateWorkerContext,
  input: InterruptedUpdateSettlement,
  signal?: AbortSignal,
) {
  const assertCurrent = () => {
    context.admission.assertCurrent();
    signal?.throwIfAborted();
  };
  return runBranchStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "updateRuns.reconcileInterrupted", input }),
    {
      existingOnly: true,
      assertCurrent,
      createAdmission: createSqliteWorkerWriteAdmission(assertCurrent, [
        context.admission.databasePath,
      ]),
    },
  );
}

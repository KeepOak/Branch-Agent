import { createSqliteWorkerWriteAdmission } from "../infra/sqlite-worker-store.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import { beginAmbientWatchPrune } from "./session-state-events.ambient-read.js";

const SESSION_STATE_PRUNE_INTERVAL_MS = 60 * 60_000;
const log = createSubsystemLogger("sessions/state-events");
let lastPruneAt = 0;
let prunePending: Promise<void> | undefined;

function reportPruneFailure(error: unknown): void {
  try {
    log.warn(`failed to prune session state history: ${String(error)}`);
  } catch {
    // Pruning cannot fail a committed action, including when its diagnostic sink fails.
  }
}

/** Join explicit sweeps; periodic producers coalesce within the existing retention window. */
export async function pruneSessionStateEvents(
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> & {
    now?: number;
    force?: true;
    context?: BranchStateWorkerContext;
    /** Recording retains its original scope and session-current admission through pruning. */
    execute?: () => Promise<void>;
  } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  if (!options.force && (prunePending || now - lastPruneAt <= SESSION_STATE_PRUNE_INTERVAL_MS)) {
    return;
  }
  try {
    const context = options.context ?? captureBranchStateWorkerContext(options);
    // Explicit sweeps must enforce their cutoff after an earlier periodic prune settles.
    for (let pending = prunePending; pending; pending = prunePending) {
      await pending;
    }
    const finishPrune = beginAmbientWatchPrune(context.admission.identity.key);
    prunePending = Promise.resolve()
      .then(() =>
        options.execute
          ? options.execute()
          : runBranchStateWorkerOperation(
              context,
              (scope) => scope.execute({ type: "sessionState.prune", input: { now } }),
              {
                createAdmission: createSqliteWorkerWriteAdmission(
                  () => context.admission.assertCurrent(),
                  [context.admission.databasePath],
                ),
              },
            ),
      )
      .then(() => {
        lastPruneAt = Math.max(lastPruneAt, now);
      })
      .catch(reportPruneFailure)
      .finally(() => {
        finishPrune();
        prunePending = undefined;
      });
    await prunePending;
  } catch (error) {
    reportPruneFailure(error);
  }
}

import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { executeExistingBranchStateRead } from "../state/branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { captureBranchStateReadWorkerContext } from "../state/branch-state-worker-context.js";

const log = createSubsystemLogger("sessions/state-events");
// Only live prompt-read admissions are retained, never watch rows or cached grants.
const ambientWatchReads = resolveGlobalSingleton(
  Symbol.for("branch.sessionState.ambientWatchReads"),
  () => ({ readers: new Set<{ source: string; current: boolean }>(), pruning: new Set<string>() }),
);

export function invalidateAmbientWatchReads(source: string) {
  for (const reader of ambientWatchReads.readers) {
    if (reader.source === source) {
      reader.current = false;
    }
  }
}

/** Pruning can remove watches; newly admitted reads must also remain undisclosable until settlement. */
export function beginAmbientWatchPrune(source: string): () => void {
  ambientWatchReads.pruning.add(source);
  invalidateAmbientWatchReads(source);
  return () => {
    ambientWatchReads.pruning.delete(source);
  };
}

/** List durable ambient-group targets owned by one watcher; failures grant nothing. */
export function prepareAmbientGroupWatchTargetsRead(
  watcherSessionKey: string,
  options: BranchStateDatabaseOptions = {},
) {
  const context = captureBranchStateReadWorkerContext(options);
  const captured = { path: context.admission.databasePath, env: context.environment };
  const scope = {
    source: context.admission.identity.key,
    current: !ambientWatchReads.pruning.has(context.admission.identity.key),
  };
  ambientWatchReads.readers.add(scope);
  return {
    assertCurrent: () => context.admission.assertCurrent(),
    isCurrent: () => scope.current,
    release: () => {
      scope.current = false;
      ambientWatchReads.readers.delete(scope);
    },
    async read(): Promise<string[]> {
      if (!scope.current) {
        return [];
      }
      try {
        const result = await executeExistingBranchStateRead(
          captured,
          { type: "sessionState.ambientTargets", input: { watcherSessionKey } },
          { context, current: true },
        );
        context.admission.assertCurrent();
        if (result && !result.ok) {
          throw new Error(result.message);
        }
        return result?.type === "sessionState.ambientTargets" ? result.targets : [];
      } catch (error) {
        log.warn(`failed to list ambient group watch targets: ${String(error)}`);
        return [];
      }
    },
  };
}

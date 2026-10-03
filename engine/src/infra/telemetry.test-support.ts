import { vi } from "vitest";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import * as workerStore from "../state/branch-state-worker-store.js";

/** Reject only this fixture's telemetry success writes while retaining real reads. */
export function blockTelemetryPersistence(): () => void {
  const databasePath = resolveBranchStateSqlitePath();
  let blocked = true;
  const original = workerStore.runBranchStateWorkerOperation;
  vi.spyOn(workerStore, "runBranchStateWorkerOperation").mockImplementation(
    (context, operation, options) =>
      original(
        context,
        (scope) =>
          operation({
            execute: (command, executeOptions) =>
              blocked &&
              context.admission.databasePath === databasePath &&
              command.type === "telemetry.persistSuccess"
                ? Promise.reject(new Error("Telemetry persistence unavailable"))
                : scope.execute(command, executeOptions),
          }),
        options,
      ),
  );
  return () => {
    blocked = false;
  };
}

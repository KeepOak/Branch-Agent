import {
  hydrateBranchStateWorkerError,
  retainBranchStateWorkerErrorPayload,
} from "../state/branch-state-worker-error.js";

export function decodeSqliteSnapshotStagingError(payload: unknown): Error {
  const remote = new Error("SQLite snapshot staging failed");
  retainBranchStateWorkerErrorPayload(remote, payload);
  return hydrateBranchStateWorkerError(remote, { includeOrdinary: true });
}

// One private shared-state snapshot for a whole text `status` run.
// Without it every nested shared-state read (config preflight, update-run status,
// reconciliation lookup, ...) made its own artifact-preserving copy of the shared
// state database. Where the filesystem cannot clone (ext4), each copy is a full byte
// copy plus snapshot workers, and status spent most of its time making copies.

import {
  withArtifactPreservingStateReads,
  withBranchStateDatabaseReadSnapshot,
} from "../state/branch-state-db-readonly.js";

/** Run `operation` with nested shared-state reads served from one snapshot.
 * If the snapshot cannot be prepared, status still runs with per-read snapshots. */
export async function withStatusStateSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  let started = false;
  try {
    return await withArtifactPreservingStateReads(() =>
      withBranchStateDatabaseReadSnapshot(async () => {
        started = true;
        return await operation();
      }),
    );
  } catch (error) {
    if (started) {
      throw error;
    }
    return await operation();
  }
}

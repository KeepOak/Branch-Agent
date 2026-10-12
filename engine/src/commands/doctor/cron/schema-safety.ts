import { isSqliteSchemaVersionError } from "../../../infra/sqlite-user-version.js";
import {
  withExistingBranchStateDatabaseArtifactPreservingReadOnly,
  withExistingBranchStateDatabaseArtifactPreservingReadOnlyAsync,
} from "../../../state/branch-state-db-readonly.js";

export function assertCronStateSchemaSupported(env?: NodeJS.ProcessEnv): void {
  withExistingBranchStateDatabaseArtifactPreservingReadOnly(() => undefined, { env });
}

export async function assertCronStateSchemaSupportedAsync(env?: NodeJS.ProcessEnv): Promise<void> {
  await withExistingBranchStateDatabaseArtifactPreservingReadOnlyAsync(() => undefined, { env });
}

export function rethrowSqliteSchemaVersionError(error: unknown): void {
  if (isSqliteSchemaVersionError(error)) {
    throw error;
  }
}

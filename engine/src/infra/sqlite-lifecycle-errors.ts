import { isPromiseLike } from "@branch/normalization-core/promise-like";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";

export class BranchStateOwnershipError extends Error {}

export class BranchStateOwnershipMetadataError extends BranchStateOwnershipError {
  constructor(
    readonly databasePath: string,
    message: string,
  ) {
    super(
      `Branch Agent shared state ownership metadata is invalid at ${databasePath}: ${message}. ` +
        "Repair it with BRANCH_SUPERVISOR_MODE=external branch database ownership claim --manager <manager-id>.",
    );
    this.name = "BranchStateOwnershipMetadataError";
  }
}

export class BranchStateExternalOwnershipError extends BranchStateOwnershipError {
  constructor(
    readonly databasePath: string,
    readonly managerId: string,
  ) {
    super(
      `Branch Agent shared state database ${databasePath} is externally supervised by ${managerId}. ` +
        "Use that external supervisor with BRANCH_SUPERVISOR_MODE=external for writable operations.",
    );
    this.name = "BranchStateExternalOwnershipError";
  }
}

// Worker error envelopes retain this name and identity across module reloads.
export const SqliteCoordinatorError = resolveGlobalSingleton(
  Symbol.for("branch.sqliteCoordinatorError"),
  () =>
    class CoordinatorError extends Error {
      constructor(
        message: string,
        public override readonly cause?: unknown,
      ) {
        super(message);
        this.name = "SqliteCoordinatorError";
      }
    },
);
export type SqliteCoordinatorError = InstanceType<typeof SqliteCoordinatorError>;

export function createSqliteLifecycleAggregateError(
  errors: unknown[],
  message: string,
  cause: unknown,
): AggregateError {
  return new AggregateError(errors, message, { cause });
}

/** Keep the first failure as the cause while retaining independent cleanup errors. */
export function throwSqliteLifecycleErrors(errors: unknown[], message: string): void {
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw createSqliteLifecycleAggregateError(errors, message, errors[0]);
  }
}

/** Settle a synchronous SQLite operation and preserve both operation and cleanup failures. */
export function runWithSqliteCleanup<T>(
  resource: { release: () => void },
  operationLabel: string,
  operation: () => T,
): T {
  let result: T;
  try {
    result = operation();
    if (isPromiseLike(result)) {
      throw new SqliteCoordinatorError(`${operationLabel} must remain synchronous`);
    }
  } catch (operationError) {
    try {
      resource.release();
    } catch (releaseError) {
      throw createSqliteLifecycleAggregateError(
        [operationError, releaseError],
        `${operationLabel} and resource release both failed`,
        operationError,
      );
    }
    throw operationError;
  }
  try {
    resource.release();
  } catch (releaseError) {
    throw new SqliteCoordinatorError(
      `${operationLabel} completed, but releasing its resource failed`,
      releaseError,
    );
  }
  return result;
}

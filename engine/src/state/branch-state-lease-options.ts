import { MAX_TIMER_TIMEOUT_MS } from "@branch/normalization-core/number-coercion";
import type {
  BranchStateAsyncLeaseContext,
  BranchStateLeaseContext,
} from "./branch-state-lease-context.js";
import { BranchStateLeaseError } from "./branch-state-lease-error.js";
import type { BranchStateLeaseDatabase } from "./branch-state-lease-storage.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";

export type BranchStateLeaseOptions = {
  scope: string;
  key: string;
  database: BranchStateLeaseDatabase;
  leaseMs: number;
  waitMs: number;
  signal?: AbortSignal;
  /** Maintenance prepares normal storage before waiting for its operation lease. */
  prepareDatabase?: boolean;
  /** Maintenance can block the event loop for longer than the lease duration. */
  heartbeat?: "worker";
  /** Opt in only when no write-capable work can outlive the owning process. */
  processBound?: boolean;
  /** Stable diagnostic noun used in errors. */
  leaseLabel?: string;
  /** Stable transaction label used by SQLite diagnostics. */
  operationLabel?: string;
};

export type BranchStateLeaseInvocation<T> =
  | {
      kind: "native";
      options: BranchStateLeaseOptions;
      run: (lease: BranchStateLeaseContext) => Promise<T>;
    }
  | {
      kind: "worker";
      options: BranchStateLeaseOptions;
      context: BranchStateWorkerContext;
      run: (lease: BranchStateAsyncLeaseContext) => Promise<T>;
    };

const MIN_LEASE_MS = 1_000;
function invalidInput(message: string): BranchStateLeaseError {
  return new BranchStateLeaseError(message, { code: "BRANCH_STATE_LEASE_INVALID_INPUT" });
}

function validateDuration(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw invalidInput(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function validateNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw invalidInput(`${label} must be a non-empty string without NUL bytes`);
  }
  return value;
}

export function validateBranchStateLeaseOptions(options: BranchStateLeaseOptions) {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw invalidInput("state lease options must be an object");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw invalidInput("state lease signal must be an AbortSignal");
  }
  const database = options.database;
  if (typeof database !== "object" || database === null || Array.isArray(database)) {
    throw invalidInput("state lease database must be an object");
  }
  if (database.scope !== "shared") {
    throw invalidInput("state lease database scope must be shared");
  }
  if (database.schemaPolicy !== undefined && database.schemaPolicy !== "existing") {
    throw invalidInput("state lease schema policy is invalid");
  }
  const leaseLabel =
    options.leaseLabel === undefined
      ? "state lease"
      : validateNonEmptyString(options.leaseLabel, "state lease label");
  const operationLabel =
    options.operationLabel === undefined
      ? "state.lease"
      : validateNonEmptyString(options.operationLabel, "state lease operationLabel");
  return {
    scope: validateNonEmptyString(options.scope, `${leaseLabel} scope`),
    key: validateNonEmptyString(options.key, `${leaseLabel} key`),
    database,
    leaseMs: validateDuration(
      options.leaseMs,
      `${leaseLabel} leaseMs`,
      MIN_LEASE_MS,
      MAX_TIMER_TIMEOUT_MS,
    ),
    waitMs: validateDuration(options.waitMs, `${leaseLabel} waitMs`, 0, MAX_TIMER_TIMEOUT_MS),
    signal: options.signal,
    prepareDatabase: options.prepareDatabase === true,
    heartbeat: options.heartbeat,
    processBound: options.processBound === true,
    leaseLabel,
    operationLabel,
  };
}

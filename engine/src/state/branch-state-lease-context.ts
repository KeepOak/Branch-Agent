import type { DatabaseSync } from "node:sqlite";
import type {
  BranchStateLeaseAcquisition,
  BranchStateLeaseIdentity,
} from "./branch-state-lease.types.js";

export type BranchStateLeaseContext = {
  signal: AbortSignal;
  /** Renew before a blocking phase, carrying this caller's authority into timer renewal.
   * Renew again after a temporary authority scope ends to restore the caller's context. */
  renew?(): void;
  /** Verify that this exact owner holds a non-expired lease at this instant. */
  assertOwned(): void;
  /** Worker-heartbeat leases can verify durable ownership without blocking the caller. */
  assertOwnedAsync?(this: void): Promise<void>;
  /** Verify ownership using the caller's active write transaction. */
  assertOwnedInTransaction(database: DatabaseSync): void;
};

/** Ordinary runtime leases whose durable checks and renewal are awaited. */
export type BranchStateAsyncLeaseContext = {
  signal: AbortSignal;
  assertOwned(): Promise<void>;
  renew(): Promise<void>;
};

export type BranchStateWorkerLeaseContext =
  | BranchStateLeaseContext
  | BranchStateAsyncLeaseContext;

export type BranchStateLeaseLifecycleOperations = {
  "stateLease.acquire": {
    input: {
      identity: BranchStateLeaseIdentity;
      leaseMs: number;
      operationLabel: string;
      observeExpiry?: true;
      schemaPolicy?: "existing";
      processBound?: boolean;
    };
    output: BranchStateLeaseAcquisition;
  };
  "stateLease.verify": {
    input: { identity: BranchStateLeaseIdentity };
    output: number;
  };
  "stateLease.renew": {
    input: {
      identity: BranchStateLeaseIdentity;
      leaseMs: number;
      operationLabel: string;
    };
    output: number;
  };
  "stateLease.release": {
    input: {
      identity: BranchStateLeaseIdentity;
      operationLabel: string;
      databaseIdentity: string;
    };
    output: void;
  };
};

import type { SqliteWalCheckpointSnapshot } from "../../infra/sqlite-wal-checkpoint.js";
import type { DatabasePathIdentity } from "../../infra/sqlite-worker-identity.js";
import type {
  BranchAgentDatabaseClaim,
  readBranchAgentDatabaseIdentity,
} from "../../state/branch-agent-db-identity.js";
import type { BranchAgentDatabaseWorkerLeaseReceipt } from "../../state/branch-agent-db-lease.js";
import type { BranchAgentDatabaseValidation } from "../../state/branch-agent-db-validation-cache.js";
import type {
  SqliteArchiveReclamationPlan,
  SqliteSessionReclamationPlan,
  SqliteSessionReclamationResult,
} from "./session-accessor.sqlite-lifecycle-types.js";
import type { SqliteMutationWorkerCoordination } from "./session-accessor.sqlite-worker-coordination.js";
import type { SqliteMutationWorkerMessage } from "./session-accessor.sqlite-worker-request.js";

export type SqliteReclamationClaim = Pick<BranchAgentDatabaseClaim, "identity" | "assertCurrent">;

/** A captured existing-file expectation is not an admitted native claim. */
export type SqliteReclamationExistingSource = Pick<
  DatabasePathIdentity,
  "key" | "canonicalPath"
> & {
  birthtime?: string;
};
export type SqliteReclamationPreparedSource = Omit<
  ReturnType<typeof readBranchAgentDatabaseIdentity>,
  "identity"
> & { identity: string };
export type SqliteReclamationPreparation = {
  source: SqliteReclamationPreparedSource;
  validation: BranchAgentDatabaseValidation | undefined;
};
export type SqliteReclamationPrepareRequest = {
  type: "prepare";
  operationId: number;
  databaseOptions: SqliteSessionReclamationPlan["databaseOptions"];
  expectedSource: SqliteReclamationExistingSource;
  coordination: SqliteMutationWorkerCoordination;
};

export type SqliteReclamationWorkerRequest = {
  type: "reclaim";
  operationId: number;
  commitGate: SharedArrayBuffer;
  plan: SqliteArchiveReclamationPlan;
  coordination: SqliteMutationWorkerCoordination;
};
export type SqliteReclamationWorkerCloseRequest = {
  type: "close";
  operationId: number;
  coordination: SqliteMutationWorkerCoordination;
};
export type SqliteCanonicalValidationWorkerRequest = {
  type: "canonical-validation";
  operationId: number;
  commitGate: SharedArrayBuffer;
  databaseOptions: SqliteSessionReclamationPlan["databaseOptions"];
  maxRows: number;
  maxBytes: number;
  initializeCanonicalValidation: boolean;
  coordination: SqliteMutationWorkerCoordination;
};
export type WorkerCleanup = { cleanupWarnings: string[]; settled: boolean };
export type SqliteReclamationWorkerMessage =
  | SqliteMutationWorkerMessage<SqliteSessionReclamationResult | SqliteReclamationPreparation>
  | { type: "lease"; receipt: BranchAgentDatabaseWorkerLeaseReceipt }
  | { type: "checkpoint"; operationId: number; snapshot: SqliteWalCheckpointSnapshot }
  | ({ type: "closed" } & WorkerCleanup);

import type { captureRuntimeWorkerSource } from "../infra/runtime-worker-generation.js";
import type { SqliteWorkerAdmissionCleanup } from "../infra/sqlite-worker-broker.types.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import type {
  getSqliteWorkerActorIdentity,
  SqliteWorkerStore,
} from "../infra/sqlite-worker-store.js";
import type { BranchStateDatabaseReadAdmission } from "./branch-state-db-async-lifecycle.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";
import type {
  BranchStateWorkerOperations,
  BranchStateWorkerInspectionOperations,
} from "./branch-state-worker-contract.js";
import type { captureBranchStateWorkerOpeningGuard } from "./branch-state-worker-operation.js";

export type StoreOperations = BranchStateWorkerOperations &
  BranchStateWorkerInspectionOperations;
export type Store = SqliteWorkerStore<StoreOperations>;
export type DomainScope = Pick<SqliteWorkerStore<BranchStateWorkerOperations>, "execute">;
export type IdleTimer = ReturnType<typeof setTimeout> & { unref?: () => void };
export type Entry = {
  source: ReturnType<typeof captureRuntimeWorkerSource>;
  context: BranchStateWorkerContext;
  databaseAdmission: BranchStateDatabaseReadAdmission;
  opening: Promise<Store | undefined>;
  openingAdmission: ReturnType<typeof captureBranchStateWorkerOpeningGuard>["admission"];
  existingOnly: boolean;
  store?: Store;
  actor?: ReturnType<typeof getSqliteWorkerActorIdentity>;
  bound?: boolean;
  cleanup?: SqliteWorkerAdmissionCleanup;
  activeOperations: number;
  operationGeneration: number;
  idleTimer?: IdleTimer;
};
export type ActorRetirement = {
  identity: DatabasePathIdentity;
  entries: Set<Entry>;
  pending?: Promise<void>;
};

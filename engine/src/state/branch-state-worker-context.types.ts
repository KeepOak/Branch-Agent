import type { SqliteWorkerStateContext } from "../infra/sqlite-worker-state-context.js";
import type {
  BranchDatabaseMaintenanceScope,
  BranchStateDatabaseReadAdmission,
} from "./branch-state-db-async-lifecycle.js";

export type BranchStateWorkerContext = Omit<SqliteWorkerStateContext, "environment"> & {
  environment: {
    BRANCH_STATE_DIR: string;
    BRANCH_SUPERVISOR_MODE?: "external";
  };
  admission: BranchStateDatabaseReadAdmission;
  /** Committed facts outlive a caller's schema borrow, but never the captured database generation. */
  assertPublicationCurrent?: () => void;
  /** Host-only captured scope; reentry never extends the original admission lifetime. */
  runInCapturedSchemaScope?: <T>(operation: () => T) => T;
  /** Host-only ownership; workers request live schema grants through their job admission. */
  maintenanceScope?: BranchDatabaseMaintenanceScope;
};

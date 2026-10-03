import type { DatabaseSync } from "node:sqlite";
import type { BranchStateDatabase } from "../../state/branch-state-db-contract.js";

export type WorkerEnvironmentKernelOptions = {
  database: BranchStateDatabase;
  now: () => number;
  write: <T>(operation: (db: DatabaseSync) => T) => T;
};

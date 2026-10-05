import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";

export type AgentWorkerOperationContext = {
  open: () => BranchAgentDatabase;
  options: BranchAgentDatabaseOptions & { path: string };
  admit: (stage: "transaction" | "commit", publication?: unknown) => void;
  writeTransaction: <T>(
    operationLabel: string,
    owner: string,
    write: (current: BranchAgentDatabase) => T,
  ) => T;
  /** Durable executors lend their exact admitted shared owner to native binding settlement. */
  writeSharedTransaction?: <T>(
    source: DatabasePathIdentity,
    write: (current: BranchStateDatabase) => T,
  ) => T;
};

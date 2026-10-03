import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";

export type AgentWorkerOperationContext = {
  open: () => BranchAgentDatabase;
  options: BranchAgentDatabaseOptions & { path: string };
  admit: (stage: "transaction" | "commit", publication?: unknown) => void;
  writeTransaction: <T>(
    operationLabel: string,
    owner: string,
    write: (current: BranchAgentDatabase) => T,
  ) => T;
};

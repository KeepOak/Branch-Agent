import type { BranchAgentDatabaseIdentity } from "../../state/branch-agent-db-identity.js";

/** Address of the physical store admitted by an entry read; never retains its handle. */
export type SessionEntryReadSource = Readonly<{ agentId: string; path: string }>;

export type CapturedSessionEntryReadSource = SessionEntryReadSource &
  Readonly<{
    databaseIdentity: BranchAgentDatabaseIdentity;
    databaseBirthtime?: string;
  }>;

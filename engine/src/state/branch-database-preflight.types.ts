import type { BranchConfig } from "../config/types.branch.js";
import type { SqliteSchemaIssue } from "../infra/sqlite-schema-contract.js";
import type { PreparedAgentDatabaseMigrationDiscovery } from "../infra/state-migrations.media-persistence-targets.js";
import type { AgentDatabaseAdmissionRefusal } from "./agent-database-admission.js";
import type { BranchSchemaVersions } from "./branch-schema-versions.js";
import type { BranchStateSchemaReadAdmission } from "./branch-state-db-contract.js";
import type { BranchExternalStateOwnership } from "./branch-state-ownership.js";

export type AgentDatabasePreflightStats = {
  schemaProcessCount: number;
  schemaInspectionCount: number;
  schemaSnapshotCount: number;
};

export type IncompatibleBranchDatabase = {
  kind: "agent" | "state";
  path: string;
  agentId?: string;
  foundVersion: number;
  supportedVersion: number;
  writerAppVersion?: string;
};

export type IndeterminateBranchDatabase = {
  kind: "agent" | "state";
  path: string;
  reason: string;
  agentId?: string;
};

export type DeferredStateSchemaPublication = {
  kind: "state";
  path: string;
  foundVersion: number;
  contentVersion: number;
  runId?: string;
  publishAfterMs?: number | null;
  message: string;
};

export type BranchDatabaseSchemaPreflight = {
  incompatible: IncompatibleBranchDatabase[];
  indeterminate: IndeterminateBranchDatabase[];
  agentRefusals?: AgentDatabaseAdmissionRefusal[];
  pendingMigrations?: Omit<IncompatibleBranchDatabase, "writerAppVersion">[];
  deferredSchemaPublications?: DeferredStateSchemaPublication[];
};

export type BranchStateSchemaPreflightResult = {
  databasePath: string;
  foundVersion: number | null;
  contentVersion?: number;
  deferredPublication?: DeferredStateSchemaPublication;
  issues: SqliteSchemaIssue[];
  ownership: BranchExternalStateOwnership | null;
  reason?: string;
  requiresWrite: boolean;
  schema: "branch.state-schema-preflight.v1";
  status: "exact" | "startup-repairable" | "migration-required" | "incompatible" | "indeterminate";
  targetVersion: number;
};

export type BranchAgentSchemaPreflightResult = Omit<
  BranchStateSchemaPreflightResult,
  "schema" | "ownership" | "status"
> & {
  schema: "branch.agent-schema-preflight.v1";
  agentId: string;
  status: "exact" | "incompatible" | "indeterminate";
};

export type BranchDatabaseSchemaPreflightOperation =
  | "doctor"
  | "gateway-restart"
  | "gateway-startup";

export type BranchDatabasePreflightOptions = {
  env: NodeJS.ProcessEnv;
  onAgentDatabaseDiscovery?: (prepared: PreparedAgentDatabaseMigrationDiscovery) => void;
  onAgentInspection?: (stats: AgentDatabasePreflightStats) => void;
  scope?: "state";
  signal?: AbortSignal;
  /** Updates use the isolated online reader; other inspections preserve source artifacts. */
  preserveSourceArtifacts?: boolean;
  /** Omit for current-runtime checks; updates pass their complete target pair. */
  supportedVersions?: BranchSchemaVersions;
  verifyCurrentSchemaShape?: boolean;
  requireStartupMigrationReadiness?: boolean;
  /** Consume this startup owner's unchanged compatibility headers once, never readiness proof. */
  reuseStartupSchemaPreparation?: boolean;
  configuredAgentDatabaseTargets?:
    | readonly { agentId: string; path: string }[]
    | ((
        registeredDatabases: readonly { agentId: string; path: string }[],
      ) => readonly { agentId: string; path: string }[]);
  configuredAgentDatabaseCandidatePaths?: readonly string[];
  agentAdmissionConfig?: BranchConfig;
  openStateSchemaReadAdmission?: BranchStateSchemaReadAdmission;
};

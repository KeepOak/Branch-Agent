import type { GROVE_SCHEMA_VERSION, GroveSourceIdentity } from "./manifest-contract.js";
import type { GroveAgentOrigin } from "./provenance-agent-origin.js";
import type { parseGroveInstallRecordSchemaVersion } from "./provenance-schema-version.js";

export type GroveOrphanWorkspace = { workspace: string; updatedAtMs: number };

export type GroveInstallStatus =
  | "pending"
  | "workspace_ready"
  | "config_committed"
  | "complete"
  | "partial";

export type PersistedGroveInstall = {
  schemaVersion: ReturnType<typeof parseGroveInstallRecordSchemaVersion>;
  grove: GroveSourceIdentity;
  manifestSchemaVersion: typeof GROVE_SCHEMA_VERSION;
  planIntegrity: string;
  agentId: string;
  workspace: string;
  agentConfigDigest: string;
  agentOrigin: GroveAgentOrigin;
  agentOwnedPaths: string[];
  bootstrap?: { sourcePath: string; contentDigest: string };
  status: GroveInstallStatus;
  addedAtMs: number;
  updatedAtMs: number;
};

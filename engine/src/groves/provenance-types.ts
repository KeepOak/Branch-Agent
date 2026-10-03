import type { GroveAgentOrigin } from "./provenance-agent-origin.js";
import type { parseGroveInstallRecordSchemaVersion } from "./provenance-schema-version.js";
import type { GroveAddPlan } from "./types.js";

export type GroveInstallStatus =
  | "pending"
  | "workspace_ready"
  | "config_committed"
  | "complete"
  | "partial";

export type PersistedGroveInstall = {
  schemaVersion: ReturnType<typeof parseGroveInstallRecordSchemaVersion>;
  grove: GroveAddPlan["grove"];
  manifestSchemaVersion: GroveAddPlan["manifestSchemaVersion"];
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

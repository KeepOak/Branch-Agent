import type { PluginRuntimeApplication } from "../../packages/gateway-protocol/src/schema/plugins.js";
import type { unsetConfiguredMcpServer } from "../agents/mcp-config-mutation.js";
import type { listConfiguredMcpServers } from "../config/mcp-config.js";
import type { purgeAgentSessionStoreEntries } from "../config/sessions/cleanup-service.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import type { GroveCronGateway } from "./cron.js";
import type { GroveTrashPath, RemovedWorkspaceFile } from "./lifecycle-delete-support.js";
import type { GroveMonitorCleanupGateway } from "./monitor-cleanup-contract.js";
import type { ClawPackageRemovalGateway } from "./package-remove-contract.js";
import type {
  ClawPackageRemovalResult,
  GroveReferencedCleanup,
  PackageRemovalDeps,
} from "./package-remove.js";
import { GROVE_OUTPUT_STABILITY } from "./types.js";

export const GROVE_REMOVE_PLAN_SCHEMA_VERSION = "branch.groveRemovePlan.v1" as const;

export type GroveRemovePlanAction = {
  kind:
    | "agent"
    | "configBinding"
    | "agentAllow"
    | "workspace"
    | "agentState"
    | "sessionIndex"
    | "sessionTranscripts"
    | "scheduledJob"
    | "workspaceFile"
    | "bootstrap"
    | "packageRef"
    | "mcpServer"
    | "cronJob"
    | "installRecord";
  id: string;
  action: "remove" | "delete" | "retain" | "release" | "uninstall" | "trash";
  target: string;
  blocked: boolean;
  reason?: string;
  details?: Record<string, unknown>;
};

export type GroveRemovePlan = {
  schemaVersion: typeof GROVE_REMOVE_PLAN_SCHEMA_VERSION;
  stability: typeof GROVE_OUTPUT_STABILITY;
  dryRun: true;
  mutationAllowed: false;
  planIntegrity: string;
  target: string;
  agentId?: string;
  actions: GroveRemovePlanAction[];
  blockers: Array<{ code: string; message: string }>;
};

type RemovedCronJob = {
  manifestId: string;
  schedulerJobId?: string;
  action: "removed" | "error";
  message?: string;
};

export type RemovedMcpServer = {
  name: string;
  action: "removed" | "missing" | "released" | "error";
  message?: string;
};

export type GroveRemovePlanOptions = BranchStateDatabaseOptions & {
  config?: BranchConfig;
  sourceMcpServers?: Record<string, Record<string, unknown>>;
  listMcpServers?: typeof listConfiguredMcpServers;
  packageDeps?: PackageRemovalDeps;
  referencedCleanup?: GroveReferencedCleanup;
  monitorGateway?: GroveMonitorCleanupGateway;
};

export type GroveRemoveApplyOptions = GroveRemovePlanOptions & {
  packageGateway?: ClawPackageRemovalGateway;
  purgeSessions?: (
    ...args: Parameters<typeof purgeAgentSessionStoreEntries>
  ) => Promise<boolean | void>;
  trashPath?: GroveTrashPath;
  consentPlanIntegrity?: string;
  unsetMcpServer?: typeof unsetConfiguredMcpServer;
  cronGateway?: Pick<GroveCronGateway, "get" | "remove">;
};

export const GROVE_REMOVE_RESULT_SCHEMA_VERSION = "branch.groveRemoveResult.v1" as const;
export type GroveRemoveResult = {
  schemaVersion: typeof GROVE_REMOVE_RESULT_SCHEMA_VERSION;
  stability: typeof GROVE_OUTPUT_STABILITY;
  dryRun: false;
  status: "complete" | "partial";
  agentId: string;
  agentRemoved: boolean;
  bootstrap?: RemovedWorkspaceFile;
  workspaceFiles: RemovedWorkspaceFile[];
  packages: ClawPackageRemovalResult[];
  mcpServers: RemovedMcpServer[];
  cronJobs: RemovedCronJob[];
  packageRefsReleased: number;
  pluginRuntime?: PluginRuntimeApplication;
  warnings?: string[];
  error?: { code: string; message: string };
};

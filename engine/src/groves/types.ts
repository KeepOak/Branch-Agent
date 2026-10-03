// Shared types for grouped Branch Agent Grove manifests and read-only add plans.
import type { AgentConfig } from "../config/types.agents.js";
import type { GROVE_SCHEMA_VERSION, ClawDiagnostic } from "./manifest-contract.js";
import type {
  GroveManifest,
  GroveBranchExtension,
  GroveBranchProfile,
  ClawPackage,
} from "./schema.js";

export {
  GROVE_BOOTSTRAP_FILE_NAMES,
  GROVE_SCHEMA_VERSION,
  type ClawDiagnostic,
} from "./manifest-contract.js";

export type {
  GroveCronJob,
  GroveManifest,
  GroveMcpServer,
  GroveBranchExtension,
  GroveBranchProfile,
  ClawPackage,
} from "./schema.js";

export const GROVE_ADD_PLAN_SCHEMA_VERSION = "branch.groveAddPlan.v1" as const;
export const GROVE_INSPECT_RESULT_SCHEMA_VERSION = "branch.groveInspect.v1" as const;
export const GROVE_OUTPUT_STABILITY = "experimental" as const;

type GroveExtensionFormat = GroveBranchExtension["format"];

export type GroveAppliedExtension = {
  id: string;
  format: GroveExtensionFormat;
  detectedFormat: GroveExtensionFormat;
  mapped: string[];
  unavailable: string[];
  adapterIdentity: string;
};

export type ResolvedClawPackage = ClawPackage & {
  integrity: string;
  extension?: GroveAppliedExtension;
};

export type ClawPackagePreflightResult = {
  ok: boolean;
  action?: "install" | "reuse";
  integrity?: string;
  installId?: string;
  warning?: string;
  installedIntegrity?: string;
  installedAt?: string;
  installedVersion?: string;
  code?: string;
  message?: string;
  requirements?: GroveLocalPrerequisite[];
  detectedFormat?: GroveExtensionFormat;
  mapped?: string[];
  unavailable?: string[];
  adapterIdentity?: string;
};

export type ClawPackagePreflight = (
  pkg: ClawPackage,
  workspace: string,
) => Promise<ClawPackagePreflightResult>;

export type GroveSourceIdentity = {
  kind: "package" | "development";
  name: string;
  version: string;
  packageRoot: string;
  manifestPath: string;
  integrityKind: "artifact" | "development-snapshot";
  integrity: string;
  byteLength: number;
};

export type GroveWorkspaceSourceSnapshot = {
  sourcePath: string;
  realPath: string;
  byteLength: number;
  digest: string;
};

type GroveSourceFileSnapshot = {
  byteLength: number;
  digest: string;
};

type GroveProfileSourceSnapshot = GroveSourceFileSnapshot & {
  sourcePath: string;
};

type GroveSourceSnapshot = {
  manifest: GroveSourceFileSnapshot;
  branchProfile?: GroveProfileSourceSnapshot;
  workspaceSources: GroveWorkspaceSourceSnapshot[];
  packageBootstrap?: GroveWorkspaceSourceSnapshot;
};

export type GroveReadResult =
  | {
      ok: true;
      manifest: GroveManifest;
      groveMarkdownBody?: Buffer;
      packageBootstrap?: GroveWorkspaceSourceSnapshot;
      branchProfile?: GroveBranchProfile;
      legacyBranchProfile?: GroveBranchProfile;
      source: GroveSourceIdentity;
      snapshot: GroveSourceSnapshot;
      diagnostics: ClawDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: ClawDiagnostic[];
    };

export type GroveAddPlanAction = {
  kind: "agent" | "workspace" | "bootstrap" | "workspaceFile" | "package" | "mcpServer" | "cronJob";
  id: string;
  action: "create" | "write" | "install" | "reuse" | "configure" | "schedule";
  target: string;
  source?: string;
  sourceKind?: "groveMarkdownBody";
  digest?: string;
  details?: Record<string, unknown>;
  blocked: boolean;
  reason?: string;
};

export type GroveExtensionPlan = GroveBranchExtension & {
  detectedFormat?: GroveExtensionFormat;
  integrity?: string;
  installId?: string;
  ownerAction?: "install" | "reuse";
  requirementState: "satisfied" | "missing-installable" | "conflicting" | "setup-required";
  mapped: string[];
  unavailable: string[];
  adapterIdentity?: string;
  blocked: boolean;
};

export type GroveAddCapabilityChange = {
  kind: "agent" | "package" | "mcpServer" | "cronJob";
  id: string;
  path: string;
  action: "create" | "install" | "reuse" | "configure" | "schedule";
  classification: "escalation";
  requiresDistinctConsent: true;
  reason: string;
  effect: Record<string, unknown>;
  digest: string;
};

export type GroveLocalPrerequisite =
  | { kind: "environment"; mcpServer: string; name: string }
  | { kind: "oauth"; mcpServer: string }
  | {
      kind: "plugin-setup";
      plugin: string;
      provider: string;
      envVars: string[];
      authMethods: string[];
    };

export type GroveAddPlan = {
  schemaVersion: typeof GROVE_ADD_PLAN_SCHEMA_VERSION;
  manifestSchemaVersion: typeof GROVE_SCHEMA_VERSION;
  stability: typeof GROVE_OUTPUT_STABILITY;
  dryRun: true;
  mutationAllowed: false;
  planIntegrity: string;
  grove: GroveSourceIdentity;
  agent: {
    requestedId: string;
    finalId: string;
    workspace: string;
    config: AgentConfig & { workspace: string };
  };
  summary: {
    totalActions: number;
    agentActions: number;
    workspaceActions: number;
    packageActions: number;
    mcpServerActions: number;
    cronJobActions: number;
    blockedActions: number;
    capabilityEscalations: number;
  };
  actions: GroveAddPlanAction[];
  capabilityChanges: GroveAddCapabilityChange[];
  readiness: {
    ready: boolean;
    requirements: GroveLocalPrerequisite[];
  };
  extensions?: GroveExtensionPlan[];
  blockers: ClawDiagnostic[];
  diagnostics: ClawDiagnostic[];
};

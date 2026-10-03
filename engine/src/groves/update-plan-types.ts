import type {
  GROVE_OUTPUT_STABILITY,
  ClawDiagnostic,
  GroveLocalPrerequisite,
  GroveSourceIdentity,
} from "./types.js";
import type { GroveUpdateCapabilityChange } from "./update-capability-changes.js";

export const GROVE_UPDATE_PLAN_SCHEMA_VERSION = "branch.groveUpdatePlan.v1" as const;

export type GroveUpdateAction = {
  kind: "agent" | "workspaceFile" | "package" | "mcpServer" | "cronJob";
  id: string;
  action: "add" | "change" | "remove" | "release" | "unchanged" | "manual";
  target: string;
  blocked: boolean;
  reason: string;
  currentDigest?: string;
  currentPresent?: boolean;
  desiredDigest?: string;
};

export type GroveUpdatePlan = {
  schemaVersion: typeof GROVE_UPDATE_PLAN_SCHEMA_VERSION;
  stability: typeof GROVE_OUTPUT_STABILITY;
  dryRun: true;
  mutationAllowed: false;
  planIntegrity: string;
  found: boolean;
  agentId: string;
  currentGrove?: { name: string; version: string; integrity: string };
  targetGrove?: Pick<GroveSourceIdentity, "name" | "version" | "integrity">;
  summary: {
    totalActions: number;
    added: number;
    changed: number;
    removed: number;
    released: number;
    unchanged: number;
    manual: number;
    blocked: number;
    capabilityChanges: number;
    capabilityEscalations: number;
  };
  actions: GroveUpdateAction[];
  capabilityChanges: GroveUpdateCapabilityChange[];
  readiness: {
    ready: boolean;
    requirements: GroveLocalPrerequisite[];
  };
  blockers: ClawDiagnostic[];
  diagnostics: ClawDiagnostic[];
};

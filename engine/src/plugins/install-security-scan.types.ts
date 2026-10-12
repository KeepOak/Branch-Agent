import type { BranchConfig } from "../config/types.branch.js";
import type { InstallPolicyFinding } from "../security/install-policy.js";
import type { SkillInstallSpec } from "../skills/types.js";

/** Skill install metadata shape passed into shared install policy evaluation. */
export type SkillInstallSpecMetadata = SkillInstallSpec;

export type InstallPolicyWarningDetails = {
  targetName: string;
  targetType: "skill" | "plugin";
  requestMode: "install" | "update";
  reason: string;
  findings?: InstallPolicyFinding[];
};

export type InstallPolicyWarningAcknowledgementRequest = InstallPolicyWarningDetails;

type InstallPolicyWarningAcknowledgementResult = { status: "approved" } | { status: "declined" };

/** Overrides that intentionally loosen install safety policy for trusted/operator paths. */
export type InstallSafetyOverrides = {
  config?: BranchConfig;
  onInstallPolicyWarning?: (
    request: InstallPolicyWarningAcknowledgementRequest,
  ) => Promise<InstallPolicyWarningAcknowledgementResult>;
  trustedSourceLinkedOfficialInstall?: boolean;
};

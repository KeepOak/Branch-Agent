// Shared types for applying auth-choice selections during onboarding and agent setup.
import type { BranchConfig } from "../config/types.branch.js";
import type { ProviderAuthResult } from "../plugins/types.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { AuthChoice, OnboardOptions } from "./onboard-types.js";

export type ApplyAuthChoiceParams = {
  authChoice: AuthChoice;
  config: BranchConfig;
  env?: NodeJS.ProcessEnv;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  agentDir?: string;
  workspaceDir?: string;
  setDefaultModel: boolean;
  preserveExistingDefaultModel?: boolean;
  agentId?: string;
  opts?: Partial<OnboardOptions>;
};

export type ApplyAuthChoiceResult = {
  config: BranchConfig;
  agentModelOverride?: string;
  utilityModelOverride?: string;
  modelTarget?: "utility";
  retrySelection?: boolean;
};

export type PreparedAuthChoiceResult = ApplyAuthChoiceResult & {
  authProfiles: ProviderAuthResult["profiles"];
  persistAuthProfiles: (profiles?: ProviderAuthResult["profiles"]) => Promise<void>;
};

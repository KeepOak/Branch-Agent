/**
 * Shared contract fixtures for agent prompt overlay runtime behavior.
 */
import type { BranchConfig } from "../../../config/types.branch.js";
import type { ProviderSystemPromptContributionContext } from "../../../plugins/types.js";

export const GPT5_CONTRACT_MODEL_ID = "gpt-5.4";
export const GPT5_PREFIXED_CONTRACT_MODEL_ID = "openai/gpt-5.4";
export const NON_GPT5_CONTRACT_MODEL_ID = "gpt-4.1";
export const OPENAI_CONTRACT_PROVIDER_ID = "openai";
export const OPENAI_CODEX_CONTRACT_PROVIDER_ID = "openai";
export const CODEX_CONTRACT_PROVIDER_ID = "codex";
export const NON_OPENAI_CONTRACT_PROVIDER_ID = "openrouter";

export function openAiPluginPersonalityConfig(personality: "friendly" | "off"): BranchConfig {
  return {
    plugins: {
      entries: {
        openai: {
          config: { personality },
        },
      },
    },
  } satisfies BranchConfig;
}

export function sharedGpt5PersonalityConfig(_personality: "friendly" | "off"): BranchConfig {
  return {};
}

export function codexPromptOverlayContext(params?: {
  modelId?: string;
  config?: BranchConfig;
}): ProviderSystemPromptContributionContext {
  return {
    provider: CODEX_CONTRACT_PROVIDER_ID,
    modelId: params?.modelId ?? GPT5_CONTRACT_MODEL_ID,
    promptMode: "full",
    agentDir: "/tmp/branch-codex-prompt-contract-agent",
    workspaceDir: "/tmp/branch-codex-prompt-contract-workspace",
    ...(params?.config ? { config: params.config } : {}),
  };
}

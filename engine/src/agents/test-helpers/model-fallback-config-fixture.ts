/**
 * Model fallback config fixture.
 *
 * Builds a minimal config with primary and fallback models for model-selection tests.
 */
import type { BranchConfig } from "../../config/types.branch.js";

export function makeModelFallbackCfg(overrides: Partial<BranchConfig> = {}): BranchConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "openai/gpt-4.1-mini",
          fallbacks: ["anthropic/claude-haiku-3-5"],
        },
      },
    },
    ...overrides,
  } as BranchConfig;
}

export function createModelFallbackConfig(primary: string, fallbacks: string[]): BranchConfig {
  return {
    agents: {
      defaults: {
        model: { primary, fallbacks },
      },
    },
  };
}

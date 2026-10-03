import type { BranchConfig } from "../../config/types.branch.js";

export function createBedrockAwsSdkConfig(): BranchConfig {
  return {
    models: {
      providers: {
        "amazon-bedrock": {
          auth: "aws-sdk",
          baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
          api: "bedrock-converse-stream",
          models: [],
        },
      },
    },
    auth: {
      profiles: {
        "amazon-bedrock:default": {
          provider: "amazon-bedrock",
          mode: "aws-sdk",
        },
      },
    },
  };
}

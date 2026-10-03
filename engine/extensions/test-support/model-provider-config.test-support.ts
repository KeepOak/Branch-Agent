import type { ModelProviderConfig } from "branch/plugin-sdk/provider-model-shared";

export function createModelProviderConfig<T extends Record<string, ModelProviderConfig>>(
  providers: T,
) {
  return { models: { providers } };
}

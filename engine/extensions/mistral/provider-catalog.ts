import { buildManifestModelProviderConfig } from "branch/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "branch/plugin-sdk/provider-model-shared";
import manifest from "./branch.plugin.json" with { type: "json" };

export function buildMistralProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "mistral",
    catalog: manifest.modelCatalog.providers.mistral,
  });
}

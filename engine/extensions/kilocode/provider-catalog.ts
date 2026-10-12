import { buildManifestModelProviderConfig } from "branch/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "branch/plugin-sdk/provider-model-shared";
import manifest from "./branch.plugin.json" with { type: "json" };
import { discoverKilocodeModels, KILOCODE_BASE_URL } from "./provider-models.js";

export function buildKilocodeProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "kilocode",
    catalog: manifest.modelCatalog.providers.kilocode,
  });
}

export async function buildKilocodeProviderWithDiscovery(
  options: { discoveryMode?: "strict" } = {},
): Promise<ModelProviderConfig> {
  return {
    baseUrl: KILOCODE_BASE_URL,
    api: "openai-completions",
    models: await discoverKilocodeModels(options),
  };
}

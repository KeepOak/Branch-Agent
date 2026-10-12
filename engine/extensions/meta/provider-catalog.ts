import { buildManifestModelProviderConfig } from "branch/plugin-sdk/provider-catalog-shared";
import type {
  ModelDefinitionConfig,
  ModelProviderConfig,
} from "branch/plugin-sdk/provider-model-shared";
import manifest from "./branch.plugin.json" with { type: "json" };

export const META_BASE_URL = manifest.modelCatalog.providers.meta.baseUrl;
export const META_MODEL_CATALOG = manifest.modelCatalog.providers.meta.models;

export function buildMetaCatalogModels(): ModelDefinitionConfig[] {
  return buildMetaProvider().models;
}

export function buildMetaProvider(): ModelProviderConfig {
  return buildManifestModelProviderConfig({
    providerId: "meta",
    catalog: manifest.modelCatalog.providers.meta,
  });
}
